# Architecture: Crypto Deposit & Managed Yield Platform

**Stack:** React (Vite + TypeScript) · Supabase (Postgres, Auth, RLS, Edge Functions, Realtime, Storage) · licensed custodian · KYC provider

**What it does:** Users deposit crypto (and later fiat). They see their balance and the value of their holdings in real time. The organisation runs trading strategies with the pooled funds and passes the results back to users as yield.

---

## 1. Design principles (read these first)

These rules are what separate a real investment platform from a fake one. They also protect the business in audits, disputes and licensing reviews.

1. **Balances are never typed in.** A user's balance is the sum of immutable ledger entries. Every credit points to something verifiable outside the database: an on-chain transaction hash, a custodian event ID, or a published yield distribution backed by a reconciled report.
2. **Yield comes from measured performance, not a promised rate.** Use fund-style accounting (units × NAV). When the desk loses money, NAV goes down. A fixed "guaranteed 2% daily" is the signature of a Ponzi scheme, and regulators treat it that way.
3. **Customer money is held by a custodian, not in a hot wallet the team controls.** The platform tells the custodian what to do. It doesn't hold keys.
4. **No single person can move money or change NAV.** Withdrawals over a threshold and every NAV publication need approval from two different staff roles.
5. **Withdrawals are always possible.** Users only ever pay the network fee and a published platform fee. Nobody asks for "taxes" or "unlock fees". Lock-up periods, if any, are shown before deposit.
6. **Reconcile every day.** What we owe users (ledger) must be ≤ what the custodian and exchanges hold. Any shortfall raises an alert and blocks new NAV publications.

---

## 2. High-level system

```
┌────────────────────┐      ┌───────────────────────────── Supabase ─────────────────────────────┐
│  React web app     │      │                                                                    │
│  (user portal)     │─────▶│  Auth (email/OTP + TOTP 2FA)                                       │
└────────────────────┘      │  Postgres  ── ledger, accounts, NAV, withdrawals, audit (RLS on)   │
┌────────────────────┐      │  Realtime  ── balance / tx updates pushed to clients               │
│  React admin app   │─────▶│  Storage   ── KYC docs (private bucket), monthly statements        │
│  (ops / finance)   │      │  Edge Functions ── all money-moving logic (service role only)      │
└────────────────────┘      │  pg_cron   ── reconciliation, NAV snapshot, statement jobs         │
                            └───────┬───────────────┬──────────────────┬─────────────────────────┘
                                    │ webhooks/API  │                  │
                     ┌──────────────▼───┐   ┌───────▼────────┐  ┌──────▼──────────────┐
                     │ Custodian         │   │ KYC / AML       │  │ Exchange / broker   │
                     │ (Fireblocks,      │   │ (Sumsub, Persona│  │ APIs (read-only key │
                     │  BitGo, Coinbase  │   │  + Chainalysis/ │  │  for reconciliation)│
                     │  Prime, Copper)   │   │  TRM screening) │  │                     │
                     └───────────────────┘   └─────────────────┘  └─────────────────────┘
```

**Why split two frontends:** the admin app gets its own deployment, its own domain and IP allow-listing. Staff accounts need mandatory hardware-key or TOTP 2FA.

---

## 3. Core money flows

### 3.1 Deposit
1. User finishes KYC (status `approved`) → Edge Function `create-deposit-address` asks the custodian for a deposit address per user per asset/network and stores it in `deposit_addresses`.
2. User sends funds. The custodian sends a webhook to `custodian-webhook` (check the signature, store the raw payload in `webhook_events`, process idempotently by `external_id`).
3. Once confirmations reach the threshold, run the AML screen (Chainalysis/TRM). If it's clean, post ledger entries:
   - `DR custodian_assets:{asset}` / `CR user_cash:{user}:{asset}`
4. Realtime pushes the new balance to the user. A pending deposit shows its confirmation count until it settles.

### 3.2 Subscribe to a strategy (invest)
1. User picks a strategy (e.g. "Market-neutral USDT") and an amount.
2. `subscribe` function: units = amount ÷ latest published NAV. Ledger:
   - `DR user_cash:{user}:USDT` / `CR user_units:{user}:{strategy}`, and the matching movement into `strategy_pool:{strategy}`
3. Subscriptions requested after the daily cut-off use the next NAV (stops people trading on stale prices).

