import { FunctionsHttpError } from '@supabase/supabase-js'
import { getSupabase } from './supabase'

// Calls an Edge Function and surfaces its { error } message on failure.
export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().functions.invoke(name, { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null)
      throw new Error(payload?.error ?? `Request failed (${error.context.status})`)
    }
    throw new Error(error.message)
  }
  return data as T
}
