const TONES: Record<string, { bg: string; fg: string; label?: string }> = {
  credited: { bg: '#dcfce7', fg: '#166534' },
  completed: { bg: '#dcfce7', fg: '#166534' },
  approved: { bg: '#dbeafe', fg: '#1e40af' },
  confirming: { bg: '#fef9c3', fg: '#854d0e', label: 'confirming' },
  screening: { bg: '#fef9c3', fg: '#854d0e' },
  pending_approval: { bg: '#fef9c3', fg: '#854d0e', label: 'awaiting approval' },
  broadcast: { bg: '#dbeafe', fg: '#1e40af', label: 'sending' },
  held: { bg: '#ffedd5', fg: '#9a3412', label: 'under review' },
  failed: { bg: '#ffedd5', fg: '#9a3412', label: 'delayed' },
  rejected: { bg: '#fee2e2', fg: '#991b1b' },
  cancelled: { bg: '#e2e8f0', fg: '#334155' },
}

export function StatusBadge({ status }: { status: string }) {
  const t = TONES[status] ?? { bg: '#e2e8f0', fg: '#334155' }
  return (
    <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: t.bg, color: t.fg }}>
      {t.label ?? status.replace('_', ' ')}
    </span>
  )
}
