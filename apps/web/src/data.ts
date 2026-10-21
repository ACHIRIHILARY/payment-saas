import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabase, type LatestNav, type Profile, type Strategy, type UserActivity, type UserBalance } from '@app/shared'

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

// Any new ledger line, deposit or withdrawal for this user refreshes the views.
// RLS on the realtime publication means users only receive their own rows.
export function useLiveLedger() {
  const qc = useQueryClient()
  useEffect(() => {
    const refresh = () => {
      void qc.invalidateQueries({ queryKey: ['balances'] })
      void qc.invalidateQueries({ queryKey: ['activity'] })
    }
    const channel = supabase()
      .channel('ledger-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ledger_lines' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deposits' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'withdrawals' }, refresh)
      .subscribe()
    return () => {
      void supabase().removeChannel(channel)
    }
  }, [qc])
}
