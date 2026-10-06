import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const params = Promise.resolve({ id: 'ws-1' })
const URL = 'http://localhost:3000/api/workspaces/ws-1/procurement/invoices/photos'

function photoForm(count: number) {
  const form = new FormData()
  for (let i = 1; i <= count; i += 1) {
    form.append('files', new File([`jpeg-${i}`], `page-${i}.jpg`, { type: 'image/jpeg' }))
  }
  form.append('currency', 'USD')
  return form
}

describe('POST /api/workspaces/[id]/procurement/invoices/photos proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('error: returns 401 without calling the backend when the auth cookie is missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(new NextRequest(URL, { method: 'POST', body: photoForm(1) }), { params })

    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('error: passes the backend 400 message through unchanged', async () => {
    const message = 'HEIC/HEIF photos are not supported — export as JPEG and upload again'
    const fetchMock = vi.fn().mockResolvedValue({ status: 400, json: async () => ({ message }) } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(
      new NextRequest(URL, { method: 'POST', headers: { cookie: 'mnemra_at=test-access-token' }, body: photoForm(1) }),
      { params },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ message })
  })

  it('edge: forwards every page under the same "files" field, in order', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 201, json: async () => ({ id: 'doc-1' }) } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)

    await POST(
      new NextRequest(URL, { method: 'POST', headers: { cookie: 'mnemra_at=test-access-token' }, body: photoForm(3) }),
      { params },
    )

    const sent = fetchMock.mock.calls[0]?.[1]?.body as FormData
    expect(sent.getAll('files').map((file) => (file as File).name)).toEqual(['page-1.jpg', 'page-2.jpg', 'page-3.jpg'])
    expect(sent.get('currency')).toBe('USD')
  })

  it('happy: forwards multipart with the bearer to the photos path and no JSON content-type', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 201, json: async () => ({ id: 'doc-1', status: 'pending' }) } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(
      new NextRequest(URL, { method: 'POST', headers: { cookie: 'mnemra_at=test-access-token' }, body: photoForm(2) }),
      { params },
    )

    const call = fetchMock.mock.calls[0]
    expect(call?.[0]).toBe('http://localhost:3001/workspaces/ws-1/procurement/invoices/photos')
    expect(call?.[1]?.method).toBe('POST')
    expect(call?.[1]?.headers).toEqual({ Authorization: 'Bearer test-access-token' })
    expect(call?.[1]?.body).toBeInstanceOf(FormData)
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ id: 'doc-1', status: 'pending' })
  })
})
