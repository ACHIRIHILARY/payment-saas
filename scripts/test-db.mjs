// Applies the migrations + seed to an in-memory Postgres (PGlite) with a
// minimal stand-in for Supabase's auth schema, then checks the ledger
// invariants and RLS rules. No Docker or Supabase CLI needed.
//
//   npm run test:db
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const db = new PGlite()

const AUTH_STUB = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`

let passed = 0
let failed = 0
async function test(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    failed++
    console.log(`  ✗ ${name}\n      ${e.message}`)
  }
}
async function expectError(sql, pattern, params) {
  try {
    await (params ? db.query(sql, params) : db.exec(sql))
  } catch (e) {
    if (pattern && !pattern.test(e.message)) throw new Error(`wrong error: ${e.message}`)
    return
  }
  throw new Error('expected an error, got success')
}
const one = async (sql, params) => (await db.query(sql, params)).rows[0]

async function asUser(uid, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`)
  }
}

console.log('Applying migrations')
await db.exec(AUTH_STUB)
const migDir = join(root, 'supabase', 'migrations')
for (const f of readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
  try {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  } catch (e) {
    console.error(`  failed ${f}: ${e.message}${e.where ? `
    at ${e.where}` : ''}`)
    process.exit(1)
  }
  console.log(`  applied ${f}`)
}
await db.exec(readFileSync(join(root, 'supabase', 'seed.sql'), 'utf8'))

console.log('\nTests')
const alice = (await one(`insert into auth.users (email, raw_user_meta_data) values ('alice@test', '{"full_name":"Alice"}') returning id`)).id
const bob = (await one(`insert into auth.users (email) values ('bob@test') returning id`)).id
const ops1 = (await one(`insert into auth.users (email) values ('ops1@test') returning id`)).id
const fin1 = (await one(`insert into auth.users (email) values ('fin1@test') returning id`)).id
const tenant = (await one(`select id from tenants where slug = 'default'`)).id
await db.query(`insert into staff_roles (user_id, tenant_id, role) values ($1, $3, 'ops'), ($2, $3, 'finance')`, [ops1, fin1, tenant])

await test('sign-up creates a profile in the default tenant', async () => {
  const p = await one(`select tenant_id, full_name from profiles where id = $1`, [alice])
  if (p.tenant_id !== tenant || p.full_name !== 'Alice') throw new Error(JSON.stringify(p))
})

await test('sign-up with an unknown tenant is rejected', () =>
  expectError(`insert into auth.users (email, raw_user_meta_data) values ('x@test', '{"tenant":"nope"}')`, /Unknown tenant/))

let custody, aliceCash, depositJournal
await test('balanced deposit journal posts and shows on the user balance', async () => {
  custody = (await one(`select ensure_ledger_account($1, 'custodian_assets', 'USDT-TRON') as id`, [tenant])).id
  aliceCash = (await one(`select ensure_ledger_account($1, 'user_cash', 'USDT-TRON', $2) as id`, [tenant, alice])).id
  const again = (await one(`select ensure_ledger_account($1, 'user_cash', 'USDT-TRON', $2) as id`, [tenant, alice])).id
  if (again !== aliceCash) throw new Error('ensure_ledger_account is not idempotent')
  depositJournal = (await one(
    `select post_journal($1, 'deposit', 'tx-abc', 'test deposit', $2::jsonb) as id`,
    [tenant, JSON.stringify([{ account_id: custody, amount: '250.5' }, { account_id: aliceCash, amount: '-250.5' }])],
  )).id
  const b = await one(`select balance from user_balances where account_id = $1`, [aliceCash])
  if (Number(b.balance) !== 250.5) throw new Error(`balance ${b.balance}`)
})

await test('webhook retry with same external_ref does not double-credit', async () => {
  const id = (await one(
    `select post_journal($1, 'deposit', 'tx-abc', 'retry', $2::jsonb) as id`,
    [tenant, JSON.stringify([{ account_id: custody, amount: '250.5' }, { account_id: aliceCash, amount: '-250.5' }])],
  )).id
  const b = await one(`select balance from user_balances where account_id = $1`, [aliceCash])
  if (id !== depositJournal || Number(b.balance) !== 250.5) throw new Error(`balance ${b.balance}`)
})

await test('unbalanced journal is rejected at commit', async () => {
  const lines = JSON.stringify([{ account_id: custody, amount: '100' }, { account_id: aliceCash, amount: '-90' }])
  try {
    await expectError(
      `begin; select post_journal('${tenant}', 'deposit', 'tx-bad', null, '${lines}'::jsonb); commit;`,
      /does not balance/,
    )
  } finally {
    await db.exec('rollback').catch(() => {})
  }
})

