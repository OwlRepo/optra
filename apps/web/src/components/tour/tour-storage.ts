export type TourStatus = 'completed' | 'skipped'
export interface TourRecord {
  status: TourStatus
  at: string
}

export const TOUR_STORAGE_VERSION = 'v1'

export function tourStorageKey(userId: string): string {
  return `optra.tour.${TOUR_STORAGE_VERSION}:${userId}`
}

// `window.localStorage` itself can throw (blocked storage, private mode), so
// even resolving the default happens inside the caller's try/catch.
function resolveStorage(storage?: Storage | null): Storage | null {
  if (storage !== undefined) return storage
  return typeof window === 'undefined' ? null : window.localStorage
}

export function readTourRecord(userId: string, storage?: Storage | null): TourRecord | null {
  try {
    const store = resolveStorage(storage)
    if (!store) return null
    const raw = store.getItem(tourStorageKey(userId))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { status, at } = parsed as { status?: unknown; at?: unknown }
    if (status !== 'completed' && status !== 'skipped') return null
    if (typeof at !== 'string') return null
    return { status, at }
  } catch {
    return null
  }
}

export function writeTourRecord(
  userId: string,
  status: TourStatus,
  now: Date = new Date(),
  storage?: Storage | null,
): void {
  try {
    const store = resolveStorage(storage)
    if (!store) return
    const record: TourRecord = { status, at: now.toISOString() }
    store.setItem(tourStorageKey(userId), JSON.stringify(record))
  } catch {
    // Blocked storage: the tour still ends for this session.
  }
}
