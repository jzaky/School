# Control Center and System Health

## Control Center (`/control-center`)
One page that shows every AEGIS module. Each tile:
- is computed from the organization's own records when the page loads (nothing cached or estimated);
- names its source in plain words;
- links to the page that lists the rows behind the figure;
- appears only when the viewer's role can read that area. A missing tile means "not yours to see", never "zero".

Lab traffic (agents marked as Attack Simulation Lab agents) is excluded from every figure.

Groups and tiles:

| Group | Tiles |
|---|---|
| Control | decisions (14 days), approvals waiting, active agents by autonomy level, policies enforced, active exceptions |
| Security | open security events by severity, open incidents, gaps in the latest lab run |
| Governance | models needing attention, datasets with gaps, open regulatory changes |
| Assurance | evidence events and checkpoint coverage |
| Integrations | event destinations and failed deliveries |

Code: `packages/core/src/assurance/control-center.ts` (`controlCenter`).

## System Health (`/org/health`)
Checks, each with `ok`, `warning`, `failing` or `unknown`:

| Check | How it is judged |
|---|---|
| Database | a query round trip |
| Background worker | evidence older than 10 minutes with no signed checkpoint means the worker is probably not running |
| Organization jobs | overdue, running and recently failed jobs for this organization |
| Integrations | the last connection test of each active integration |
| Event delivery | recent errors and deliveries waiting over 30 minutes |
| Action Gateway | whether the organization has paused it |

These checks only use records the organization owns. Infrastructure-wide health belongs to platform administration.

## Themes and shortcuts
- Dark, light or system, chosen with the toggle in the top bar and stored in the browser (`aegis-theme`). The theme is applied before first paint.
- `?` opens the shortcut list. `g` followed by `o` (Overview), `c` (Control Center), `a` (Approvals), `g` (Gateway), `p` (Policies), `s` (Security), `e` (Evidence) or `h` (Health) navigates.

## Tests
`apps/web/tests/e2e/control-center.spec.ts`: tile sources and links, role filtering, health statuses, theme switching and persistence, keyboard shortcuts.
