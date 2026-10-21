-- =============================================================================
-- Foundation: tenants, profiles, staff roles, assets and the double-entry ledger
--
-- Ledger sign convention (standard double-entry):
--   amount > 0  = debit,  amount < 0 = credit
--   Platform asset accounts (custodian_assets, ...) are debit-normal.
--   What the platform owes users (user_cash, user_units) is credit-normal,
--   so a user's displayed balance is the NEGATED sum of their lines.
--   Every journal must sum to zero per asset.
--
-- Invariants enforced here (not in the UI):
--   * journal_entries / ledger_lines / audit_log are append-only
--   * only service_role (Edge Functions) can post journals
--   * no client role can insert/update/delete ledger rows, staff included
-- =============================================================================


-- ---------------------------------------------------------------- enums ------
create type public.kyc_status as enum ('not_started', 'pending', 'approved', 'rejected');
create type public.staff_role as enum ('support', 'ops', 'finance', 'compliance', 'admin');
create type public.ledger_account_type as enum (
  'user_cash',            -- user's spendable balance (credit-normal)
  'user_units',           -- user's strategy units (credit-normal)
  'units_issued',         -- contra account for units in circulation
  'strategy_pool',        -- cash allocated to a strategy
  'custodian_assets',     -- what the custodian holds for us (debit-normal)
  'pending_withdrawals',  -- reserved for payouts in flight
  'fees',                 -- platform revenue
  'treasury'              -- funds at trading venues
);
create type public.journal_kind as enum (
  'deposit', 'subscribe', 'redeem', 'withdrawal', 'withdrawal_reversal',
  'fee', 'treasury_transfer', 'correction'
);

-- -------------------------------------------------------------- tenants ------
create table public.tenants (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name       text not null,
  created_at timestamptz not null default now()
);

insert into public.tenants (slug, name) values ('default', 'Default tenant');

-- ------------------------------------------------------------- profiles ------
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  tenant_id  uuid not null references public.tenants (id),
  full_name  text,
  country    char(2),
  kyc_status public.kyc_status not null default 'not_started',
  created_at timestamptz not null default now()
);
create index on public.profiles (tenant_id);

-- Every new auth user gets a profile in the tenant named in their sign-up
-- metadata (options.data.tenant), falling back to 'default'.
create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t uuid;
begin
  select id into t from tenants
   where slug = coalesce(new.raw_user_meta_data ->> 'tenant', 'default');
  if t is null then
    raise exception 'Unknown tenant %', new.raw_user_meta_data ->> 'tenant';
  end if;
  insert into profiles (id, tenant_id, full_name)
  values (new.id, t, new.raw_user_meta_data ->> 'full_name');
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------- staff roles ------
create table public.staff_roles (
  user_id    uuid not null references auth.users (id) on delete cascade,
  tenant_id  uuid not null references public.tenants (id),
  role       public.staff_role not null,
  granted_by uuid references auth.users (id),
  granted_at timestamptz not null default now(),
  primary key (user_id, tenant_id, role)
);

create function public.has_role(p_tenant uuid, variadic p_roles public.staff_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from staff_roles
     where user_id = auth.uid() and tenant_id = p_tenant and role = any (p_roles)
  );
$$;

create function public.my_tenant()
returns uuid language sql stable security definer set search_path = public as $$
  select tenant_id from profiles where id = auth.uid();
$$;

-- --------------------------------------------------------------- assets ------
create table public.assets (
  code      text primary key check (code ~ '^[A-Z0-9-]{2,32}$'),
  name      text not null,
  network   text not null,          -- e.g. bitcoin, tron, ethereum, internal
  decimals  int  not null check (decimals between 0 and 18),
  is_unit   boolean not null default false,  -- strategy units, not a real coin
  enabled   boolean not null default true
);

-- --------------------------------------------------------------- ledger ------
create table public.ledger_accounts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id),
  type          public.ledger_account_type not null,
  asset_code    text not null references public.assets (code),
  owner_user_id uuid references auth.users (id),   -- no cascade: users with history can't vanish
  strategy_id   uuid,                              -- FK added with strategies table
  created_at    timestamptz not null default now(),
  constraint user_accounts_have_owner
    check ((type in ('user_cash', 'user_units')) = (owner_user_id is not null)),
  constraint one_account_per_key
    unique nulls not distinct (tenant_id, type, asset_code, owner_user_id, strategy_id)
);
create index on public.ledger_accounts (owner_user_id);

create table public.journal_entries (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id),
  kind         public.journal_kind not null,
  external_ref text,            -- tx hash / custodian event id / nav report id
  memo         text,
  created_by   uuid references auth.users (id),
  approved_by  uuid references auth.users (id),
  created_at   timestamptz not null default now(),
  constraint external_ref_once unique (tenant_id, kind, external_ref),
  constraint corrections_need_two_people
    check (kind <> 'correction' or (created_by is not null and approved_by is not null
                                     and created_by <> approved_by))
);

