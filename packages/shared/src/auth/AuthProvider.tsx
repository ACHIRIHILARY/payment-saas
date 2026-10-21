import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSupabase } from '../supabase'

type Aal = 'aal1' | 'aal2' | null

interface AuthState {
  session: Session | null
  loading: boolean
  /** Assurance level of the current session; aal2 = passed 2FA. */
  currentLevel: Aal
  /** aal2 once the user has a verified TOTP factor. */
  nextLevel: Aal
  refreshAal: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = getSupabase()
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [currentLevel, setCurrent] = useState<Aal>(null)
  const [nextLevel, setNext] = useState<Aal>(null)

  const refreshAal = useCallback(async () => {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    setCurrent((data?.currentLevel as Aal) ?? null)
    setNext((data?.nextLevel as Aal) ?? null)
  }, [supabase])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      if (data.session) await refreshAal()
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      // Defer: calling Supabase inside this callback can deadlock the auth lock.
      setTimeout(() => void refreshAal(), 0)
    })
    return () => sub.subscription.unsubscribe()
  }, [supabase, refreshAal])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [supabase])

  return (
    <AuthContext.Provider value={{ session, loading, currentLevel, nextLevel, refreshAal, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
