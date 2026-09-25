import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'

// Small, boring helpers the storage specs share. Kept thin on purpose: a spec
// should still read as the steps a person takes in the product.

export interface FilePayload {
  name: string
  mimeType: string
  buffer: Buffer
}

const MIME: Record<string, string> = {
  '.csv': 'text/csv',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.pdf': 'application/pdf',
}

/** A committed fixture, optionally renamed so parallel uploads stay distinguishable. */
export function fixture(file: string, rename?: string): FilePayload {
  const extension = file.slice(file.lastIndexOf('.'))
  return {
    name: rename ?? file,
    mimeType: MIME[extension] ?? 'application/octet-stream',
    buffer: readFileSync(join(__dirname, '..', 'fixtures', file)),
  }
}

/** A file one byte over MAX_UPLOAD_MB=1, built in memory - never committed. */
export function oversized(name: string): FilePayload {
  const header = 'sku,description,qty,unit price\n'
  const body = Buffer.alloc(1024 * 1024 + 1 - header.length, 'x')
  return { name, mimeType: 'text/csv', buffer: Buffer.concat([Buffer.from(header), body]) }
}

export function wrongType(name = 'payload.exe'): FilePayload {
  return { name, mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ not a spreadsheet') }
}

/**
 * The upload inputs are hidden and opened by a visible button, so choose the
 * file the way a person does: click the button, answer the file chooser.
 */
export async function chooseFile(page: Page, buttonName: string, file: FilePayload): Promise<void> {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: buttonName }).first().click()
  await (await chooser).setFiles(file)
}

/** Clicks a control that triggers a browser download and returns what arrived. */
export async function download(
  page: Page,
  trigger: () => Promise<void>,
): Promise<{ filename: string; bytes: Buffer }> {
  const pending = page.waitForEvent('download')
  await trigger()
  const file = await pending
  const path = await file.path()
  return { filename: file.suggestedFilename(), bytes: readFileSync(path) }
}

/**
 * A BFF request made from inside the page, so it carries exactly the cookies
 * the product's own fetches carry. Playwright's `page.request` is not a
 * substitute: it will not send the BFF's `Secure` session cookie over plain
 * http, even though Chrome does on loopback.
 */
export async function bff(
  page: Page,
  url: string,
  init: { method?: string } = {},
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  return page.evaluate(
    async ({ url, init }) => {
      const response = await fetch(url, { method: init.method ?? 'GET', credentials: 'same-origin' })
      const headers: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        headers[key] = value
      })
      return { status: response.status, headers, body: await response.text() }
    },
    { url, init },
  )
}

/**
 * Polls a BFF list endpoint until the named row reaches a terminal status, and
 * returns it. Reading the list the page itself reads keeps the wait honest:
 * it passes only when the product would show the same thing.
 */
export async function waitForRow<T extends { name?: string; title?: string; status: string }>(
  page: Page,
  listUrl: string,
  match: (row: T) => boolean,
  status: string,
  timeout = 45_000,
): Promise<T> {
  let found: T | undefined
  await expect
    .poll(
      async () => {
        const response = await bff(page, listUrl)
        if (response.status !== 200) return `HTTP ${response.status}`
        const body = JSON.parse(response.body)
        const rows: T[] = Array.isArray(body) ? body : (body.items ?? body.documents ?? [])
        found = rows.find(match)
        return found?.status ?? 'absent'
      },
      { timeout, intervals: [500, 1000, 2000] },
    )
    .toBe(status)
  return found!
}

export function toast(page: Page, title: string) {
  return page.getByText(title, { exact: true })
}