create table public.ledger_lines (
  id         bigint generated always as identity primary key,
  journal_id uuid not null references public.journal_entries (id),
  account_id uuid not null references public.ledger_accounts (id),
  amount     numeric(38, 18) not null check (amount <> 0),
  created_at timestamptz not null default now()
);
create index on public.ledger_lines (account_id);
create index on public.ledger_lines (journal_id);

-- Append-only guard used by every immutable table.
create function public.forbid_mutation()
returns trigger language plpgsql as $$
begin
  raise exception '% is append-only; post a reversing entry instead', tg_table_name;
end $$;

create trigger journal_entries_append_only
  before update or delete on public.journal_entries
  for each row execute function public.forbid_mutation();
create trigger journal_entries_no_truncate
  before truncate on public.journal_entries
  for each statement execute function public.forbid_mutation();
create trigger ledger_lines_append_only
  before update or delete on public.ledger_lines
  for each row execute function public.forbid_mutation();
create trigger ledger_lines_no_truncate
  before truncate on public.ledger_lines
  for each statement execute function public.forbid_mutation();

-- Checked at COMMIT, so all lines of a journal are in place first.
create function public.ledger_check_journal()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1
      from ledger_lines l
      join ledger_accounts a on a.id = l.account_id
      join journal_entries j on j.id = l.journal_id
     where l.journal_id = new.journal_id and a.tenant_id <> j.tenant_id
  ) then
    raise exception 'Journal % mixes tenants', new.journal_id;
  end if;

  if exists (
    select 1
      from ledger_lines l
      join ledger_accounts a on a.id = l.account_id
     where l.journal_id = new.journal_id
     group by a.asset_code
    having sum(l.amount) <> 0
  ) then
    raise exception 'Journal % does not balance', new.journal_id;
  end if;
  return null;
end $$;

create constraint trigger ledger_lines_balanced
  after insert on public.ledger_lines
  deferrable initially deferred
  for each row execute function public.ledger_check_journal();