await test('ledger lines cannot be edited', () => expectError(`update ledger_lines set amount = 1000000`, /append-only/))
await test('ledger lines cannot be deleted', () => expectError(`delete from ledger_lines`, /append-only/))
await test('journals cannot be truncated', () => expectError(`truncate journal_entries cascade`, /append-only/))

await test('a correction needs two different people', () =>
  expectError(
    `select post_journal($1, 'correction', 'c1', null, $2::jsonb, $3, $3)`,
    /corrections_need_two_people/,
    [tenant, JSON.stringify([{ account_id: custody, amount: '1' }, { account_id: aliceCash, amount: '-1' }]), ops1],
  ))

await test('user sees own balance and activity', () =>
  asUser(alice, async () => {
    const rows = (await db.query(`select balance from user_balances`)).rows
    const act = (await db.query(`select amount, kind from user_activity`)).rows
    if (rows.length !== 1 || Number(rows[0].balance) !== 250.5) throw new Error(JSON.stringify(rows))
    if (act.length !== 1 || act[0].kind !== 'deposit' || Number(act[0].amount) !== 250.5) throw new Error(JSON.stringify(act))
  }))

await test("user cannot see another user's balances", () =>
  asUser(bob, async () => {
    const rows = (await db.query(`select * from user_balances`)).rows
    const lines = (await db.query(`select * from ledger_lines`)).rows
    if (rows.length || lines.length) throw new Error('leak')
  }))

await test('user cannot call post_journal', () =>
  asUser(alice, () =>
    expectError(
      `select post_journal('${tenant}', 'deposit', 'tx-evil', null, '[]'::jsonb)`,
      /permission denied/,
    )))

await test('user cannot insert ledger lines directly', () =>
  asUser(alice, () =>
    expectError(
      `insert into ledger_lines (journal_id, account_id, amount) values ('${depositJournal}', '${aliceCash}', -1)`,
      /permission denied/,
    )))

await test('staff (ops) can read balances but still cannot write the ledger', () =>
  asUser(ops1, async () => {
    const rows = (await db.query(`select * from account_balances`)).rows
    if (rows.length < 2) throw new Error('ops should see tenant accounts')
    await expectError(`insert into journal_entries (tenant_id, kind) values ('${tenant}', 'deposit')`, /permission denied/)
  }))

await test('user cannot change own KYC status', () =>
  asUser(alice, () => expectError(`update profiles set kyc_status = 'approved' where id = auth.uid()`, /permission denied/)))

await test('user can update own name', () =>
  asUser(alice, async () => {
    await db.query(`update profiles set full_name = 'Alice A.' where id = auth.uid()`)
  }))

await test('withdrawal address gets a 24h cool-down the user cannot override', () =>
  asUser(alice, async () => {
    await db.query(`insert into withdrawal_addresses (asset_code, address, label) values ('USDT-TRON', 'TXyz1234567890abcdef', 'my wallet')`)
    const r = await one(`select usable_after > now() + interval '23 hours' as ok, user_id from withdrawal_addresses`)
    if (!r.ok || r.user_id !== alice) throw new Error(JSON.stringify(r))
    await expectError(
      `insert into withdrawal_addresses (asset_code, address, usable_after) values ('USDT-TRON', 'TXyz1234567890zzzz', now())`,
      /permission denied/,
    )
  }))

await test('NAV cannot be approved by the person who drafted it', async () => {
  const strat = (await one(`select id from strategies limit 1`)).id
  const snap = (await one(
    `insert into holdings_snapshots (tenant_id, strategy_id, source, raw, total_value, value_asset)
     values ($1, $2, 'test', '{}', 1000, 'USDT-TRON') returning id`, [tenant, strat])).id
  const nav = (await one(
    `insert into nav_reports (tenant_id, strategy_id, valuation_date, nav_per_unit, units_outstanding, gross_assets, snapshot_ids, drafted_by)
     values ($1, $2, current_date, 1.0, 1000, 1000, array[$3::uuid], $4) returning id`, [tenant, strat, snap, fin1])).id
  await expectError(`update nav_reports set status = 'published', approved_by = $2, published_at = now() where id = $1`, /four_eyes/, [nav, fin1])
  await db.query(`update nav_reports set status = 'published', approved_by = $2, published_at = now() where id = $1`, [nav, ops1])
  await expectError(`update nav_reports set nav_per_unit = 2 where id = $1`, /no longer change/, [nav])
})

await test('staff role changes are written to the audit log', async () => {
  const r = await one(`select count(*)::int as n from audit_log where entity = 'staff_roles'`)
  if (r.n < 2) throw new Error(`audit rows: ${r.n}`)
})

