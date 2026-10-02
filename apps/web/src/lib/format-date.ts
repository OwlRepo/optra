const pad = (n: number) => String(n).padStart(2, '0')

function toDate(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDate(value: string | Date): string {
  const date = toDate(value)
  if (!date) return '—'
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function formatDateTime(value: string | Date): string {
  const date = toDate(value)
  if (!date) return '—'
  return `${formatDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
