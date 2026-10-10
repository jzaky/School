# AEGIS console design system

Direction: dark graphite and deep navy, dense, calm. The console is an operations surface, not a brochure.

## Tokens
- Background: `--bg: #0b0f17` (graphite navy), `--bg-elev: #111826`, `--bg-elev-2: #182236`.
- Borders: `--line: #223049`, `--line-strong: #2f4166`.
- Text: `--fg: #e6ebf5`, `--fg-muted: #93a1ba`, `--fg-dim: #5f6d87`.
- Accent (single): `--accent: #5b8def` (steel blue). Used for focus, primary buttons, active nav.
- Status: allow `#2fbf71`, deny `#e5484d`, approval `#f5a524`, info `#5b8def`, critical `#c43a7e`.
- Light theme exists for the public site only; the console is dark by default with a light option.

## Type
- UI: Inter (system fallback). Numeric tables use `font-variant-numeric: tabular-nums`.
- Mono for ids, hashes, parameters: JetBrains Mono fallback to ui-monospace.
- Scale: 12, 13 (table body), 14 (body), 16, 20, 24, 32.

## Layout
- Left sidebar 248px, collapsible to 56px; grouped sections (Overview, Control, Assurance, Shield, Audit, Organization, Platform Admin).
- Top bar: organization switcher, global search (Cmd/Ctrl+K), environment badge, notifications, user menu.
- Content max width none; pages are grids of panels. Panel = bordered elevated surface, 12px radius, 16px padding.
- Tables: sticky header, 36px rows, right-aligned numbers, status cells with a dot and label, row hover, keyboard row focus, column visibility, server-side pagination.

## Components (own implementation on Radix primitives)
Button, IconButton, Badge, StatusDot, Panel, StatPanel, DataTable, Dialog, Sheet, DropdownMenu, Tabs, Tooltip, Input, Select, Textarea, Switch, Combobox, CommandPalette, Toast, EmptyState, Skeleton, Timeline, KeyValue, CodeBlock, Diff, Breadcrumbs, PageHeader.

## Motion
150ms ease-out for hover and open states; 200ms for sheets. Nothing loops. Live Activity rows fade in, no bounce.

## Rules
- Every control works, is disabled with a tooltip reason, or does not exist.
- Synthetic data is labelled with a "Demo data" badge wherever it appears.
- Status language: Allowed, Denied, Approval required, Approved, Rejected, Expired, Executed, Failed.
- Tamper-evident, not immutable. Signals, not guarantees.
