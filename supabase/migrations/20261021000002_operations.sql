-- =============================================================================
-- Operations: KYC cases, strategies + NAV, deposits, withdrawals, webhooks,
-- holdings snapshots and reconciliation.
-- Status changes happen in Edge Functions (service role); clients only read,
-- except for adding a withdrawal address.
-- =============================================================================

create type public.deposit_status    as enum ('detected', 'confirming', 'screening', 'credited', 'held', 'rejected');
create type public.withdrawal_status as enum ('requested', 'pending_approval', 'approved', 'broadcast', 'completed', 'rejected', 'cancelled', 'failed');
create type public.nav_status        as enum ('draft', 'published', 'rejected');
create type public.strategy_status   as enum ('draft', 'open', 'closed_to_new', 'wound_down');
create type public.recon_status      as enum ('ok', 'shortfall', 'error');

-- ------------------------------------------------------------------ KYC ------
create table public.kyc_cases (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id),
  user_id      uuid not null references auth.users (id) on delete cascade,
  provider     text not null,
  provider_ref text not null,
  status       public.kyc_status not null default 'pending',
  reviewed_by  uuid references auth.users (id),
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (provider, provider_ref)
);

-- ----------------------------------------------------------- strategies ------
create table public.strategies (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id),
  slug          text not null check (slug ~ '^[a-z0-9-]{2,40}$'),
  name          text not null,
  description   text,
  risk_notes    text not null,                 -- shown before every subscription
  base_asset    text not null references public.assets (code),
  unit_asset    text not null references public.assets (code),
  mgmt_fee_bps  int  not null check (mgmt_fee_bps between 0 and 500),
  perf_fee_bps  int  not null check (perf_fee_bps between 0 and 5000),
  lockup_days   int  not null default 0 check (lockup_days >= 0),
  cutoff_utc    time not null default '16:00',
  status        public.strategy_status not null default 'draft',
  created_at    timestamptz not null default now(),
  unique (tenant_id, slug)
);

alter table public.ledger_accounts
  add constraint ledger_accounts_strategy_fk
  foreign key (strategy_id) references public.strategies (id);

create table public.holdings_snapshots (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id),
  strategy_id uuid references public.strategies (id),
  source      text not null,              -- 'custodian:fireblocks', 'exchange:binance', ...
  raw         jsonb not null,             -- untouched API response, for auditors
  total_value numeric(38, 18) not null,
  value_asset text not null references public.assets (code),
  taken_at    timestamptz not null default now()
);
create trigger holdings_snapshots_append_only
  before update or delete on public.holdings_snapshots
  for each row execute function public.forbid_mutation();

create table public.nav_reports (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants (id),
  strategy_id       uuid not null references public.strategies (id),
  valuation_date    date not null,
  nav_per_unit      numeric(38, 18) not null check (nav_per_unit > 0),
  units_outstanding numeric(38, 18) not null check (units_outstanding >= 0),
  gross_assets      numeric(38, 18) not null,
  fees_accrued      numeric(38, 18) not null default 0,
  snapshot_ids      uuid[] not null check (cardinality(snapshot_ids) > 0),
  status            public.nav_status not null default 'draft',
  drafted_by        uuid not null references auth.users (id),
  approved_by       uuid references auth.users (id),
  published_at      timestamptz,
  created_at        timestamptz not null default now(),
  constraint four_eyes check (approved_by is null or approved_by <> drafted_by),
  constraint published_is_approved
    check (status <> 'published' or (approved_by is not null and published_at is not null))
);
create unique index nav_one_published_per_day
  on public.nav_reports (strategy_id, valuation_date) where status = 'published';

-- Published NAVs are final; corrections are a new report + correcting journal.
create function public.nav_reports_lock()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or old.status <> 'draft' then
    raise exception 'NAV report % is %, it can no longer change', old.id, old.status;
  end if;
  return new;
