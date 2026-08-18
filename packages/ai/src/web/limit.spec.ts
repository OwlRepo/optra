import { describe, expect, it } from 'vitest'

import { createLimit } from './limit'

/** Resolves after `ms`, used to overlap tasks so concurrency is observable. */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Wraps a task so the harness can observe how many run at once. Returns the
 * task plus a live counter whose `peak` is the highest simultaneous count seen.
 */
function trackConcurrency() {
  const state = { active: 0, peak: 0 }
  const track = <T>(fn: () => Promise<T>) => async () => {
    state.active++
    state.peak = Math.max(state.peak, state.active)
    try {
      return await fn()
    } finally {
      state.active--
    }
  }
  return { state, track }
}

describe('createLimit', () => {
  it('runs every task and resolves values in input order', async () => {
    const limit = createLimit(2)
    const inputs = [1, 2, 3, 4, 5]

    const results = await Promise.all(
      // Descending delays: if ordering leaked from completion order rather than
      // input order, this would come back reversed.
      inputs.map((n) => limit(async () => {
        await sleep((inputs.length - n) * 5)
        return n * 10
      })),
    )

    expect(results).toEqual([10, 20, 30, 40, 50])
  })

  it('never exceeds the configured concurrency', async () => {
    const { state, track } = trackConcurrency()
    const limit = createLimit(3)

    await Promise.all(
      Array.from({ length: 12 }, () => limit(track(async () => sleep(10)))),
    )

    expect(state.peak).toBe(3)
    expect(state.active).toBe(0)
  })

  it('serialises completely when concurrency is 1', async () => {
    const { state, track } = trackConcurrency()
    const limit = createLimit(1)
    const order: number[] = []

    await Promise.all(
      Array.from({ length: 5 }, (_unused, i) =>
        limit(track(async () => {
          await sleep(5)
          order.push(i)
        })),
      ),
    )

    expect(state.peak).toBe(1)
    expect(order).toEqual([0, 1, 2, 3, 4])
  })

  it('propagates a rejection and still frees the slot for queued tasks', async () => {
    const limit = createLimit(1)
    const boom = limit(async () => {
      throw new Error('boom')
    })
    // Queued behind the failing task: if the slot leaked, this would hang and
    // the test would time out rather than fail an assertion.
    const after = limit(async () => 'ran anyway')

    await expect(boom).rejects.toThrow('boom')
    await expect(after).resolves.toBe('ran anyway')
  })

  it('converts a synchronous throw into a rejection', async () => {
    const limit = createLimit(2)

    await expect(
      limit((() => {
        throw new Error('sync boom')
      }) as () => Promise<never>),
    ).rejects.toThrow('sync boom')

    // The slot must be released even though the throw never produced a promise.
    await expect(limit(async () => 'still works')).resolves.toBe('still works')
  })

  it('resolves immediately when there are no tasks', async () => {
    const limit = createLimit(3)
    await expect(Promise.all([])).resolves.toEqual([])
    await expect(limit(async () => 'one')).resolves.toBe('one')
  })

  it('does not stall when concurrency exceeds the task count', async () => {
    const { state, track } = trackConcurrency()
    const limit = createLimit(10)

    const results = await Promise.all(
      [1, 2, 3].map((n) => limit(track(async () => {
        await sleep(5)
        return n
      }))),
    )

    expect(results).toEqual([1, 2, 3])
    expect(state.peak).toBe(3)
  })

  it('rejects an invalid concurrency instead of silently misbehaving', () => {
    expect(() => createLimit(0)).toThrow(RangeError)
    expect(() => createLimit(-1)).toThrow(RangeError)
    expect(() => createLimit(1.5)).toThrow(RangeError)
  })
})
