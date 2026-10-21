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

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