### 3.3 Trading desk & NAV (where the yield comes from)
1. Treasury moves pool funds from the custodian to trading venues. Every transfer is a ledger entry plus a custodian transaction ID.
2. Daily job `snapshot-holdings` pulls balances from the custodian and the exchange APIs using read-only keys, then writes `holdings_snapshots`.
3. Finance drafts the NAV: (holdings value − fees − liabilities) ÷ units outstanding. It's stored in `nav_reports` as `draft`, with the snapshot IDs attached.
4. A second approver from a different role publishes it. Users' displayed value = units × published NAV. Gains and losses show up automatically, with no manual "interest credits".
5. Management and performance fees are taken as ledger entries at the documented rates (e.g. 1% / 20% above a high-water mark).

> If you insist on a "fixed-interest savings product", that's a lending product. It needs a lending licence, a separate legal entity and a reserve fund, and interest has to be accrued by a job from the published rate, never credited by hand. Start with NAV.

### 3.4 Withdrawal
1. User redeems units → cash (next NAV), then requests a withdrawal to an address they whitelisted 24h earlier (protects against stolen accounts).
2. Ledger: `DR user_cash` / `CR pending_withdrawals`. Funds are reserved immediately.
3. Risk checks: velocity, new device, address screening. Above the threshold, it needs ops approval and then a second approver.
4. `execute-withdrawal` → custodian payout API → webhook confirms → `DR pending_withdrawals` / `CR custodian_assets`.

---

## 4. Database schema (Postgres / Supabase)

```sql
-- Identity
profiles(id uuid pk references auth.users, tenant_id, full_name, country, kyc_status, risk_tier, created_at)
kyc_cases(id, user_id, provider, provider_ref, status, reviewed_by, reviewed_at)
staff_roles(user_id, tenant_id, role)          -- support | ops | finance | compliance | admin

-- Assets & addresses
assets(code pk, network, decimals, custodian_asset_id, enabled)
deposit_addresses(id, user_id, asset_code, address, custodian_ref, created_at)
withdrawal_addresses(id, user_id, asset_code, address, label, verified_at, usable_after)

-- Double-entry ledger (append-only)
ledger_accounts(id, tenant_id, owner_user_id null, type, asset_code, strategy_id null)
  -- type: user_cash | user_units | strategy_pool | custodian_assets | pending_withdrawals | fees | ...
journal_entries(id, tenant_id, kind, external_ref, created_by, approved_by, created_at, memo)
  -- kind: deposit | subscribe | redeem | withdrawal | fee | treasury_transfer | nav_adjust
  -- external_ref UNIQUE where not null → idempotency
ledger_lines(id, journal_id, account_id, amount numeric(38,18), created_at)
  -- constraint trigger: sum(amount) per journal_id = 0

-- Strategies & NAV
strategies(id, tenant_id, name, base_asset, mgmt_fee_bps, perf_fee_bps, lockup_days, cutoff_utc, status)
holdings_snapshots(id, strategy_id, source, raw jsonb, total_value, taken_at)
nav_reports(id, strategy_id, nav_per_unit, units_outstanding, snapshot_ids uuid[],
            status, drafted_by, approved_by, published_at)   -- check drafted_by <> approved_by

-- Operations
deposits(id, user_id, asset_code, tx_hash, amount, confirmations, aml_status, status, journal_id)
withdrawals(id, user_id, asset_code, address_id, amount, fee, status,
            approved_by_1, approved_by_2, custodian_ref, tx_hash, journal_id)
webhook_events(id, source, external_id unique, payload jsonb, processed_at, error)
reconciliation_runs(id, run_at, ledger_total, custody_total, diff, status)
audit_log(id, actor_id, action, entity, entity_id, before jsonb, after jsonb, ip, at)

-- Read model
create view account_balances as
  select account_id, sum(amount) as balance from ledger_lines group by account_id;
```

**Hard guarantees enforced in the database, not the UI:**
- `ledger_lines`, `journal_entries`, `audit_log`: a trigger raises an error on `UPDATE`/`DELETE`. Corrections are reversing entries.
- Only the `service_role` (Edge Functions) can insert into ledger tables. RLS denies writes to every client role, admins included.
- `numeric(38,18)` for amounts. Never JavaScript floats. Use `decimal.js` / `bignumber.js` on the frontend.

---

## 5. Row Level Security

| Table | User | Support | Ops | Finance | Compliance |
|---|---|---|---|---|---|
| profiles | own row | read | read | – | read/write kyc fields |
| account_balances / ledger | own accounts | read | read | read | read |
| deposits / withdrawals | own | read | read + approve | read | read + hold |
| nav_reports | published only | read | – | draft/approve* | read |
| audit_log | – | – | – | – | read |

\* draft and approve must be different people (check constraint + function check).

