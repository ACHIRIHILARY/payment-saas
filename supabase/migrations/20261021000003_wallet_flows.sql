-- =============================================================================
-- Phase 1 wallet flows: KYC status, deposits, withdrawals.
--
-- Each money movement is ONE SQL function so the state change and its ledger
-- journal commit together or not at all. Edge Functions call these with the
-- service role after authenticating the caller; nothing here is granted to
-- client roles.
-- =============================================================================

-- Withdrawals at or below this amount (per asset) need one approver, above it two.
create table public.withdrawal_limits (
  tenant_id             uuid not null references public.tenants (id),
  asset_code            text not null references public.assets (code),
  single_approval_limit numeric(38, 18) not null default 0 check (single_approval_limit >= 0),
  min_amount            numeric(38, 18) not null default 0 check (min_amount >= 0),
  platform_fee          numeric(38, 18) not null default 0 check (platform_fee >= 0),
  primary key (tenant_id, asset_code)
);
alter table public.withdrawal_limits enable row level security;
create policy "members read limits" on public.withdrawal_limits for select to authenticated
  using (tenant_id = public.my_tenant() or public.has_role(tenant_id, 'ops', 'admin'));
revoke insert, update, delete, truncate on public.withdrawal_limits from anon, authenticated;

create function public.staff_has_role(p_user uuid, p_tenant uuid, variadic p_roles public.staff_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff_roles
                  where user_id = p_user and tenant_id = p_tenant and role = any (p_roles));
$$;

-- ------------------------------------------------------------------ KYC ------
create function public.apply_kyc_result(
  p_user uuid, p_provider text, p_provider_ref text, p_status public.kyc_status
) returns void language plpgsql security definer set search_path = public as $$
declare
  t uuid;
begin
  select tenant_id into t from profiles where id = p_user;
  if t is null then raise exception 'Unknown user %', p_user; end if;

  insert into kyc_cases (tenant_id, user_id, provider, provider_ref, status)
  values (t, p_user, p_provider, p_provider_ref, p_status)
  on conflict (provider, provider_ref)
  do update set status = excluded.status, reviewed_at = now();

  update profiles set kyc_status = p_status where id = p_user;
end $$;

-- Manual review from the staff console (e.g. provider returned "needs review").
create function public.review_kyc(p_staff uuid, p_user uuid, p_status public.kyc_status)
returns void language plpgsql security definer set search_path = public as $$
declare
  t uuid;
begin
  select tenant_id into t from profiles where id = p_user;
  if not staff_has_role(p_staff, t, 'compliance', 'admin') then
    raise exception 'Only compliance can review KYC';
  end if;
  if p_status not in ('approved', 'rejected') then
    raise exception 'Review must approve or reject';
  end if;
  update kyc_cases set status = p_status, reviewed_by = p_staff, reviewed_at = now()
   where user_id = p_user and status = 'pending';
  update profiles set kyc_status = p_status where id = p_user;
end $$;

-- -------------------------------------------------------------- deposits -----
-- Called for every payment the custodian reports. Safe to call repeatedly:
-- the deposit row is upserted and the credit is posted at most once.
--   p_settled: custodian says the payment has enough confirmations
--   p_aml_ok:  null = not screened yet, false = flagged (held for compliance)
create function public.record_deposit(
  p_address_id uuid,
  p_payment_ref text,        -- unique per payment, e.g. "<txid>-<vout>"
  p_tx_hash text,
  p_amount numeric,
  p_confirmations int,
  p_settled boolean,
  p_aml_ok boolean default null,
  p_aml_result jsonb default null
) returns public.deposits language plpgsql security definer set search_path = public as $$
declare
  addr deposit_addresses;
  dep  deposits;
  kyc  kyc_status;
  j    uuid;
