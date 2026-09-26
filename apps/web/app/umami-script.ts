// Umami (self-hosted analytics) only renders once both its script URL and the
// website id it was assigned in the Umami dashboard are configured — before
// that (e.g. a fresh environment where the website hasn't been created yet in
// Umami's own UI), the layout renders nothing.
export function getUmamiScriptProps(): { src: string; websiteId: string } | null {
  const src = process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL
  const websiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID
  if (!src || !websiteId) return null
  return { src, websiteId }
}
