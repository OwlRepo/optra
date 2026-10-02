// The one place pdfjs-dist is loaded. Text extraction (pdf.ts) and page
// rendering (pdf-render.ts) must share this single copy: in a server process
// pdfjs runs an in-process "fake worker" that registers itself on the one
// global `globalThis.pdfjsWorker`. Two copies of pdfjs (pdf-parse used to
// bundle 5.4.296 next to our 6.1.200) meant whichever ran first claimed that
// global and the other failed with `The API version ... does not match the
// Worker version ...` until the process restarted (2026-10-02).
//
// pdfjs also expects the DOM geometry classes DOMMatrix, ImageData and Path2D.
// Node and Bun have none, and pdfjs's own polyfill needs
// `process.getBuiltinModule`, which the production Bun image lacks. Supply the
// real implementations from @napi-rs/canvas (already the render backend), and
// only where the runtime has none, so drawing gets real geometry instead of
// no-op stubs.

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs')

const GEOMETRY_GLOBALS = ['DOMMatrix', 'ImageData', 'Path2D'] as const

let pdfjsPromise: Promise<PdfjsModule> | null = null

async function installGeometryGlobals(): Promise<void> {
  const target = globalThis as Record<string, unknown>
  if (GEOMETRY_GLOBALS.every((name) => typeof target[name] !== 'undefined')) return
  const canvas = (await import('@napi-rs/canvas')) as Record<string, unknown>
  const exported = new Set(Object.keys(canvas))
  for (const name of GEOMETRY_GLOBALS) {
    if (typeof target[name] === 'undefined' && exported.has(name) && typeof canvas[name] === 'function') {
      target[name] = canvas[name]
    }
  }
}

export function loadPdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= installGeometryGlobals()
    .then(() => import('pdfjs-dist/legacy/build/pdf.mjs'))
    .catch((error: unknown) => {
      // Do not cache a failed load; the next call retries.
      pdfjsPromise = null
      throw error
    })
  return pdfjsPromise
}