begin
  select * into addr from deposit_addresses where id = p_address_id;
  if not found then raise exception 'Unknown deposit address %', p_address_id; end if;
  if p_amount <= 0 then raise exception 'Deposit amount must be positive'; end if;

  insert into deposits (tenant_id, user_id, asset_code, address_id, tx_hash, amount, confirmations, status)
  values (addr.tenant_id, addr.user_id, addr.asset_code, addr.id, p_payment_ref, p_amount,
          p_confirmations, 'confirming')
  on conflict (asset_code, tx_hash, address_id)
  do update set confirmations = greatest(deposits.confirmations, excluded.confirmations),
                updated_at = now()
  returning * into dep;

  -- Terminal for automation: credited/rejected are final, held waits for compliance.
  if dep.status in ('credited', 'rejected', 'held') then
    return dep;
  end if;
  if dep.amount <> p_amount then
    raise exception 'Deposit % amount changed from % to %', dep.id, dep.amount, p_amount;
  end if;

  if p_aml_ok is false then
    update deposits set status = 'held', aml_result = p_aml_result, updated_at = now()
     where id = dep.id returning * into dep;
    return dep;
  end if;

  if not p_settled then
    return dep;
  end if;

  if p_aml_ok is null then
    update deposits set status = 'screening', updated_at = now() where id = dep.id returning * into dep;
    return dep;
  end if;

  -- Funds from users who failed KYC are held, not credited.
  select kyc_status into kyc from profiles where id = dep.user_id;
  if kyc is distinct from 'approved' then
    update deposits set status = 'held', aml_result = coalesce(p_aml_result, '{}'::jsonb)
                          || jsonb_build_object('hold_reason', 'kyc_' || coalesce(kyc::text, 'missing')),
                        updated_at = now()
     where id = dep.id returning * into dep;
    return dep;
  end if;

  j := post_journal(
    dep.tenant_id, 'deposit', p_payment_ref, 'On-chain deposit ' || coalesce(p_tx_hash, p_payment_ref),
    jsonb_build_array(
      jsonb_build_object('account_id', ensure_ledger_account(dep.tenant_id, 'custodian_assets', dep.asset_code),
                         'amount', dep.amount),
      jsonb_build_object('account_id', ensure_ledger_account(dep.tenant_id, 'user_cash', dep.asset_code, dep.user_id),
                         'amount', -dep.amount)
    ));

  update deposits set status = 'credited', journal_id = j, aml_result = p_aml_result, updated_at = now()
   where id = dep.id returning * into dep;
  return dep;
end $$;

-- Compliance releases (credit) or rejects a held deposit.
create function public.resolve_held_deposit(p_staff uuid, p_deposit uuid, p_release boolean, p_note text)
returns public.deposits language plpgsql security definer set search_path = public as $$
declare
  dep deposits;
  j   uuid;
begin
  select * into dep from deposits where id = p_deposit for update;
  if not found or dep.status <> 'held' then raise exception 'Deposit is not held'; end if;
  if not staff_has_role(p_staff, dep.tenant_id, 'compliance', 'admin') then
    raise exception 'Only compliance can resolve held deposits';
  end if;

  if not p_release then
    -- Funds stay with the custodian off-ledger until returned to sender manually.
    update deposits set status = 'rejected', updated_at = now(),
           aml_result = coalesce(aml_result, '{}'::jsonb) || jsonb_build_object('resolution', p_note, 'by', p_staff)
     where id = dep.id returning * into dep;
    return dep;
  end if;

  j := post_journal(
    dep.tenant_id, 'deposit', dep.tx_hash, 'Held deposit released: ' || coalesce(p_note, ''),
    jsonb_build_array(
      jsonb_build_object('account_id', ensure_ledger_account(dep.tenant_id, 'custodian_assets', dep.asset_code),
                         'amount', dep.amount),
      jsonb_build_object('account_id', ensure_ledger_account(dep.tenant_id, 'user_cash', dep.asset_code, dep.user_id),
                         'amount', -dep.amount)
    ), p_staff, p_staff);

  update deposits set status = 'credited', journal_id = j, updated_at = now(),
         aml_result = coalesce(aml_result, '{}'::jsonb) || jsonb_build_object('resolution', p_note, 'by', p_staff)
   where id = dep.id returning * into dep;
  return dep;
end $$;

-- ------------------------------------------------------------ withdrawals ----
create function public.cash_balance(p_user uuid, p_asset text)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(-sum(l.amount), 0)
    from ledger_accounts a
    join ledger_lines l on l.account_id = a.id
   where a.owner_user_id = p_user and a.type = 'user_cash' and a.asset_code = p_asset;
$$;

-- Reserves amount + fee immediately so the same funds can't be withdrawn twice.
create function public.request_withdrawal(p_user uuid, p_address uuid, p_amount numeric)
returns public.withdrawals language plpgsql security definer set search_path = public as $$
declare
  prof   profiles;
  addr   withdrawal_addresses;
  lim    withdrawal_limits;
  cash   uuid;
  total  numeric;
  w      withdrawals;
  j      uuid;
