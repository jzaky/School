import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

from aegis_sdk import AegisClient, AegisRefusal, autogen_function, crewai_tool, guard, guarded_call

STATE = {"reports": [], "seen": {}}


class FakeGateway(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._send(200, {"status": "approved"})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["content-length"])) or b"{}")
        if self.path == "/v1/gateway/actions":
            amount = body["params"].get("amount", 0)
            rid = f"r{len(STATE['seen']) + 1}"
            STATE["seen"][body["idempotencyKey"]] = rid
            base = {"requestId": rid, "reasons": []}
            if amount == 500:
                return self._send(500, {"error": {"message": "boom"}})
            if amount <= 100:
                return self._send(200, {**base, "decision": "allow", "grant": {"token": "g"}})
            if amount <= 200:
                return self._send(200, {**base, "decision": "restrict", "grant": {"token": "g"}, "restrictions": {"params": {**body["params"], "amount": 100}}})
            if amount <= 300:
                return self._send(202, {**base, "decision": "require_approval"})
            if amount <= 400:
                return self._send(202, {**base, "decision": "quarantine", "reasons": ["suspicious"]})
            return self._send(403, {**base, "decision": "deny", "reasons": ["too large"]})
        if self.path.endswith("/execute"):
            STATE["reports"].append(body)
            return self._send(200, {})
        if self.path.endswith("/grant"):
            return self._send(200, {"grant": "g2"})
        self._send(404, {})


class GuardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), FakeGateway)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.client = AegisClient(f"http://127.0.0.1:{cls.server.server_port}", "aegis_ak_test", timeout=2)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        STATE["reports"].clear()

    def test_allow_runs_and_reports(self):
        @guard(self.client, "refund")
        def refund(amount, currency="AED"):
            return f"refunded {amount} {currency}"

        self.assertEqual(refund(50), "refunded 50 AED")
        self.assertEqual(STATE["reports"][0]["outcome"], "succeeded")

    def test_restrict_runs_with_narrowed_parameters(self):
        self.assertEqual(guarded_call(self.client, "refund", {"amount": 150}, lambda p: p["amount"]), 100)

    def test_refusals_never_run(self):
        ran = []
        for amount in (250, 350, 900, 500):
            with self.assertRaises(AegisRefusal):
                guarded_call(self.client, "refund", {"amount": amount}, lambda p: ran.append(p))
        self.assertEqual(ran, [])
        self.assertEqual(STATE["reports"], [])

    def test_unreachable_gateway_fails_closed(self):
        dead = AegisClient("http://127.0.0.1:9", "k", timeout=0.5)
        with self.assertRaises(AegisRefusal) as ctx:
            guarded_call(dead, "refund", {"amount": 1}, lambda p: 1)
        self.assertEqual(ctx.exception.decision["decision"], "deny")
        self.assertIn("transportError", ctx.exception.decision)

    def test_waits_for_approval_then_runs_with_new_grant(self):
        self.assertEqual(guarded_call(self.client, "refund", {"amount": 250}, lambda p: "done", wait_for_approval=2), "done")
        self.assertEqual(STATE["reports"][0]["grant"], "g2")

    def test_tool_error_is_reported_failed(self):
        def boom(_):
            raise RuntimeError("downstream 400")

        with self.assertRaises(RuntimeError):
            guarded_call(self.client, "refund", {"amount": 5}, boom)
        self.assertEqual(STATE["reports"][0]["outcome"], "failed")

    def test_crewai_tool_returns_refusal_text(self):
        class Tool:
            name = "refund"

            def _run(self, amount):
                return f"ok {amount}"

        t = crewai_tool(self.client, Tool())
        self.assertEqual(t._run(amount=10), "ok 10")
        self.assertIn("refused", t._run(amount=900))

    def test_autogen_function_keeps_signature(self):
        f = autogen_function(self.client, lambda amount: amount * 2, tool="double")
        self.assertEqual(f(amount=21), 42)


if __name__ == "__main__":
    unittest.main()
