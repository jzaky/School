"""AEGIS Python SDK. Standard library only.

    from aegis_sdk import AegisClient, guard
    aegis = AegisClient("https://aegis.example", os.environ["AEGIS_AGENT_KEY"])

    @guard(aegis, "issue-refund")
    def issue_refund(order_id: str, amount: float, currency: str) -> str: ...

Fail closed: a network error, a timeout or a non-decision response is a refusal. A guarded function
never runs unless the gateway allowed (or narrowed) the call and issued a grant.
"""

from __future__ import annotations

import functools
import hashlib
import inspect
import json
import time
import urllib.error
import urllib.request
from typing import Any, Callable, Dict, Optional

__all__ = ["AegisClient", "AegisRefusal", "guard", "guarded_call", "crewai_tool", "autogen_function", "semantic_kernel_function"]

RUN_DECISIONS = ("allow", "restrict")


class AegisRefusal(Exception):
    """Raised instead of running a tool. `decision` holds the gateway's full answer."""

    def __init__(self, decision: Dict[str, Any], message: str):
        super().__init__(message)
        self.decision = decision


class AegisClient:
    def __init__(self, base_url: str, api_key: str, timeout: float = 10.0, opener: Optional[Callable[..., Any]] = None):
        self.base = base_url.rstrip("/")
        self.key = api_key
        self.timeout = timeout
        self._open = opener or urllib.request.urlopen

    def _request(self, method: str, path: str, body: Optional[Dict[str, Any]] = None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method, headers={"content-type": "application/json", "authorization": f"Bearer {self.key}"})
        try:
            with self._open(req, timeout=self.timeout) as res:
                raw = res.read().decode() or "null"
                return res.status, json.loads(raw), None
        except urllib.error.HTTPError as e:
            try:
                payload = json.loads(e.read().decode() or "null")
            except ValueError:
                payload = None
            return e.code, payload, f"HTTP {e.code}"
        except Exception as e:  # network error, timeout, bad JSON: all fail closed
            return 0, None, str(e) or e.__class__.__name__

    def authorize(self, **request: Any) -> Dict[str, Any]:
        status, data, err = self._request("POST", "/v1/gateway/actions", request)
        if isinstance(data, dict) and "decision" in data and status in (200, 202, 403):
            return data
        return {"requestId": "", "status": "denied", "decision": "deny", "reasons": [f"Authorization service unavailable or rejected the request: {err or status}"], "transportError": err or f"HTTP {status}"}

    def get_request(self, request_id: str) -> Optional[Dict[str, Any]]:
        status, data, _ = self._request("GET", f"/v1/gateway/actions/{request_id}")
        return data if status == 200 else None

    def wait_for_approval(self, request_id: str, timeout: float = 300.0, interval: float = 3.0, stop_at_approved: bool = False) -> str:
        in_flight = {"pending_approval", "evaluating", "executing", "quarantined"} | (set() if stop_at_approved else {"approved"})
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            r = self.get_request(request_id) or {}
            status = r.get("status", "unknown")
            if status not in in_flight:
                return status
            time.sleep(interval)
        return "timeout"

    def get_grant(self, request_id: str) -> Optional[str]:
        status, data, _ = self._request("POST", f"/v1/gateway/actions/{request_id}/grant", {})
        return data.get("grant") if status == 200 and isinstance(data, dict) else None

    def report_execution(self, request_id: str, grant: str, outcome: str = "succeeded", summary: Optional[Dict[str, Any]] = None) -> None:
        self._request("POST", f"/v1/gateway/actions/{request_id}/execute", {"grant": grant, "outcome": outcome, "reference": None, "summary": summary or {}})


def fingerprint(args: Dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(args, sort_keys=True, default=str).encode()).hexdigest()[:24]


def _refusal_message(d: Dict[str, Any]) -> str:
    why = "; ".join(d.get("reasons") or []) or "no reason given"
    kind = d.get("decision")
    if kind == "quarantine":
        return f"AEGIS is holding this action for security review: {why}"
    if kind == "request_more_information":
        fields = ", ".join((d.get("moreInformation") or {}).get("fields") or [])
        return f"AEGIS needs more information before deciding. Supply: {fields or 'the requested fields'}"
    if kind == "require_approval":
        return f"This action needs a person's approval (request {d.get('requestId')}). It has not run."
    return f"AEGIS refused this action: {why}"


def guarded_call(client: AegisClient, tool: str, args: Dict[str, Any], run: Callable[[Dict[str, Any]], Any], *, action: str = "execute", resource: Optional[str] = None, justification: str = "", context: Optional[Dict[str, Any]] = None, wait_for_approval: Optional[float] = None) -> Any:
    request: Dict[str, Any] = {"tool": tool, "action": action, "params": args, "idempotencyKey": f"{tool}:{fingerprint(args)}", "justification": justification, "context": context or {}, "executionMode": "agent"}
    if resource:
        request["resource"] = resource
    d = client.authorize(**request)
    grant = (d.get("grant") or {}).get("token")
    if d.get("decision") == "require_approval" and wait_for_approval:
        final = client.wait_for_approval(d["requestId"], timeout=wait_for_approval, interval=0.05, stop_at_approved=True)
        if final != "approved":
            raise AegisRefusal(d, f"The approval ended as {final}; the action did not run.")
        grant = client.get_grant(d["requestId"])
        d = {**d, "decision": "allow"}
    if d.get("decision") not in RUN_DECISIONS or not grant:
        raise AegisRefusal(d, _refusal_message(d))
    params = (d.get("restrictions") or {}).get("params", args) if d["decision"] == "restrict" else args
    try:
        result = run(params)
    except Exception as e:
        client.report_execution(d["requestId"], grant, "failed", {"error": str(e)[:200]})
        raise
    client.report_execution(d["requestId"], grant, "succeeded")
    return result


def guard(client: AegisClient, tool: Optional[str] = None, **opts: Any):
    """Decorator for a function called with keyword arguments by an agent runtime."""

    def wrap(fn: Callable[..., Any]):
        name = tool or fn.__name__
        sig = inspect.signature(fn)

        @functools.wraps(fn)
        def inner(*a: Any, **kw: Any):
            bound = sig.bind(*a, **kw)
            bound.apply_defaults()
            return guarded_call(client, name, dict(bound.arguments), lambda p: fn(**p), **opts)

        return inner

    return wrap


def crewai_tool(client: AegisClient, tool: Any, **opts: Any) -> Any:
    """CrewAI BaseTool instances: routes `_run` through AEGIS. Refusals come back as text for the agent."""
    original = tool._run

    def _run(*a: Any, **kw: Any):
        try:
            return guarded_call(client, getattr(tool, "name", "tool"), kw if kw else {"input": a[0] if a else None}, lambda p: original(**p) if kw else original(p["input"]), **opts)
        except AegisRefusal as e:
            return str(e)

    tool._run = _run
    return tool


def autogen_function(client: AegisClient, fn: Callable[..., Any], tool: Optional[str] = None, **opts: Any) -> Callable[..., Any]:
    """AutoGen function tools: register the returned function instead of the original."""
    return guard(client, tool, **opts)(fn)


semantic_kernel_function = autogen_function
