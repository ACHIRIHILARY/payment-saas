import { useActivity } from '../data'
import { ActivityList } from '../components/ActivityList'

export function Activity() {
  const activity = useActivity(200)
  return (
    <section className="card">
      <h1 className="mb-2 text-xl font-semibold">Activity</h1>
      {activity.isLoading ? (
        <p className="muted">Loading…</p>
      ) : activity.error ? (
        <p className="error">{(activity.error as Error).message}</p>
      ) : (
        <ActivityList rows={activity.data ?? []} />
      )}
    </section>
  )
}
