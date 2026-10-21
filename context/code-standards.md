# Code Standards

## General

- TypeScript everywhere (strict, `verbatimModuleSyntax`, so use `import type` for types).
- Match surrounding style: 2-space indent, single quotes, no semicolons (TS/TSX).
- Comments explain *why*, not what. Keep them sparse.

## SQL / Supabase

- One concern per migration file, named `YYYYMMDDHHMMSS_name.sql`. Never edit a
  migration that has been applied; add a new one.
- Every new table: `enable row level security`, explicit `select` policies, and no
  client write grants unless the spec says why.
- Money logic lives in **plpgsql functions** (`security definer set search_path = public`),
  revoked from `public, anon, authenticated` and granted to `service_role`.
- User-facing error messages are `raise exception` text written for users (the Edge
  Function `handler()` passes matching messages through as HTTP 400, see the
  `USER_FACING_PG` regex in `_shared/http.ts`; extend it when adding new messages).
- Status-changing functions lock the row (`for update`) and check the current state first.
- Add PGlite tests in `scripts/test-db.mjs` for every new rule or flow.

## Edge Functions (Deno)

- One folder per endpoint under `supabase/functions/`, shared code in `_shared/`.
- Wrap user endpoints in `handler()`, authenticate with `getCaller(req)` (2FA by
  default), and call SQL functions via `adminClient().rpc(...)` + `must()`.
- Webhooks: read the raw body, verify the HMAC, store it in `webhook_events`, re-fetch
  authoritative data from the provider, and return non-2xx on failure so the provider retries.
- Imports use `npm:` / `jsr:` specifiers. Check with `npx -y deno@2 check` / `deno test`.

## React

- Data access lives in each app's `src/data.ts` (TanStack Query hooks). Pages don't
  call Supabase directly, except for simple RLS-allowed inserts with a comment saying so.
- Edge Function calls go through `callFunction()` from `@app/shared`.
- Prefer simple flat queries plus a second batch query over nested PostgREST embeds
  (`user_id` columns reference `auth.users`, so embeds to `profiles` don't work).
- Money: `dec()` / `formatAmount()` from `@app/shared`. Never `Number()` for arithmetic.
- Styling: Tailwind utilities + the CSS variables in `packages/shared/src/theme.css`.
  No raw hex in components, except the status-badge palette in `StatusBadge.tsx`.

## Files

- Pages: `src/pages/PascalCase.tsx`, components: `src/components/PascalCase.tsx`.
- Shared row types: `packages/shared/src/types.ts` (hand-written until
  `npm run db:types` can run against a live database).
