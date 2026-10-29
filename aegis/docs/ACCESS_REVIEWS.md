# Agent access reviews

Auditors ask: are permissions on financial and other critical systems reviewed periodically,
including the permissions of AI agents? An access review is that periodic check, applied to agents.

- Code: `packages/core/src/agents/access-reviews.ts`
- Console: Control, Access Reviews (`/agents/access-reviews`)
- API: `GET/POST /v1/access-reviews`, `POST /v1/access-reviews/items/:id/decide`, `POST /v1/access-reviews/:id/complete`
- Tests: `packages/core/tests/access-reviews.test.ts`, `apps/api/tests/access-reviews-api.test.ts`, `apps/web/tests/e2e/access-reviews.spec.ts`

## How it works

1. A person with `agents:control` starts a review. AEGIS takes a snapshot of every live tool grant
   and resource permission each agent holds, with how many times the agent used it in the review
   window (90 days by default) and when it last did, taken from the gateway's own request log.
2. Grants the agent did not use in the window are marked **unused** and listed first. They are the
   first candidates to remove: an agent should hold only what it uses.
3. For each grant, a person decides **keep** or **remove**. Removing needs a reason and revokes the
   grant at once: the agent's next request that needs it is refused at the gateway.
4. The agent's technical owner, who builds and runs it, cannot decide its items. Agents and API
   keys cannot decide anything.
5. The review completes only when every item is decided. The summary (grants, kept, removed, unused
   grants kept, reviewers, on time or late, next due date) is written to the evidence record.

One review is open at a time. With an interval set (90 days by default), the next review is due that
many days after completion, and the page shows it as overdue once the date passes.

## Evidence

`access_review.started`, `access_review.item_decided` (one per decision, with the reason),
`agent.tool_revoked` or `agent.permission_revoked` for each removal, and `access_review.completed`.
