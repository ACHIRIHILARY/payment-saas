import { useQuery } from '@tanstack/react-query'
import { getSupabase, type Deposit, type StaffRole, type Withdrawal, type WithdrawalAddress } from '@app/shared'

const sb = () => getSupabase()

async function rows<T>(p: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await p
  if (error) throw new Error(error.message)
  return data ?? []
}

export interface UserLite {
  id: string
  full_name: string | null
  kyc_status: string
  country: string | null
}

// user_id columns reference auth.users, so names are fetched in one batch.
async function names(ids: string[]): Promise<Map<string, UserLite>> {
  const unique = [...new Set(ids)]
  if (!unique.length) return new Map()
  const list = await rows<UserLite>(sb().from('profiles').select('id, full_name, kyc_status, country').in('id', unique))
  return new Map(list.map((u) => [u.id, u]))
}

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const { data } = await sb().auth.getUser()
      const id = data.user?.id ?? ''
      const roles = await rows<{ role: StaffRole }>(sb().from('staff_roles').select('role').eq('user_id', id))
      return { id, roles: new Set(roles.map((r) => r.role)) }
    },
  })
}

export function useWithdrawalQueue() {
  return useQuery({
    queryKey: ['withdrawal-queue'],
    refetchInterval: 15_000,
    queryFn: async () => {
      const list = await rows<Withdrawal>(
        sb()
          .from('withdrawals')
          .select('*')
          .in('status', ['pending_approval', 'approved', 'broadcast', 'failed'])
          .order('created_at'),
      )
      const addrs = await rows<WithdrawalAddress>(
        sb().from('withdrawal_addresses').select('*').in('id', list.map((w) => w.address_id)),
      )
      return { list, users: await names(list.map((w) => w.user_id)), addrs: new Map(addrs.map((a) => [a.id, a])) }
    },
  })
}

export interface KycCase {
  id: string
  user_id: string
  provider: string
  provider_ref: string
  status: string
  created_at: string
}

export function useKycQueue() {
  return useQuery({
    queryKey: ['kyc-queue'],
    refetchInterval: 30_000,
    queryFn: async () => {
      const list = await rows<KycCase>(sb().from('kyc_cases').select('*').eq('status', 'pending').order('created_at'))
      return { list, users: await names(list.map((k) => k.user_id)) }
    },
  })
}

export function useHeldDeposits() {
  return useQuery({
    queryKey: ['held-deposits'],
    refetchInterval: 30_000,
    queryFn: async () => {
      const list = await rows<Deposit & { user_id: string }>(
        sb().from('deposits').select('*').eq('status', 'held').order('created_at'),
      )
      return { list, users: await names(list.map((d) => d.user_id)) }
    },
  })
}

export function useQueueCounts(enabled: boolean) {
  const count = async (table: string, apply: (q: any) => any) => {
    const { count, error } = await apply(sb().from(table).select('*', { count: 'exact', head: true }))
    if (error) throw new Error(error.message)
    return count ?? 0
  }
  return useQuery({
    enabled,
    queryKey: ['queue-counts'],
    refetchInterval: 30_000,
    queryFn: async () => {
      const [kyc, withdrawals, held, navDrafts, shortfalls] = await Promise.all([
        count('kyc_cases', (q) => q.eq('status', 'pending')),
        count('withdrawals', (q) => q.in('status', ['pending_approval', 'failed'])),
        count('deposits', (q) => q.eq('status', 'held')),
        count('nav_reports', (q) => q.eq('status', 'draft')),
        count('reconciliation_runs', (q) =>
          q.neq('status', 'ok').gte('run_at', new Date(Date.now() - 864e5).toISOString()),
        ),
      ])
      return { kyc, withdrawals, held, navDrafts, shortfalls }
    },
  })
}
