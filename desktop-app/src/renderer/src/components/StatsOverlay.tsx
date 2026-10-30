import type { StreamStats } from '@renderer/lib/stats'

interface StatsOverlayProps {
  stats: StreamStats | null
  pending: boolean
}

function line(label: string, value: string) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted">{label}</span>
      <span>{value}</span>
    </div>
  )
}

export function StatsOverlay({ stats, pending }: StatsOverlayProps) {
  return (
    <div className="pointer-events-none absolute left-2 top-2 z-20 min-w-36 rounded-md bg-black/75 px-2 py-1.5 font-mono text-[11px] leading-4 text-ink">
      {stats ? (
        <>
          {line('Resolução', stats.width && stats.height ? `${stats.width}×${stats.height}` : '—')}
          {line('FPS', stats.fps ? String(stats.fps) : '—')}
          {line('Bitrate', stats.bitrateMbps > 0 ? `${stats.bitrateMbps.toFixed(1)} Mbps` : '—')}
          {line('Codec', stats.codec)}
          {line('Ping', stats.rttMs !== null ? `${stats.rttMs} ms` : '—')}
        </>
      ) : (
        <span>{pending ? 'Coletando…' : 'Sem estatísticas'}</span>
      )}
    </div>
  )
}