// ------------------------------------------------------------- Phase 1 ------
console.log('\nPhase 1: KYC, deposits, withdrawals')
const carol = (await one(`insert into auth.users (email) values ('carol@test') returning id`)).id
const dave = (await one(`insert into auth.users (email) values ('dave@test') returning id`)).id
const ops2 = (await one(`insert into auth.users (email) values ('ops2@test') returning id`)).id
const comp = (await one(`insert into auth.users (email) values ('comp@test') returning id`)).id
await db.query(
  `insert into staff_roles (user_id, tenant_id, role) values ($1, $3, 'ops'), ($2, $3, 'compliance')`,
  [ops2, comp, tenant],
)
const addrFor = async (user, ref) =>
  (await one(
    `insert into deposit_addresses (tenant_id, user_id, asset_code, address, custodian_ref)
     values ($1, $2, 'USDT-TRON', $3, $3) returning id`, [tenant, user, `T-${ref}`])).id
const deposit = (addr, ref, amount, settled, amlOk) =>
  one(`select * from record_deposit($1, $2, $3, $4, $5, $6, $7)`, [addr, ref, `tx-${ref}`, amount, settled ? 6 : 1, settled, amlOk])
const cash = async (user) => Number((await one(`select cash_balance($1, 'USDT-TRON') as b`, [user])).b)

await test('KYC result from the provider updates the profile', async () => {
  await db.query(`select apply_kyc_result($1, 'sumsub', 'app-carol', 'approved')`, [carol])
  const p = await one(`select kyc_status from profiles where id = $1`, [carol])
  if (p.kyc_status !== 'approved') throw new Error(p.kyc_status)
})

const carolAddr = await addrFor(carol, 'carol')
await test('deposit moves confirming -> screening -> credited, exactly once', async () => {
  let d = await deposit(carolAddr, 'p1', 300, false, null)
  if (d.status !== 'confirming' || (await cash(carol)) !== 0) throw new Error(`step1 ${d.status}`)
  d = await deposit(carolAddr, 'p1', 300, true, null)
  if (d.status !== 'screening' || (await cash(carol)) !== 0) throw new Error(`step2 ${d.status}`)
  d = await deposit(carolAddr, 'p1', 300, true, true)
  if (d.status !== 'credited' || (await cash(carol)) !== 300) throw new Error(`step3 ${d.status}`)
  d = await deposit(carolAddr, 'p1', 300, true, true)
  if ((await cash(carol)) !== 300) throw new Error('credited twice')
})

await test('a reported amount change on the same payment is rejected', async () => {
  await deposit(carolAddr, 'p2', 5, false, null)
  await expectError(`select record_deposit($1, 'p2', 'tx', 7, 6, true, true)`, /amount changed/, [carolAddr])
})

await test('AML-flagged deposit is held and not credited', async () => {
  const d = await deposit(carolAddr, 'p3', 40, true, false)
  if (d.status !== 'held' || (await cash(carol)) !== 300) throw new Error(d.status)
  const again = await deposit(carolAddr, 'p3', 40, true, true)
  if (again.status !== 'held') throw new Error('automation released a held deposit')
})

const daveAddr = await addrFor(dave, 'dave')
await test('deposit from a user without KYC is held until compliance releases it', async () => {
  const d = await deposit(daveAddr, 'p4', 25, true, true)
  if (d.status !== 'held' || (await cash(dave)) !== 0) throw new Error(d.status)
  await expectError(`select resolve_held_deposit($1, $2, true, 'ok')`, /Only compliance/, [ops1, d.id])
  const r = await one(`select * from resolve_held_deposit($1, $2, true, 'Source of funds verified')`, [comp, d.id])
  if (r.status !== 'credited' || (await cash(dave)) !== 25) throw new Error(r.status)
})

await db.query(
  `insert into withdrawal_limits (tenant_id, asset_code, single_approval_limit, min_amount, platform_fee)
   values ($1, 'USDT-TRON', 100, 5, 1)`, [tenant])
const carolW = (await one(
  `insert into withdrawal_addresses (tenant_id, user_id, asset_code, address) values ($1, $2, 'USDT-TRON', 'TCarolWallet000001') returning id`,
  [tenant, carol])).id
const req = (user, addr, amount) => one(`select * from request_withdrawal($1, $2, $3)`, [user, addr, amount])

await test('new withdrawal address cannot be used during its cool-down', () =>
  expectError(`select request_withdrawal($1, $2, 10)`, /can be used from/, [carol, carolW]))