end $$;
create trigger nav_reports_lock
  before update or delete on public.nav_reports
  for each row execute function public.nav_reports_lock();

create view public.latest_nav with (security_invoker = true) as
select distinct on (strategy_id)
       strategy_id, valuation_date, nav_per_unit, units_outstanding, published_at
  from public.nav_reports
 where status = 'published'
 order by strategy_id, valuation_date desc;

-- --------------------------------------------------------------- wallet ------
create table public.deposit_addresses (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id),
  user_id       uuid not null references auth.users (id),
  asset_code    text not null references public.assets (code),
  address       text not null,
  memo_tag      text,                     -- destination tag / memo for chains that need one
  custodian_ref text not null,
  created_at    timestamptz not null default now(),
  unique (asset_code, address, memo_tag)
);

create table public.withdrawal_addresses (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default public.my_tenant() references public.tenants (id),
  user_id      uuid not null default auth.uid() references auth.users (id),
  asset_code   text not null references public.assets (code),
  address      text not null check (length(address) between 10 and 128),
  memo_tag     text,
  label        text check (length(label) <= 60),
  usable_after timestamptz not null default now() + interval '24 hours',  -- anti account-takeover
  screened_ok  boolean,                   -- set by AML screening
  removed_at   timestamptz,
  created_at   timestamptz not null default now()
);

create table public.deposits (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id),
  user_id       uuid not null references auth.users (id),
  asset_code    text not null references public.assets (code),
  address_id    uuid references public.deposit_addresses (id),
  tx_hash       text not null,
  amount        numeric(38, 18) not null check (amount > 0),
  confirmations int not null default 0,
  status        public.deposit_status not null default 'detected',
  aml_result    jsonb,
  journal_id    uuid references public.journal_entries (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (asset_code, tx_hash, address_id),
  constraint credited_has_journal check (status <> 'credited' or journal_id is not null)
);

create table public.withdrawals (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id),
  user_id        uuid not null references auth.users (id),
  asset_code     text not null references public.assets (code),
  address_id     uuid not null references public.withdrawal_addresses (id),
  amount         numeric(38, 18) not null check (amount > 0),
  network_fee    numeric(38, 18) not null default 0 check (network_fee >= 0),
  platform_fee   numeric(38, 18) not null default 0 check (platform_fee >= 0),
  status         public.withdrawal_status not null default 'requested',
  approved_by_1  uuid references auth.users (id),
  approved_by_2  uuid references auth.users (id),
  reject_reason  text,
  custodian_ref  text,
  tx_hash        text,
  reserve_journal_id uuid references public.journal_entries (id),
  settle_journal_id  uuid references public.journal_entries (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint two_different_approvers
    check (approved_by_2 is null or approved_by_2 <> approved_by_1),
  constraint user_cannot_approve_self
    check (approved_by_1 is distinct from user_id and approved_by_2 is distinct from user_id)
);
create index on public.withdrawals (status);

-- ---------------------------------------------------- webhooks / recon -------
create table public.webhook_events (
  id           uuid primary key default gen_random_uuid(),
  source       text not null,           -- 'btcpay', 'fireblocks', 'sumsub', ...
  external_id  text not null,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  error        text,
  unique (source, external_id)
);

create table public.reconciliation_runs (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id),
  asset_code     text not null references public.assets (code),
  ledger_total   numeric(38, 18) not null,   -- what we owe users
  custody_total  numeric(38, 18) not null,   -- what custodian + venues hold
  diff           numeric(38, 18) generated always as (custody_total - ledger_total) stored,
  status         public.recon_status not null,
  details        jsonb,
  run_at         timestamptz not null default now()
);
create trigger reconciliation_runs_append_only
  before update or delete on public.reconciliation_runs
  for each row execute function public.forbid_mutation();

-- ---------------------------------------------------------- audit hooks ------
create trigger audit_strategies  after insert or update on public.strategies
  for each row execute function public.audit_row_change();
create trigger audit_nav_reports after insert or update on public.nav_reports
  for each row execute function public.audit_row_change();
