// Hand-written row types for the views/tables the apps read today.
// Once a Supabase instance is running, replace with generated types:
//   npm run db:types

export type StaffRole = 'support' | 'ops' | 'finance' | 'compliance' | 'admin'
export type KycStatus = 'not_started' | 'pending' | 'approved' | 'rejected'

export interface Profile {
  id: string
  tenant_id: string
  full_name: string | null
  country: string | null
  kyc_status: KycStatus
}

export interface UserBalance {
  account_id: string
  user_id: string
  type: 'user_cash' | 'user_units'
  asset_code: string
  strategy_id: string | null
  balance: string
}

export interface UserActivity {
  line_id: number
  journal_id: string
  kind: string
  external_ref: string | null
  memo: string | null
  account_type: 'user_cash' | 'user_units'
  asset_code: string
  amount: string
  created_at: string
}

export interface Strategy {
  id: string
  slug: string
  name: string
  description: string | null
  risk_notes: string
  base_asset: string
  unit_asset: string
  mgmt_fee_bps: number
  perf_fee_bps: number
  lockup_days: number
  status: string
}

export interface LatestNav {
  strategy_id: string
  valuation_date: string
  nav_per_unit: string
}
