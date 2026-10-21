# UI Context (design system as data)

Source of truth: `packages/shared/src/theme.css`. Change values there, not in components.

## Color tokens

| Token | Light | Dark |
|---|---|---|
| `--bg` | `#f4f6fb` | `#0b1120` |
| `--surface` | `#ffffff` | `#111a2e` |
| `--border` | `#e3e8f2` | `#1f2a44` |
| `--text` | `#0f172a` | `#e2e8f0` |
| `--muted` | `#64748b` | `#94a3b8` |
| `--brand` | `#1d4ed8` | `#3b82f6` |
| `--brand-strong` | `#1e3a8a` | `#60a5fa` |
| `--positive` | `#15803d` | `#4ade80` |
| `--negative` | `#b91c1c` | `#f87171` |
| `--hero-from` → `--hero-to` | `#0b1f4d` → `#1d4ed8` | `#0b1f4d` → `#1e40af` |

Dark mode follows `prefers-color-scheme`.

Status badges (`apps/web/src/components/StatusBadge.tsx`): green = credited/completed,
blue = approved/sending, amber = confirming/screening/awaiting approval,
orange = under review/delayed, red = rejected, slate = cancelled.

## Typography

System stack: `Inter, 'Segoe UI', system-ui, sans-serif`. Page titles `text-xl
font-semibold`, hero balance `text-3xl font-bold tabular-nums`, meta text `text-xs` muted.
Amounts always use `tabular-nums`.

## Components (CSS classes in theme.css)

`.card` (16px radius, 20px padding, border), `.btn-primary`, `.btn-link`, `.field`
(label + input), `.hero` (gradient banner), `.muted`, `.error`, `.positive`,
`.negative`, `.auth-shell` / `.auth-card`.

## Layout

- Portal: `max-w-5xl`, white header with tabs (Overview, Activity, Deposit, Withdraw, Invest).
- Console: `max-w-6xl`, gradient header with tabs.
- Mobile first: 16px side gutter (`px-4`), grids collapse to one column, tables sit
  in `overflow-x-auto`.

## Copy rules

- Plain language, and always show risk wording near returns ("returns are not guaranteed").
- Never promise yields, never use "guaranteed", "risk-free", "daily profit".
- Status words for users: "under review" (not "held"), "delayed" (not "failed").
