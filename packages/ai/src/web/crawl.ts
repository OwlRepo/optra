import { Readability } from '@mozilla/readability'
import * as cheerio from 'cheerio'
import { JSDOM } from 'jsdom'
import pLimit from 'p-limit'
import robotsParser from 'robots-parser'

export interface CrawlOptions {
  maxDepth?: number
  maxPages?: number
  includePrefixes?: string[]
  excludeDirs?: string[]
  concurrency?: number
  requestDelayMs?: number
  timeoutMs?: number
  userAgent?: string
  respectRobots?: boolean
  fetchImpl?: typeof fetch
}

export interface CrawledPage {
  url: string
  title: string
  content: string
}

type ScopeOptions = {
  origin: string
  includePrefixes?: string[]
  excludeDirs?: string[]
}

type QueueEntry = {
  url: string
  depth: number
}

const DEFAULT_USER_AGENT = 'MnemraBot/1.0 (+https://mnemra.com/bot)'
const MIN_CONTENT_LENGTH = 50

export function canonicalizeUrl(raw: string, base?: string): string {
  const url = new URL(raw, base)

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported protocol: ${url.protocol}`)
  }

  url.hostname = url.hostname.toLowerCase()
  url.hash = ''

  if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
    url.port = ''
  }

  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith('utm_') || key === 'gclid' || key === 'fbclid' || key === 'mc_eid') {
      url.searchParams.delete(key)
    }
  }

  if (!url.searchParams.toString()) {
    url.search = ''
  }

  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, '')
  }

  return url.toString()
}

export function isInScope(url: string, options: ScopeOptions): boolean {
  const parsed = new URL(url)

  if (parsed.origin !== options.origin) {
    return false
  }

  if (options.includePrefixes?.length) {
    const inIncludedPath = options.includePrefixes.some((prefix) => parsed.pathname.startsWith(prefix))
    if (!inIncludedPath) {
      return false
    }
  }

  if (options.excludeDirs?.some((excluded) => parsed.pathname.includes(excluded))) {
    return false
  }

  return true
}

export function extractContent(html: string, url: string): { title: string; content: string } {
  const dom = new JSDOM(html, { url })
  const readability = new Readability(dom.window.document)
  const parsed = readability.parse()

  if (parsed?.textContent?.trim()) {
    return {
      title: collapseWhitespace(parsed.title || dom.window.document.title || url),
      content: collapseWhitespace(parsed.textContent),
    }
  }

  const $ = cheerio.load(html)
  const title = $('title').first().text().trim() || url
  const content = $('body').text()

  return {
    title: collapseWhitespace(title),
    content: collapseWhitespace(content),
  }
}

export function extractLinks(html: string, pageUrl: string): string[] {
  const $ = cheerio.load(html)
  const links = new Set<string>()

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href')
    if (!href) {
      return
    }

    try {
      links.add(canonicalizeUrl(href, pageUrl))
    } catch {
      return
    }
  })

  return [...links]
}

export async function crawlSite(seedUrl: string, options: CrawlOptions = {}): Promise<CrawledPage[]> {
  const maxDepth = clamp(options.maxDepth ?? 3, 0, 5)
  const maxPages = clamp(options.maxPages ?? 500, 1, 2000)
  const concurrency = clamp(options.concurrency ?? 3, 1, 5)
  const requestDelayMs = Math.max(0, options.requestDelayMs ?? 500)
  const timeoutMs = options.timeoutMs ?? 20_000
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT
  const respectRobots = options.respectRobots ?? true
  const fetchImpl = options.fetchImpl ?? fetch

  const canonicalSeed = canonicalizeUrl(seedUrl)
  const seed = new URL(canonicalSeed)
  const scope = {
    origin: seed.origin,
    includePrefixes: options.includePrefixes,
    excludeDirs: options.excludeDirs,
  }

  const robots = respectRobots ? await loadRobots(seed.origin, fetchImpl, userAgent, timeoutMs) : null
  const robotsDelaySeconds = robots?.getCrawlDelay(userAgent) ?? robots?.getCrawlDelay('*') ?? 0
  const robotsDelayMs = Math.max(0, Math.round(robotsDelaySeconds * 1000))
  const effectiveDelayMs = Math.max(requestDelayMs, robotsDelayMs)

  const visited = new Set<string>()
  const queued = new Set<string>([canonicalSeed])
  const results: CrawledPage[] = []
  const queue: QueueEntry[] = [{ url: canonicalSeed, depth: 0 }]
  const limit = pLimit(concurrency)
  const waitForTurn = makeRequestScheduler(effectiveDelayMs)

  while (queue.length > 0 && results.length < maxPages) {
    const frontier = queue.splice(0, Math.min(queue.length, maxPages - results.length))
    const pageResults = await Promise.all(
      frontier.map((entry) =>
        limit(async () => {
          try {
            return await crawlPage(entry, {
              scope,
              maxDepth,
              maxPages,
              visited,
              queued,
              queue,
              resultsCount: results.length,
              robots,
              fetchImpl,
              timeoutMs,
              userAgent,
              waitForTurn,
            })
          } catch {
            return null
          }
        }),
      ),
    )

    for (const page of pageResults) {
      if (!page) {
        continue
      }

      results.push(page)
      if (results.length >= maxPages) {
        break
      }
    }
  }

  return results
}

async function crawlPage(
  entry: QueueEntry,
  context: {
    scope: ScopeOptions
    maxDepth: number
    maxPages: number
    visited: Set<string>
    queued: Set<string>
    queue: QueueEntry[]
    resultsCount: number
    robots: ReturnType<typeof robotsParser> | null
    fetchImpl: typeof fetch
    timeoutMs: number
    userAgent: string
    waitForTurn: () => Promise<void>
  },
): Promise<CrawledPage | null> {
  const { url, depth } = entry

  if (context.visited.has(url)) {
    return null
  }

  if (!isInScope(url, context.scope)) {
    return null
  }

  if (context.robots && !context.robots.isAllowed(url, context.userAgent)) {
    context.visited.add(url)
    return null
  }

  context.visited.add(url)

  await context.waitForTurn()

  const response = await fetchWithRetry(context.fetchImpl, url, {
    headers: {
      'User-Agent': context.userAgent,
      Accept: 'text/html',
    },
    signal: AbortSignal.timeout(context.timeoutMs),
  })

  if (!response?.ok) {
    return null
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/html')) {
    return null
  }

  const html = await response.text()
  const { title, content } = extractContent(html, url)

  if (content.length < MIN_CONTENT_LENGTH) {
    return null
  }

  if (depth < context.maxDepth) {
    for (const link of extractLinks(html, url)) {
      if (context.visited.has(link) || context.queued.has(link)) {
        continue
      }

      if (!isInScope(link, context.scope)) {
        continue
      }

      if (context.queue.length + context.resultsCount >= context.maxPages) {
        break
      }

      context.queued.add(link)
      context.queue.push({ url: link, depth: depth + 1 })
    }
  }

  return { url, title, content }
}

async function fetchWithRetry(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response | null> {
  let lastError: unknown

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchImpl(url, init)

      if (response.status >= 500 && response.status < 600) {
        lastError = new Error(`HTTP ${response.status}`)
        continue
      }

      return response
    } catch (error) {
      lastError = error
    }
  }

  if (lastError) {
    return null
  }

  return null
}

async function loadRobots(
  origin: string,
  fetchImpl: typeof fetch,
  userAgent: string,
  timeoutMs: number,
): Promise<ReturnType<typeof robotsParser> | null> {
  const robotsUrl = `${origin}/robots.txt`

  try {
    const response = await fetchImpl(robotsUrl, {
      headers: {
        'User-Agent': userAgent,
        Accept: 'text/plain',
      },
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!response.ok) {
      return robotsParser(robotsUrl, '')
    }

    return robotsParser(robotsUrl, await response.text())
  } catch {
    return null
  }
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function makeRequestScheduler(delayMs: number): () => Promise<void> {
  let nextAllowedAt = 0

  return async () => {
    if (delayMs <= 0) {
      return
    }

    const now = Date.now()
    const waitMs = Math.max(0, nextAllowedAt - now)
    nextAllowedAt = Math.max(now, nextAllowedAt) + delayMs

    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs))
    }
  }
}