Example:
```sql
create policy "own balances" on ledger_accounts for select
  using (owner_user_id = auth.uid());
```

---

## 6. Edge Functions

| Function | Trigger | Notes |
|---|---|---|
| `custodian-webhook` | custodian | verify HMAC, idempotent on `external_id` |
| `kyc-webhook` | KYC provider | updates `kyc_status`; deposits locked until approved |
| `create-deposit-address` | user | KYC-gated |
| `subscribe` / `redeem` | user | queued to next NAV after cut-off |
| `request-withdrawal` | user | 2FA re-prompt, whitelist + cool-down |
| `approve-withdrawal` / `execute-withdrawal` | staff | dual approval above threshold |
| `snapshot-holdings` | pg_cron daily | read-only exchange/custody keys |
| `draft-nav` / `publish-nav` | finance | publish blocked if latest reconciliation failed |
| `reconcile` | pg_cron hourly/daily | alerts (Slack/email) on any shortfall |
| `generate-statements` | pg_cron monthly | PDF to private Storage bucket |

All secrets (custodian API keys, webhook secrets) live in Supabase secrets, never in the React bundle.

---

## 7. Frontend (React)

```
apps/
  web/                    # user portal
    src/
      features/auth/      # sign-up, OTP, TOTP enrolment
      features/kyc/       # embedded provider SDK
      features/wallet/    # balances, deposit address + QR, tx history
      features/invest/    # strategies, factsheet, NAV chart, subscribe/redeem
      features/withdraw/  # address book, request, status
      features/statements/
      lib/supabase.ts     # anon key only
      lib/money.ts        # decimal helpers
  admin/                  # staff console (separate deploy, IP allow-list)
    src/features/{kyc-review,withdrawal-queue,nav,reconciliation,audit}
packages/
  ui/                     # shared components (shadcn/ui + Tailwind)
  types/                  # generated: supabase gen types typescript
supabase/
  migrations/  functions/  seed.sql
```

- **State/data:** TanStack Query + Supabase Realtime subscriptions on `deposits`, `withdrawals` and `account_balances`.
- **Key user screens:** Dashboard (total value, P&L since deposit, per-strategy cards), Deposit (address + QR + network warning), Strategy page (past NAV chart, fees, risks, lock-up), Activity, Withdraw, Statements, Security (2FA, devices, address book).
- **Transparency page (public):** latest proof of reserves (custodian attestation vs total liabilities) and NAV history. It's a strong selling point and proves the balances are real.

---

## 8. Multi-tenancy (selling to international clients)

If you sell this as white-label software to other firms:
- `tenant_id` on every table, enforced in RLS through a JWT claim. Or run one Supabase project per client for stronger isolation and simpler data residency (recommended for regulated clients).
- Theming, domain, strategies, fees and supported assets configured per tenant.
- **Each client operates under its own licences and its own custodian account.** You sell the software. They're the regulated operator. Put that in the licence agreement and make onboarding require proof of licensing.

---

## 9. Compliance (not optional for this model)

Taking deposits and paying returns from trading done by the organisation is legally a **collective investment scheme / security** in almost every jurisdiction (e.g. the Howey test in the US). Expect to need:
- **Crypto/VASP registration:** EU MiCA CASP, UK FCA, US FinCEN MSB + state licences, Dubai VARA, etc.
- **Investment/fund licence** for running the pooled strategy (or a structure with a licensed fund manager).
- **KYC/AML programme:** identity checks, sanctions screening, transaction monitoring, Travel Rule, SAR reporting.
- **Marketing rules:** no guaranteed returns, show past performance with risk warnings, no paying for referrals with "levels".
- **Independent audit** of the fund and regular proof-of-reserves attestations.

Talk to a fintech lawyer in your target market before taking real money. The architecture above is built so you can pass that review.

---

## 10. Delivery phases

| Phase | Scope |
|---|---|
| **0 – Foundations** | Supabase project, auth + 2FA, schema + immutability triggers, RLS, CI, typed client |
| **1 – Wallet MVP** | KYC, deposit addresses (custodian sandbox/testnet), webhook → ledger, balances, history, withdrawals with dual approval |
| **2 – Strategies** | strategies, subscribe/redeem, holdings snapshots, NAV draft/publish, NAV charts |
| **3 – Ops & trust** | reconciliation + alerts, admin console, statements, public transparency page |
| **4 – White-label** | tenant config, theming, per-tenant deploy scripts |

Build and test Phases 0–2 entirely on **testnets / custodian sandbox** before touching real funds.