create trigger audit_withdrawals after insert or update on public.withdrawals
  for each row execute function public.audit_row_change();
create trigger audit_withdrawal_addresses after insert or update on public.withdrawal_addresses
  for each row execute function public.audit_row_change();
create trigger audit_kyc_cases   after insert or update on public.kyc_cases
  for each row execute function public.audit_row_change();

-- ------------------------------------------------------------ privileges -----
-- Scoped to this migration's tables: a schema-wide REVOKE would also wipe the
-- column grant on profiles from the foundation migration.
revoke insert, update, delete, truncate on
  public.kyc_cases, public.strategies, public.holdings_snapshots, public.nav_reports,
  public.deposit_addresses, public.withdrawal_addresses, public.deposits, public.withdrawals,
  public.webhook_events, public.reconciliation_runs
  from anon, authenticated;
grant insert (asset_code, address, memo_tag, label) on public.withdrawal_addresses to authenticated;

-- ------------------------------------------------------------------ RLS ------
alter table public.kyc_cases            enable row level security;
alter table public.strategies           enable row level security;
alter table public.holdings_snapshots   enable row level security;
alter table public.nav_reports          enable row level security;
alter table public.deposit_addresses    enable row level security;
alter table public.withdrawal_addresses enable row level security;
alter table public.deposits             enable row level security;
alter table public.withdrawals          enable row level security;
alter table public.webhook_events       enable row level security;  -- service role only
alter table public.reconciliation_runs  enable row level security;

create policy "read own kyc" on public.kyc_cases for select to authenticated
  using (user_id = auth.uid());
create policy "compliance reads kyc" on public.kyc_cases for select to authenticated
  using (public.has_role(tenant_id, 'compliance', 'admin'));

create policy "members see live strategies" on public.strategies for select to authenticated
  using (tenant_id = public.my_tenant() and status in ('open', 'closed_to_new'));
create policy "staff see all strategies" on public.strategies for select to authenticated
  using (public.has_role(tenant_id, 'finance', 'admin', 'ops', 'compliance'));

create policy "finance reads snapshots" on public.holdings_snapshots for select to authenticated
  using (public.has_role(tenant_id, 'finance', 'admin'));

create policy "members see published nav" on public.nav_reports for select to authenticated
  using (status = 'published' and tenant_id = public.my_tenant());
create policy "finance sees all nav" on public.nav_reports for select to authenticated
  using (public.has_role(tenant_id, 'finance', 'admin', 'compliance'));

create policy "read own deposit addresses" on public.deposit_addresses for select to authenticated
  using (user_id = auth.uid());

create policy "read own withdrawal addresses" on public.withdrawal_addresses for select to authenticated
  using (user_id = auth.uid());
create policy "add own withdrawal address" on public.withdrawal_addresses for insert to authenticated
  with check (user_id = auth.uid() and tenant_id = public.my_tenant());
create policy "staff read withdrawal addresses" on public.withdrawal_addresses for select to authenticated
  using (public.has_role(tenant_id, 'ops', 'compliance', 'support', 'admin'));

create policy "read own deposits" on public.deposits for select to authenticated
  using (user_id = auth.uid());
create policy "staff read deposits" on public.deposits for select to authenticated
  using (public.has_role(tenant_id, 'ops', 'compliance', 'support', 'finance', 'admin'));

create policy "read own withdrawals" on public.withdrawals for select to authenticated
  using (user_id = auth.uid());
create policy "staff read withdrawals" on public.withdrawals for select to authenticated
  using (public.has_role(tenant_id, 'ops', 'compliance', 'support', 'finance', 'admin'));

create policy "finance reads reconciliation" on public.reconciliation_runs for select to authenticated
  using (public.has_role(tenant_id, 'finance', 'compliance', 'admin'));

-- Live updates for the user portal.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.deposits, public.withdrawals, public.ledger_lines;
  end if;
end $$;