-- Get or create a ledger account. Service role only.
create function public.ensure_ledger_account(
  p_tenant uuid,
  p_type public.ledger_account_type,
  p_asset text,
  p_owner uuid default null,
  p_strategy uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  acc uuid;
begin
  insert into ledger_accounts (tenant_id, type, asset_code, owner_user_id, strategy_id)
  values (p_tenant, p_type, p_asset, p_owner, p_strategy)
  on conflict on constraint one_account_per_key do nothing
  returning id into acc;

  if acc is null then
    select id into acc from ledger_accounts
     where tenant_id = p_tenant and type = p_type and asset_code = p_asset
       and owner_user_id is not distinct from p_owner
       and strategy_id is not distinct from p_strategy;
  end if;
  return acc;
end $$;

-- The ONLY way money moves. Idempotent on (tenant, kind, external_ref).
-- p_lines: [{"account_id": "...", "amount": "123.45"}, ...]
create function public.post_journal(
  p_tenant uuid,
  p_kind public.journal_kind,
  p_external_ref text,
  p_memo text,
  p_lines jsonb,
  p_created_by uuid default null,
  p_approved_by uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  j uuid;
  line jsonb;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'A journal needs at least two lines';
  end if;

  if p_external_ref is not null then
    select id into j from journal_entries
     where tenant_id = p_tenant and kind = p_kind and external_ref = p_external_ref;
    if found then
      return j;  -- already posted (webhook retry)
    end if;
  end if;

  insert into journal_entries (tenant_id, kind, external_ref, memo, created_by, approved_by)
  values (p_tenant, p_kind, p_external_ref, p_memo, p_created_by, p_approved_by)
  returning id into j;

  for line in select * from jsonb_array_elements(p_lines) loop
    insert into ledger_lines (journal_id, account_id, amount)
    values (j, (line ->> 'account_id')::uuid, (line ->> 'amount')::numeric);
  end loop;

  return j;
end $$;

-- ------------------------------------------------------------ audit log ------
create table public.audit_log (
  id        bigint generated always as identity primary key,
  tenant_id uuid,
  actor_id  uuid,
  action    text not null,
  entity    text not null,
  entity_id text,
  before    jsonb,
  after     jsonb,
  at        timestamptz not null default now()
);
create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function public.forbid_mutation();

create function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rec jsonb := to_jsonb(coalesce(new, old));
begin
  insert into audit_log (tenant_id, actor_id, action, entity, entity_id, before, after)
  values (
    (rec ->> 'tenant_id')::uuid,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce(rec ->> 'id', rec ->> 'user_id'),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

create trigger audit_staff_roles
  after insert or update or delete on public.staff_roles
  for each row execute function public.audit_row_change();
create trigger audit_profiles
  after update on public.profiles
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------- read models ------
create view public.user_balances with (security_invoker = true) as
select a.id            as account_id,
       a.owner_user_id as user_id,
       a.type,
       a.asset_code,
       a.strategy_id,
       -coalesce(sum(l.amount), 0)::numeric(38, 18) as balance
  from public.ledger_accounts a
  left join public.ledger_lines l on l.account_id = a.id
 where a.type in ('user_cash', 'user_units')
 group by a.id;

create view public.user_activity with (security_invoker = true) as
select l.id            as line_id,
       j.id            as journal_id,
       j.kind,
       j.external_ref,
       j.memo,
       a.owner_user_id as user_id,
       a.type          as account_type,
       a.asset_code,
       (-l.amount)::numeric(38, 18) as amount,  -- user's perspective: + in, - out
       j.created_at
  from public.ledger_lines l
  join public.journal_entries j on j.id = l.journal_id
  join public.ledger_accounts a on a.id = l.account_id
 where a.type in ('user_cash', 'user_units');

-- Platform-wide balance per account, for staff reconciliation screens.
create view public.account_balances with (security_invoker = true) as
select a.id as account_id, a.tenant_id, a.type, a.asset_code, a.owner_user_id, a.strategy_id,
       coalesce(sum(l.amount), 0)::numeric(38, 18) as balance
  from public.ledger_accounts a
  left join public.ledger_lines l on l.account_id = a.id
 group by a.id;

-- ------------------------------------------------------------ privileges -----
-- Clients get read access only; RLS narrows it further. Writes go through
-- Edge Functions using the service role, except for the explicit grants below.
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
alter default privileges in schema public
  revoke insert, update, delete, truncate on tables from anon, authenticated;

grant update (full_name, country) on public.profiles to authenticated;

revoke execute on function public.post_journal(uuid, public.journal_kind, text, text, jsonb, uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.ensure_ledger_account(uuid, public.ledger_account_type, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.post_journal(uuid, public.journal_kind, text, text, jsonb, uuid, uuid)
  to service_role;
grant execute on function public.ensure_ledger_account(uuid, public.ledger_account_type, text, uuid, uuid)
  to service_role;

-- ------------------------------------------------------------------ RLS ------
alter table public.tenants          enable row level security;
alter table public.profiles         enable row level security;
alter table public.staff_roles      enable row level security;
alter table public.assets           enable row level security;
alter table public.ledger_accounts  enable row level security;
alter table public.journal_entries  enable row level security;
alter table public.ledger_lines     enable row level security;
alter table public.audit_log        enable row level security;

create policy "members read own tenant" on public.tenants for select to authenticated
  using (id = public.my_tenant() or public.has_role(id, 'admin'));

create policy "read own profile" on public.profiles for select to authenticated
  using (id = auth.uid());
create policy "staff read tenant profiles" on public.profiles for select to authenticated
  using (public.has_role(tenant_id, 'support', 'ops', 'compliance', 'admin'));
create policy "update own profile" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "read own roles" on public.staff_roles for select to authenticated
  using (user_id = auth.uid() or public.has_role(tenant_id, 'admin'));

create policy "assets are public" on public.assets for select to anon, authenticated
  using (enabled);

create policy "read own ledger accounts" on public.ledger_accounts for select to authenticated
  using (owner_user_id = auth.uid());
create policy "staff read ledger accounts" on public.ledger_accounts for select to authenticated
  using (public.has_role(tenant_id, 'support', 'ops', 'finance', 'compliance', 'admin'));

create policy "read own ledger lines" on public.ledger_lines for select to authenticated
  using (exists (select 1 from public.ledger_accounts a
                  where a.id = account_id and a.owner_user_id = auth.uid()));
create policy "staff read ledger lines" on public.ledger_lines for select to authenticated
  using (exists (select 1 from public.ledger_accounts a
                  where a.id = account_id
                    and public.has_role(a.tenant_id, 'support', 'ops', 'finance', 'compliance', 'admin')));

create policy "read own journals" on public.journal_entries for select to authenticated
  using (exists (select 1 from public.ledger_lines l
                   join public.ledger_accounts a on a.id = l.account_id
                  where l.journal_id = journal_entries.id and a.owner_user_id = auth.uid()));
create policy "staff read journals" on public.journal_entries for select to authenticated
  using (public.has_role(tenant_id, 'support', 'ops', 'finance', 'compliance', 'admin'));

create policy "compliance and admin read audit log" on public.audit_log for select to authenticated
  using (public.has_role(tenant_id, 'compliance', 'admin'));
