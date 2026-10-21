export function ComingSoon({ title, phase }: { title: string; phase: string }) {
  return (
    <section className="card text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="muted mt-2 text-sm">Not built yet: {phase}.</p>
    </section>
  )
}
