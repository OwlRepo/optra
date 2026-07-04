import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import ts from 'typescript'

import { canonicalizeUrl, crawlSite, extractContent, isInScope } from './crawl'

describe('crawl module packaging', () => {
  it('does not compile the p-limit load into a CommonJS require', () => {
    const source = readFileSync(new URL('./crawl.ts', import.meta.url), 'utf8')
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
        esModuleInterop: true,
      },
    }).outputText

    expect(output).not.toMatch(/require\(["']p-limit["']\)/)
  })
})

type MockResponseInit = {
  body: string
  status?: number
  contentType?: string
}

function htmlPage(title: string, body: string) {
  return `<!doctype html>
  <html>
    <head><title>${title}</title></head>
    <body>${body}</body>
  </html>`
}

function makeFetch(site: Record<string, MockResponseInit>) {
  const counts = new Map<string, number>()

  const fetchImpl: typeof fetch = vi.fn(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    counts.set(url, (counts.get(url) ?? 0) + 1)

    const entry = site[url]
    if (!entry) {
      throw new Error(`Missing mock for ${url}`)
    }

    return new Response(entry.body, {
      status: entry.status ?? 200,
      headers: {
        'content-type': entry.contentType ?? 'text/html; charset=utf-8',
      },
    })
  }) as typeof fetch

  return { fetchImpl, counts }
}

describe('canonicalizeUrl', () => {
  it('collapses tracking variants into one URL', () => {
    expect(canonicalizeUrl('https://example.com/home')).toBe('https://example.com/home')
    expect(canonicalizeUrl('https://EXAMPLE.com/home/')).toBe('https://example.com/home')
    expect(canonicalizeUrl('https://example.com/home#a')).toBe('https://example.com/home')
    expect(canonicalizeUrl('https://example.com/home?utm_source=x')).toBe('https://example.com/home')
  })
})

describe('isInScope', () => {
  it('limits crawl to origin and include prefixes', () => {
    expect(
      isInScope('https://example.com/docs/page', {
        origin: 'https://example.com',
        includePrefixes: ['/docs'],
        excludeDirs: [],
      }),
    ).toBe(true)

    expect(
      isInScope('https://example.com/blog/post', {
        origin: 'https://example.com',
        includePrefixes: ['/docs'],
        excludeDirs: [],
      }),
    ).toBe(false)

    expect(
      isInScope('https://other.com/docs/page', {
        origin: 'https://example.com',
        includePrefixes: ['/docs'],
        excludeDirs: [],
      }),
    ).toBe(false)
  })
})

describe('extractContent', () => {
  it('keeps article text, drops boilerplate, keeps title', () => {
    const parsed = extractContent(
      htmlPage(
        'Article title',
        `
          <nav>Navigation Link</nav>
          <aside>Sidebar promo</aside>
          <main>
            <article>
              <h1>Article title</h1>
              <p>Important body text with enough words to stay in content extraction.</p>
            </article>
          </main>
          <footer>Footer text</footer>
        `,
      ),
      'https://example.com/docs/article',
    )

    expect(parsed.title).toBe('Article title')
    expect(parsed.content).toContain('Important body text')
    expect(parsed.content).not.toContain('Navigation Link')
    expect(parsed.content).not.toContain('Sidebar promo')
    expect(parsed.content).not.toContain('Footer text')
  })
})

