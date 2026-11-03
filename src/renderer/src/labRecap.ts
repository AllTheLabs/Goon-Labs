export interface LabStat {
  label: string
  value: string
}

export interface LabRecap {
  lab: string
  durationSeconds: number
  stats: LabStat[]
}

export function recapCount(label: string, count: number): LabStat {
  return { label, value: count.toLocaleString() }
}
