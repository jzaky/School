# Tool definition pinning

A connector can change under an agent. In September 2025 an email connector for AI agents shipped a
new version that quietly copied every email it sent to an attacker. The agents using it saw the same
tool and kept calling it. Tool definition pinning makes such a change visible and stops it being used
until a person has looked at it.

- Code: `packages/core/src/shield/tool-pins.ts`, checked in `gateway/baseline.ts`
- MCP gateway: `packages/mcp-gateway/src/proxy.ts` reports definitions on start and whenever the
  server announces a tool change
- Console: Tool Security page, "Connector versions" panel
- API: `POST /v1/tool-definitions/report`, `GET /v1/tool-definitions`, `POST /v1/tool-definitions/:toolId/approve`, `POST /v1/tool-definitions/:toolId/reject`
- Tests: `packages/core/tests/tool-pins.test.ts`, `packages/mcp-gateway/tests/proxy.test.ts`, `apps/web/tests/e2e/tool-pinning.spec.ts`

## How it works

1. The AEGIS MCP gateway connects to the real server and reads its name, its version and its tool
   list. It sends each tool's definition (name, description, input schema, annotations) to AEGIS.
2. The first report for a tool pins it: AEGIS keeps a fingerprint of the definition and the
   connector name and version, and records `tool.definition_pinned`.
3. A later report that differs in the definition, the connector version or the connector name is a
   change. AEGIS records `tool.definition_changed`, raises a high-severity security event, and the
   tool is refused at the gateway until a person reviews it. The MCP gateway also refuses it locally,
   so the call is not even sent for a decision.
4. A person with `security:write` reviews the change on the Tool Security page:
   - **Approve**: the new version becomes the pinned one and the tool works again.
   - **Reject**: the pinned version stays and the tool is disabled, because the connector is still
     serving the rejected version. Re-enable it once the connector is back on an approved version.

A report can only pin a new tool or raise a change. It can never clear one: reporting the old
definition again leaves the change pending. An agent can report only tools it was granted; a
downstream system's integration key only its own tools.

## What it does not do

AEGIS does not read the connector's code. A malicious update that keeps the same version number and
the same tool definition is not caught by pinning. It is caught, if at all, by AEGIS's other controls:
destination allow-lists, data protection on the parameters, and the evidence trail. Pin connector
versions in your own deployment too (exact versions, lockfiles, the Software Security module), so a
new version cannot arrive without a version change.

Set `requireDefinitionReport: true` on the MCP gateway to refuse to start when the definitions cannot
be reported to AEGIS.
