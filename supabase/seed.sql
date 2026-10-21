-- Local development seed (runs on `supabase db reset`). Testnet assets only.
insert into public.assets (code, name, network, decimals, is_unit) values
  ('BTC',        'Bitcoin (testnet)',      'bitcoin-testnet',  8,  false),
  ('USDT-TRON',  'Tether USD on Tron',     'tron-nile',        6,  false),
  ('USDT-ETH',   'Tether USD on Ethereum', 'ethereum-sepolia', 6,  false),
  ('USDC-ETH',   'USD Coin on Ethereum',   'ethereum-sepolia', 6,  false),
  ('U-MN-USDT',  'Market-Neutral USDT units', 'internal',      18, true)
on conflict (code) do nothing;

insert into public.strategies
  (tenant_id, slug, name, description, risk_notes, base_asset, unit_asset,
   mgmt_fee_bps, perf_fee_bps, lockup_days, status)
select t.id, 'market-neutral-usdt', 'Market-Neutral USDT',
       'Delta-neutral basis and funding-rate strategy, settled in USDT.',
       'Returns are not guaranteed. The value of units can fall as well as rise. '
       'Past performance is not a reliable indicator of future results.',
       'USDT-TRON', 'U-MN-USDT', 150, 2000, 30, 'open'
  from public.tenants t where t.slug = 'default'
on conflict do nothing;
