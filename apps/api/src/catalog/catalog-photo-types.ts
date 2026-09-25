// The one list of image types a catalog photo may be. Shared by the side that
// STORES photos (CatalogImageService) and the side that SERVES them
// (CatalogDocumentsService.getItemPhoto), so they cannot drift apart again:
// the fetcher used to accept any `image/*`, the server refused SVG, and an SVG
// photo was stored only to 400 on every render.
//
// Raster only, as an allowlist rather than "serve whatever we stored": an SVG
// can carry script, and these bytes are rendered inline from our own origin.
export const SERVABLE_PHOTO_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
])

/** `IMAGE/JPEG; charset=binary` -> `image/jpeg`. Empty string when absent. */
export function mediaTypeOf(contentType: string | null | undefined): string {
  return (contentType ?? '').split(';')[0].trim().toLowerCase()
}