begin
  select * into prof from profiles where id = p_user;
  if prof.kyc_status is distinct from 'approved' then
    raise exception 'Identity verification must be approved before withdrawing';
  end if;

  select * into addr from withdrawal_addresses where id = p_address and user_id = p_user and removed_at is null;
  if not found then raise exception 'Unknown withdrawal address'; end if;
  if addr.usable_after > now() then
    raise exception 'This address can be used from %', addr.usable_after;
  end if;
  if addr.screened_ok is false then
    raise exception 'This address failed screening and cannot be used';
  end if;

  select * into lim from withdrawal_limits where tenant_id = prof.tenant_id and asset_code = addr.asset_code;
  if p_amount <= 0 or p_amount < coalesce(lim.min_amount, 0) then
    raise exception 'Amount is below the minimum withdrawal';
  end if;
  total := p_amount + coalesce(lim.platform_fee, 0);

  -- Lock the user's cash account so concurrent requests serialise.
  cash := ensure_ledger_account(prof.tenant_id, 'user_cash', addr.asset_code, p_user);
  perform 1 from ledger_accounts where id = cash for update;
  if cash_balance(p_user, addr.asset_code) < total then
    raise exception 'Insufficient balance';
  end if;

  insert into withdrawals (tenant_id, user_id, asset_code, address_id, amount, platform_fee, status)
  values (prof.tenant_id, p_user, addr.asset_code, addr.id, p_amount, coalesce(lim.platform_fee, 0), 'pending_approval')
  returning * into w;

  j := post_journal(
    w.tenant_id, 'withdrawal', 'reserve:' || w.id, 'Withdrawal reserved',
    jsonb_build_array(
      jsonb_build_object('account_id', cash, 'amount', total),
      jsonb_build_object('account_id', ensure_ledger_account(w.tenant_id, 'pending_withdrawals', w.asset_code),
                         'amount', -total)
    ), p_user);

  update withdrawals set reserve_journal_id = j where id = w.id returning * into w;
  return w;
end $$;

-- Records an approval. Returns the row; status becomes 'approved' once enough
-- distinct approvers have signed off. The payout itself is a separate step.
create function public.approve_withdrawal(p_staff uuid, p_withdrawal uuid)
returns public.withdrawals language plpgsql security definer set search_path = public as $$
declare
  w     withdrawals;
  limit_amt numeric;
begin
  select * into w from withdrawals where id = p_withdrawal for update;
  if not found or w.status <> 'pending_approval' then
    raise exception 'Withdrawal is not awaiting approval';
  end if;
  if not staff_has_role(p_staff, w.tenant_id, 'ops', 'admin') then
    raise exception 'Only operations staff can approve withdrawals';
  end if;
  if p_staff = w.user_id then raise exception 'You cannot approve your own withdrawal'; end if;
  if p_staff = w.approved_by_1 then raise exception 'A second, different approver is required'; end if;

  select single_approval_limit into limit_amt from withdrawal_limits
   where tenant_id = w.tenant_id and asset_code = w.asset_code;

  if w.approved_by_1 is null then
    update withdrawals
       set approved_by_1 = p_staff,
           status = case when w.amount <= coalesce(limit_amt, 0) then 'approved'::withdrawal_status
                         else 'pending_approval'::withdrawal_status end,
           updated_at = now()
     where id = w.id returning * into w;
  else
    update withdrawals set approved_by_2 = p_staff, status = 'approved', updated_at = now()
     where id = w.id returning * into w;
  end if;
  return w;
end $$;

-- Rejection or user cancellation returns the reserved funds.
create function public.reject_withdrawal(p_actor uuid, p_withdrawal uuid, p_reason text)
returns public.withdrawals language plpgsql security definer set search_path = public as $$
declare
  w     withdrawals;
  total numeric;
  is_owner boolean;
begin
  select * into w from withdrawals where id = p_withdrawal for update;
  if not found then raise exception 'Unknown withdrawal'; end if;
  is_owner := p_actor = w.user_id;

  if is_owner then
    if w.status <> 'pending_approval' then raise exception 'This withdrawal can no longer be cancelled'; end if;
  else
    if not staff_has_role(p_actor, w.tenant_id, 'ops', 'compliance', 'admin') then
      raise exception 'Not allowed';
    end if;
    if w.status not in ('pending_approval', 'approved', 'failed') then
      raise exception 'Withdrawal in status % cannot be rejected', w.status;
    end if;
  end if;

  total := w.amount + w.platform_fee;
  perform post_journal(
    w.tenant_id, 'withdrawal_reversal', 'reverse:' || w.id, coalesce(p_reason, 'Withdrawal cancelled'),
    jsonb_build_array(
      jsonb_build_object('account_id', ensure_ledger_account(w.tenant_id, 'pending_withdrawals', w.asset_code),
                         'amount', total),
      jsonb_build_object('account_id', ensure_ledger_account(w.tenant_id, 'user_cash', w.asset_code, w.user_id),
                         'amount', -total)
    ), p_actor);

  update withdrawals
     set status = case when is_owner then 'cancelled'::withdrawal_status else 'rejected'::withdrawal_status end,
         reject_reason = p_reason, updated_at = now()
   where id = w.id returning * into w;
  return w;