describe('crawlSite', () => {
  const docsHome = htmlPage(
    'Docs home',
    `
      <main>
        <p>${'Home intro '.repeat(8)}</p>
        <a href="/docs/article-a">A</a>
        <a href="/docs/article-b?utm_source=x">B</a>
        <a href="/docs/broken">Broken</a>
        <a href="/docs/file.pdf">PDF</a>
        <a href="/blog/post">Blog</a>
        <a href="https://offsite.example/docs/offsite">Offsite</a>
      </main>
    `,
  )

  const articleA = htmlPage(
    'Article A',
    `
      <article>
        <p>${'Article A body '.repeat(12)}</p>
        <a href="/docs/shared">Shared</a>
        <a href="/docs/deep/page">Deep</a>
      </article>
    `,
  )

  const articleB = htmlPage(
    'Article B',
    `
      <article>
        <p>${'Article B body '.repeat(12)}</p>
        <a href="/docs/shared">Shared</a>
      </article>
    `,
  )

  const shared = htmlPage('Shared', `<article><p>${'Shared body '.repeat(12)}</p></article>`)
  const deep = htmlPage('Deep', `<article><p>${'Deep body '.repeat(12)}</p></article>`)

  function buildSite(): Record<string, MockResponseInit> {
    return {
      'https://example.com/robots.txt': {
        body: 'User-agent: *\nDisallow: /docs/private\n',
        contentType: 'text/plain',
      },
      'https://example.com/docs': { body: docsHome },
      'https://example.com/docs/article-a': { body: articleA },
      'https://example.com/docs/article-b': { body: articleB },
      'https://example.com/docs/shared': { body: shared },
      'https://example.com/docs/deep/page': { body: deep },
      'https://example.com/docs/private': {
        body: htmlPage('Private', `<article><p>${'Private body '.repeat(12)}</p></article>`),
      },
      'https://example.com/docs/broken': { body: 'bad', status: 500 },
      'https://example.com/docs/file.pdf': { body: '%PDF-1.7', contentType: 'application/pdf' },
    }
  }

  function buildThinHubSite(): Record<string, MockResponseInit> {
    return {
      'https://example.com/robots.txt': {
        body: 'User-agent: *\nDisallow:\n',
        contentType: 'text/plain',
      },
      'https://example.com/docs': {
        body: htmlPage(
          'Docs hub',
          `
            <main>
              <nav>
                <a href="/docs/article-a">Article A</a>
                <a href="/docs/article-b">Article B</a>
              </nav>
            </main>
          `,
        ),
      },
      'https://example.com/docs/article-a': {
        body: htmlPage('Article A', `<article><p>${'Article A body '.repeat(12)}</p></article>`),
      },
      'https://example.com/docs/article-b': {
        body: htmlPage('Article B', `<article><p>${'Article B body '.repeat(12)}</p></article>`),
      },
    }
  }

  it('stops at configured depth', async () => {
    const { fetchImpl } = makeFetch(buildSite())

    const depthOne = await crawlSite('https://example.com/docs/', {
      maxDepth: 1,
      includePrefixes: ['/docs'],
      fetchImpl,
      requestDelayMs: 0,
      timeoutMs: 1000,
      userAgent: 'CrawlerTest/1.0',
    })

    expect(depthOne.map((page) => page.url)).toEqual([
      'https://example.com/docs',
      'https://example.com/docs/article-a',
      'https://example.com/docs/article-b',
    ])
  })

  it('applies maxPages cap', async () => {
    const { fetchImpl } = makeFetch(buildSite())

    const pages = await crawlSite('https://example.com/docs/', {
      maxDepth: 2,
      maxPages: 4,
      includePrefixes: ['/docs'],
      fetchImpl,
      requestDelayMs: 0,
      timeoutMs: 1000,
    })

    expect(pages).toHaveLength(4)
  })

  it('dedupes pages reached from multiple parents', async () => {
    const { fetchImpl, counts } = makeFetch(buildSite())

    const depthTwo = await crawlSite('https://example.com/docs/', {
      maxDepth: 2,
      maxPages: 10,
      includePrefixes: ['/docs'],
      fetchImpl,
      requestDelayMs: 0,
      timeoutMs: 1000,
      userAgent: 'CrawlerTest/1.0',
    })

    expect(depthTwo.some((page) => page.url === 'https://example.com/docs/shared')).toBe(true)
    expect(depthTwo.some((page) => page.url === 'https://example.com/docs/deep/page')).toBe(true)
    expect(counts.get('https://example.com/docs/shared')).toBe(1)
  })

  it('keeps crawl in scope and honors robots unless disabled', async () => {
    const { fetchImpl, counts } = makeFetch(buildSite())

    await crawlSite('https://example.com/docs/', {
      maxDepth: 2,
      maxPages: 10,
      includePrefixes: ['/docs'],
      fetchImpl,
      requestDelayMs: 0,
      timeoutMs: 1000,
    })

    expect(counts.get('https://example.com/blog/post')).toBeUndefined()
    expect(counts.get('https://example.com/docs/private')).toBeUndefined()

    const withoutRobots = await crawlSite('https://example.com/docs/private', {
      maxDepth: 0,
      includePrefixes: ['/docs'],
      fetchImpl,
      requestDelayMs: 0,
      timeoutMs: 1000,
      respectRobots: false,
    })

    expect(withoutRobots).toHaveLength(1)
  })

  it('sends configured user agent on every page fetch', async () => {
    const { fetchImpl } = makeFetch(buildSite())

    await crawlSite('https://example.com/docs/', {
      maxDepth: 1,
      includePrefixes: ['/docs'],
      fetchImpl,
      requestDelayMs: 0,
      timeoutMs: 1000,
      userAgent: 'CrawlerTest/1.0',
    })

    const calls = vi.mocked(fetchImpl).mock.calls
    const nonRobotsCalls = calls.filter(([input]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      return !url.endsWith('/robots.txt')
    })
    expect(
      nonRobotsCalls.every(([, init]) => (init?.headers as Record<string, string>)['User-Agent'] === 'CrawlerTest/1.0'),
    ).toBe(true)
  })

  it('skips failed and non-html pages without aborting crawl', async () => {
    const { fetchImpl } = makeFetch(buildSite())

    const pages = await crawlSite('https://example.com/docs/', {
      maxDepth: 1,
      includePrefixes: ['/docs'],
      fetchImpl,
      requestDelayMs: 0,
      timeoutMs: 1000,
    })

    expect(pages.some((page) => page.url === 'https://example.com/docs/broken')).toBe(false)
    expect(pages.some((page) => page.url === 'https://example.com/docs/file.pdf')).toBe(false)
    expect(pages.some((page) => page.url === 'https://example.com/docs/article-a')).toBe(true)
  })

  it('follows links from thin hub pages to deeper articles', async () => {
    const { fetchImpl } = makeFetch(buildThinHubSite())

    const pages = await crawlSite('https://example.com/docs/', {
      maxDepth: 1,
      includePrefixes: ['/docs'],
      fetchImpl,
      requestDelayMs: 0,
      timeoutMs: 1000,
    })

    expect(pages.map((page) => page.url)).toEqual([
      'https://example.com/docs/article-a',
      'https://example.com/docs/article-b',
    ])
  })

  it('does not store thin hub pages even when their links are followed', async () => {
    const { fetchImpl } = makeFetch(buildThinHubSite())

    const pages = await crawlSite('https://example.com/docs/', {
      maxDepth: 1,
      includePrefixes: ['/docs'],
      fetchImpl,
      requestDelayMs: 0,
      timeoutMs: 1000,
    })

    expect(pages.some((page) => page.url === 'https://example.com/docs')).toBe(false)
  })

  it('throws when seed url fails public-url validation', async () => {
    const { fetchImpl } = makeFetch(buildSite())
    const lookup = vi.fn().mockResolvedValue([{ address: '127.0.0.1', family: 4 }])

    await expect(
      crawlSite('https://blocked.example.com/docs', {
        fetchImpl,
        lookup,
        requestDelayMs: 0,
        timeoutMs: 1000,
      }),
    ).rejects.toThrow('Blocked non-public URL')
  })

  it('skips in-scope links that resolve to private addresses', async () => {
    const { fetchImpl, counts } = makeFetch({
      'https://example.com/robots.txt': {
        body: 'User-agent: *\nDisallow:\n',
        contentType: 'text/plain',
      },
      'https://example.com/docs': {
        body: htmlPage(
          'Docs home',
          `
            <main>
              <p>${'Home intro '.repeat(8)}</p>
              <a href="https://private.example.com/docs/private">Private</a>
            </main>
          `,
        ),
      },
    })
    const lookup = vi.fn(async (hostname: string) => {
      if (hostname === 'example.com') {
        return [{ address: '93.184.216.34', family: 4 }]
      }

      if (hostname === 'private.example.com') {
        return [{ address: '10.0.0.9', family: 4 }]
      }

      return [{ address: '93.184.216.34', family: 4 }]
    })

    const pages = await crawlSite('https://example.com/docs', {
      fetchImpl,
      lookup,
      requestDelayMs: 0,
      timeoutMs: 1000,
    })

    expect(pages.map((page) => page.url)).toEqual(['https://example.com/docs'])
    expect(counts.get('https://private.example.com/docs/private')).toBeUndefined()
  })

  it('streams live progress through onPage as pages are accepted', async () => {
    const { fetchImpl } = makeFetch(buildSite())
    const progressEvents: Array<{ url: string; pagesFound: number; pagesVisited: number; pagesQueued: number; maxPages: number }> =
      []

    const pages = await crawlSite('https://example.com/docs/', {
      maxDepth: 1,
      includePrefixes: ['/docs'],
      fetchImpl,
      requestDelayMs: 0,
      timeoutMs: 1000,
      onPage: async (page, progress) => {
        progressEvents.push({
          url: page.url,
          pagesFound: progress.pagesFound,
          pagesVisited: progress.pagesVisited,
          pagesQueued: progress.pagesQueued,
          maxPages: progress.maxPages,
        })
      },
    })

    expect(progressEvents.map((event) => event.url).sort()).toEqual(pages.map((page) => page.url).sort())
    expect(progressEvents.map((event) => event.pagesFound)).toEqual([1, 2, 3])
    expect(progressEvents.every((event) => event.pagesVisited >= event.pagesFound)).toBe(true)
    expect(progressEvents.every((event) => event.maxPages === 500)).toBe(true)
  })
})
