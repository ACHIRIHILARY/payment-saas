import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { HttpError, requireEnv } from './http.ts'

/** Service-role client: bypasses RLS. Only call wallet SQL functions with it. */
export function adminClient(): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export interface Caller {
  userId: string
  tenantId: string
  aal: 'aal1' | 'aal2'
  email?: string
}

/**
 * Validates the caller's JWT with Supabase Auth and loads their tenant.
 * Money-moving and staff endpoints pass requireMfa = true.
 */
export async function getCaller(req: Request, { requireMfa = true } = {}): Promise<Caller> {
  const header = req.headers.get('Authorization') ?? ''
  const jwt = header.replace(/^Bearer\s+/i, '')
  if (!jwt) throw new HttpError(401, 'Not signed in')

  const admin = adminClient()
  const { data, error } = await admin.auth.getUser(jwt)
  if (error || !data.user) throw new HttpError(401, 'Session expired, please sign in again')

  // Token is verified above, so reading its claims is safe.
  const claims = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
  const aal = claims.aal === 'aal2' ? 'aal2' : 'aal1'
  if (requireMfa && aal !== 'aal2') throw new HttpError(403, 'Two-factor authentication required')

  const { data: profile, error: pErr } = await admin
    .from('profiles')
    .select('tenant_id')
    .eq('id', data.user.id)
    .single()
  if (pErr || !profile) throw new HttpError(403, 'No profile for this account')

  return { userId: data.user.id, tenantId: profile.tenant_id, aal, email: data.user.email }
}

export async function callerRoles(admin: SupabaseClient, caller: Caller): Promise<Set<string>> {
  const { data, error } = await admin
    .from('staff_roles')
    .select('role')
    .eq('user_id', caller.userId)
    .eq('tenant_id', caller.tenantId)
  if (error) throw error
  return new Set((data ?? []).map((r: { role: string }) => r.role))
}

/** Unwraps a supabase-js result, throwing the Postgres message on error. */
export function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}
