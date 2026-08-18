/**
 * Minimal concurrency limiter — the in-house replacement for `p-limit`.
 *
 * Why this exists rather than the library: `packages/ai` compiles with
 * `module: "commonjs"` (see tsconfig.json), but `p-limit@7` is pure ESM with no
 * `require` condition in its exports map. TypeScript would downlevel
 * `await import('p-limit')` into `require()` and blow up at runtime, so the old
 * code smuggled the import past the compiler with
 * `new Function('specifier', 'return import(specifier)')`. That survived into
 * dist/ and worked in production, but Vitest's module runner does not give
 * `new Function`-compiled code a host dynamic-import callback, so ten crawl
 * tests could never run — the production path was untestable by its own suite.
 *
 * Only two things were ever used from p-limit (`pLimit(n)` and `limit(fn)`
 * inside a `Promise.all`), so owning those ~30 lines removes an entire
 * ESM/CJS interop hazard instead of working around it.
 */

/** Runs `fn` once a slot is free; resolves/rejects with `fn`'s outcome. */
export type LimitFn = <T>(fn: () => Promise<T> | T) => Promise<T>

export function createLimit(concurrency: number): LimitFn {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError(`concurrency must be a positive integer, received ${concurrency}`)
  }

  let active = 0
  const pending: Array<() => void> = []

  // Frees the slot and starts the next waiter. Called from `finally`, so a
  // rejected task can never leak a permit and deadlock the queue.
  const release = () => {
    active--
    pending.shift()?.()
  }

  return <T>(fn: () => Promise<T> | T): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const start = () => {
        active++
        // Promise.resolve().then(fn) rather than fn() directly: it turns a
        // SYNCHRONOUS throw inside fn into a rejection, which would otherwise
        // escape past this promise and skip `release()` entirely.
        Promise.resolve()
          .then(fn)
          .then(resolve, reject)
          .finally(release)
      }

      // FIFO: tasks start in the order they were submitted.
      if (active < concurrency) start()
      else pending.push(start)
    })
}
