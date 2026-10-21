import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { callFunction } from '@app/shared'

export function useStaffAction() {
  const qc = useQueryClient()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(id: string, body: Record<string, unknown>) {
    setBusyId(id)
    setError(null)
    try {
      await callFunction('staff-action', body)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusyId(null)
      void qc.invalidateQueries()
    }
  }

  return { run, busyId, error }
}
