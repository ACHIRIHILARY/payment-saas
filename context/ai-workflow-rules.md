# Payment SaaS: AI Workflow Rules

How to work on this project, session to session. Read this first, then
`progress-tracker.md` for where things stand.

## Execution rhythm (per feature, in order)

1. **Check real facts before coding against them.** Grep the migrations, SQL function
   signatures, enum values, env vars and provider payloads. One grep beats a
   wrong guess.
2. **Write the feature spec** `context/feature-specs/NN-name.md`: what, why, acceptance
   checks, and an explicit **Deferred** section.
3. **Implement.**
4. **Verify** (policy below).
5. **Update `progress-tracker.md`**: a real Completed paragraph (files, decisions,
   deferrals), plus Current Phase/Goal and Next Up.
6. **Commit** with a message explaining why. **Push only after the user confirms**
   (remote: `origin` → github.com/ACHIRIHILARY/payment-saas).
7. **Decide or ask what's next.**

## Progressive spec-writing

Specs 01 and 02 were written after the fact, when this folder was adopted. From
Feature 03 on, write each spec only when starting that feature, after the previous
one is done and the tracker is updated. Never write the whole backlog up front.

## Verification policy

- During development, check the **running dev server** (`preview_start` web/admin via
  `.claude/launch.json`, then console, logs and page text), not `npm run build` after
  every edit. Run the build/type-check once when a feature is complete.
- Database changes: `npm run test:db` must pass (it's cheap, no Docker).
- Edge Functions: `npx -y deno@2 check supabase/functions/*/index.ts` and `deno test`.
- If the user asks to skip or batch checks, comply, write extra-careful code, and flag
  the unverified features in the tracker.
- Code that talks to a live provider (BTCPay, Sumsub, Chainalysis) is "unverified
  against live service" until it has run on testnet/sandbox. Say so plainly.

## When to ask vs. just decide

Ask one short question for a real fork with different scope or cost (which feature
next, which custodian). Decide small implementation choices yourself.

## Scope discipline

Cut scope on big features deliberately, and record the cuts under Deferred.

## When something looks off

Run `git status` before assuming a bug. It may be uncommitted work from an earlier
session. Reconcile, don't clobber.

## Ambiguous deletions

Confirm scope first. If you over-delete before committing, use `git checkout HEAD -- <paths>`.

## Security and correctness are never deferred

This system moves money. A gap found mid-feature (a missing signature check, a missing
row lock, a client write grant, an un-audited staff action) is fixed immediately and
gets a test. Never weaken an invariant from `architecture-context.md` to make a
feature easier. Refuse features that recreate scam patterns (editable balances,
guaranteed returns, unlock fees).

## Token efficiency

Don't re-read files already known in this session. Take the direct path. When a tool
fights back, switch to a simpler approach quickly.

## External-service hand-holding

The user is **not experienced with Supabase**, and is new to BTCPay and Sumsub. For any
feature touching these, walk through every dashboard step: what to click/enter, why
this feature needs it, and why it's the right way (explain the concept the first time
it comes up). Never ask for secrets in chat. Give the exact CLI command or dashboard
field instead.

- **Supabase**: project creation, API keys (anon vs service role, and why the browser
  only gets anon), Auth email template with `{{ .Token }}`, MFA settings, Edge Function
  secrets (`supabase secrets set --env-file`), running migrations, Realtime, logs. The
  MCP connector should point at a dev project only.
- **BTCPay Server**: testnet instance, store, hot wallet, API key permissions, webhook
  + secret, payment method id (`BTC-CHAIN` vs `BTC`).
- **Sumsub**: sandbox vs production keys, verification level, webhook + secret.
- **GitHub**: Actions secrets if CI ever needs them; branch protection before collaborators join.

## Related files

- `project-overview.md`: what/why
- `architecture-context.md`: stack, boundaries, invariants
- `code-standards.md`: conventions
- `ui-context.md`: design tokens
- `feature-specs/NN-name.md`: one per feature, written progressively
- `progress-tracker.md`: live state, read every session