end $$;

-- Claim an approved withdrawal for payout (prevents double broadcast if two
-- workers race). Returns null if someone else already claimed it.
create function public.claim_withdrawal_for_payout(p_withdrawal uuid)
returns public.withdrawals language plpgsql security definer set search_path = public as $$
declare
  w withdrawals;
begin
  update withdrawals set status = 'broadcast', updated_at = now()
   where id = p_withdrawal and status = 'approved'
  returning * into w;
  return w;
end $$;

-- Custodian accepted/broadcast the payout: funds have left custody.
create function public.settle_withdrawal(p_withdrawal uuid, p_custodian_ref text, p_tx_hash text, p_network_fee numeric default 0)
returns public.withdrawals language plpgsql security definer set search_path = public as $$
declare
  w withdrawals;
  j uuid;
  lines jsonb;
begin
  select * into w from withdrawals where id = p_withdrawal for update;
  if not found or w.status <> 'broadcast' then raise exception 'Withdrawal is not being paid out'; end if;

  lines := jsonb_build_array(
    jsonb_build_object('account_id', ensure_ledger_account(w.tenant_id, 'pending_withdrawals', w.asset_code),
                       'amount', w.amount + w.platform_fee),
    jsonb_build_object('account_id', ensure_ledger_account(w.tenant_id, 'custodian_assets', w.asset_code),
                       'amount', -w.amount));
  if w.platform_fee > 0 then
    lines := lines || jsonb_build_array(
      jsonb_build_object('account_id', ensure_ledger_account(w.tenant_id, 'fees', w.asset_code),
                         'amount', -w.platform_fee));
  end if;

  -- The miner fee leaves custody too; the platform absorbs it as a cost.
  if coalesce(p_network_fee, 0) > 0 then
    lines := lines || jsonb_build_array(
      jsonb_build_object('account_id', ensure_ledger_account(w.tenant_id, 'fees', w.asset_code),
                         'amount', p_network_fee),
      jsonb_build_object('account_id', ensure_ledger_account(w.tenant_id, 'custodian_assets', w.asset_code),
                         'amount', -p_network_fee));
  end if;

  j := post_journal(w.tenant_id, 'withdrawal', 'settle:' || w.id, 'Withdrawal paid out', lines);

  update withdrawals set status = 'completed', custodian_ref = p_custodian_ref, tx_hash = p_tx_hash,
         network_fee = coalesce(p_network_fee, 0), settle_journal_id = j, updated_at = now()
   where id = w.id returning * into w;
  return w;
end $$;

-- Payout call failed before funds moved: back to a state ops can retry or reject.
create function public.fail_withdrawal(p_withdrawal uuid, p_error text)
returns public.withdrawals language plpgsql security definer set search_path = public as $$
declare
  w withdrawals;
begin
  update withdrawals set status = 'failed', reject_reason = left(p_error, 500), updated_at = now()
   where id = p_withdrawal and status = 'broadcast'
  returning * into w;
  return w;
end $$;

create function public.retry_withdrawal(p_staff uuid, p_withdrawal uuid)
returns public.withdrawals language plpgsql security definer set search_path = public as $$
declare
  w withdrawals;
begin
  select * into w from withdrawals where id = p_withdrawal for update;
  if not found or w.status <> 'failed' then raise exception 'Only failed withdrawals can be retried'; end if;
  if not staff_has_role(p_staff, w.tenant_id, 'ops', 'admin') then raise exception 'Not allowed'; end if;
  update withdrawals set status = 'approved', reject_reason = null, updated_at = now()
   where id = w.id returning * into w;
  return w;
end $$;

-- ------------------------------------------------------------- privileges ----
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'staff_has_role(uuid, uuid, public.staff_role[])',
    'apply_kyc_result(uuid, text, text, public.kyc_status)',
    'review_kyc(uuid, uuid, public.kyc_status)',
    'record_deposit(uuid, text, text, numeric, int, boolean, boolean, jsonb)',
    'resolve_held_deposit(uuid, uuid, boolean, text)',
    'cash_balance(uuid, text)',
    'request_withdrawal(uuid, uuid, numeric)',
    'approve_withdrawal(uuid, uuid)',
    'reject_withdrawal(uuid, uuid, text)',
    'claim_withdrawal_for_payout(uuid)',
    'settle_withdrawal(uuid, text, text, numeric)',
    'fail_withdrawal(uuid, text)',
    'retry_withdrawal(uuid, uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end $$;

-- KYC decisions show up live in the portal.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;
