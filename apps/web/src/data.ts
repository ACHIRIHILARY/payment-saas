import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getSupabase,
  type Deposit,
  type LatestNav,
  type Profile,
  type Strategy,
  type UserActivity,
  type UserBalance,
  type Withdrawal,
  type WithdrawalAddress,
  type WithdrawalLimit,
} from '@app/shared'

const supabase = () => getSupabase()

async function unwrap<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(error.message)
  return data as T
}

export const useProfile = () =>
  useQuery({
    queryKey: ['profile'],
    queryFn: () => unwrap<Profile>(supabase().from('profiles').select('*').single()),
  })

export const useBalances = () =>
  useQuery({
    queryKey: ['balances'],
    queryFn: () => unwrap<UserBalance[]>(supabase().from('user_balances').select('*')),
  })

export const useActivity = (limit = 50) =>
  useQuery({
    queryKey: ['activity', limit],
    queryFn: () =>
      unwrap<UserActivity[]>(
        supabase().from('user_activity').select('*').order('created_at', { ascending: false }).limit(limit),
      ),
  })

export const useStrategies = () =>
  useQuery({
    queryKey: ['strategies'],
    queryFn: async () => {
      const [strategies, navs] = await Promise.all([
        unwrap<Strategy[]>(supabase().from('strategies').select('*')),
        unwrap<LatestNav[]>(supabase().from('latest_nav').select('*')),
      ])
      return { strategies, navs }
    },
  })

export const useDeposits = () =>
  useQuery({
    queryKey: ['deposits'],
    queryFn: () =>
      unwrap<Deposit[]>(supabase().from('deposits').select('*').order('created_at', { ascending: false }).limit(50)),
  })

export const useWithdrawals = () =>
  useQuery({
    queryKey: ['withdrawals'],
    queryFn: () =>
      unwrap<Withdrawal[]>(supabase().from('withdrawals').select('*').order('created_at', { ascending: false }).limit(50)),
  })

export const useWithdrawalAddresses = () =>
  useQuery({
    queryKey: ['withdrawal-addresses'],
    queryFn: () =>
      unwrap<WithdrawalAddress[]>(
        supabase().from('withdrawal_addresses').select('*').is('removed_at', null).order('created_at'),
      ),
  })

export const useWithdrawalLimits = () =>
  useQuery({
    queryKey: ['withdrawal-limits'],
    queryFn: () => unwrap<WithdrawalLimit[]>(supabase().from('withdrawal_limits').select('*')),
  })

// Any new ledger line, deposit or withdrawal for this user refreshes the views.
// RLS on the realtime publication means users only receive their own rows.
export function useLiveLedger() {
  const qc = useQueryClient()
  useEffect(() => {
    const refresh = () => {
      void qc.invalidateQueries({ queryKey: ['balances'] })
      void qc.invalidateQueries({ queryKey: ['activity'] })
      void qc.invalidateQueries({ queryKey: ['deposits'] })
      void qc.invalidateQueries({ queryKey: ['withdrawals'] })
      void qc.invalidateQueries({ queryKey: ['profile'] })
    }
    const channel = supabase()
      .channel('ledger-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ledger_lines' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deposits' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'withdrawals' }, refresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, refresh)
      .subscribe()
    return () => {
      void supabase().removeChannel(channel)
    }
  }, [qc])
}