await db.query(`update withdrawal_addresses set usable_after = now() - interval '1 minute' where id = $1`, [carolW])

await test('withdrawal above balance (incl. fee) is refused', () =>
  expectError(`select request_withdrawal($1, $2, 300)`, /Insufficient balance/, [carol, carolW]))

await test('withdrawal below minimum is refused', () =>
  expectError(`select request_withdrawal($1, $2, 2)`, /below the minimum/, [carol, carolW]))

await test('small withdrawal: reserve, one approval, single payout, settle', async () => {
  const w = await req(carol, carolW, 50)
  if (w.status !== 'pending_approval' || (await cash(carol)) !== 249) throw new Error(`reserve ${w.status} ${await cash(carol)}`)
  await expectError(`select approve_withdrawal($1, $2)`, /Only operations/, [carol, w.id])
  const a = await one(`select * from approve_withdrawal($1, $2)`, [ops1, w.id])
  if (a.status !== 'approved') throw new Error(`approve ${a.status}`)
  const c1 = await one(`select (claim_withdrawal_for_payout($1)).id as id`, [w.id])
  const c2 = await one(`select (claim_withdrawal_for_payout($1)).id as id`, [w.id])
  if (!c1.id || c2.id) throw new Error('payout could be claimed twice')
  const s = await one(`select * from settle_withdrawal($1, 'btcpay-1', '0xabc', 0.3)`, [w.id])
  if (s.status !== 'completed') throw new Error(s.status)
  const pending = await one(
    `select coalesce(sum(balance),0)::numeric as b from account_balances where type = 'pending_withdrawals'`)
  const fees = await one(`select -coalesce(sum(balance),0)::numeric as b from account_balances where type = 'fees'`)
  // platform fee 1 minus the 0.3 miner fee the platform absorbed
  if (Number(pending.b) !== 0 || Number(fees.b) !== 0.7) throw new Error(`pending ${pending.b} fees ${fees.b}`)
})

await test('large withdrawal needs two different approvers', async () => {
  const w = await req(carol, carolW, 150)
  let a = await one(`select * from approve_withdrawal($1, $2)`, [ops1, w.id])
  if (a.status !== 'pending_approval') throw new Error(`after first: ${a.status}`)
  await expectError(`select approve_withdrawal($1, $2)`, /different approver/, [ops1, w.id])
  a = await one(`select * from approve_withdrawal($1, $2)`, [ops2, w.id])
  if (a.status !== 'approved') throw new Error(`after second: ${a.status}`)
  // Ops rejects after approval: funds come back.
  const before = await cash(carol)
  const r = await one(`select * from reject_withdrawal($1, $2, 'Suspicious destination')`, [ops2, w.id])
  if (r.status !== 'rejected' || (await cash(carol)) !== before + 151) throw new Error(`${r.status} ${await cash(carol)}`)
})

await test('user can cancel a pending withdrawal and gets funds back', async () => {
  const before = await cash(carol)
  const w = await req(carol, carolW, 20)
  const r = await one(`select * from reject_withdrawal($1, $2, null)`, [carol, w.id])
  if (r.status !== 'cancelled' || (await cash(carol)) !== before) throw new Error(`${r.status} ${await cash(carol)}`)
})

await test("failed payout can be retried and can't settle twice", async () => {
  const w = await req(carol, carolW, 10)
  await one(`select * from approve_withdrawal($1, $2)`, [ops1, w.id])
  await one(`select claim_withdrawal_for_payout($1)`, [w.id])
  const f = await one(`select * from fail_withdrawal($1, 'node timeout')`, [w.id])
  if (f.status !== 'failed') throw new Error(f.status)
  await expectError(`select settle_withdrawal($1, 'x', 'y')`, /not being paid out/, [w.id])
  const r = await one(`select * from retry_withdrawal($1, $2)`, [ops2, w.id])
  if (r.status !== 'approved') throw new Error(r.status)
})

await test('clients cannot call wallet functions directly', () =>
  asUser(carol, async () => {
    await expectError(`select request_withdrawal('${carol}', '${carolW}', 10)`, /permission denied/)
    await expectError(`select record_deposit('${carolAddr}', 'evil', 'tx', 1000, 99, true, true)`, /permission denied/)
    await expectError(`select approve_withdrawal('${carol}', '${carolW}')`, /permission denied/)
  }))

await test('whole ledger still sums to zero per asset', async () => {
  const r = (await db.query(
    `select a.asset_code, sum(l.amount) as s from ledger_lines l join ledger_accounts a on a.id = l.account_id
     group by a.asset_code having sum(l.amount) <> 0`)).rows
  if (r.length) throw new Error(JSON.stringify(r))
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
