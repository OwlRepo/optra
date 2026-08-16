import { ArgumentsHost, BadRequestException, Logger } from '@nestjs/common'
import { AllExceptionsFilter } from './all-exceptions.filter'

function makeHost(): { host: ArgumentsHost; status: jest.Mock; json: jest.Mock } {
  const json = jest.fn()
  const status = jest.fn().mockReturnValue({ json })
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ method: 'POST', url: '/workspaces/ws-1/procurement/discrepancies/compare' }),
    }),
  } as unknown as ArgumentsHost

  return { host, status, json }
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter
  let errorSpy: jest.SpyInstance

  beforeEach(() => {
    filter = new AllExceptionsFilter()
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('turns an unhandled Error into a 500 carrying a requestId, and logs the stack', () => {
    const { host, status, json } = makeHost()

    filter.catch(new Error('duckdb exploded'), host)

    expect(status).toHaveBeenCalledWith(500)
    const body = json.mock.calls[0][0]
    expect(body.statusCode).toBe(500)
    expect(body.message).toBe('Internal server error')
    expect(typeof body.requestId).toBe('string')
    expect(body.requestId.length).toBeGreaterThan(0)

    // The generic client message is only acceptable because the real cause is
    // logged under the same requestId — that pairing is the whole point.
    const logged = errorSpy.mock.calls[0].join(' ')
    expect(logged).toContain(body.requestId)
    expect(logged).toContain('duckdb exploded')
    expect(logged).toContain('POST')
    expect(logged).toContain('/workspaces/ws-1/procurement/discrepancies/compare')
  })

  it('never leaks the internal message to the client', () => {
    const { host, json } = makeHost()

    filter.catch(new Error('connection string postgres://user:secret@host/db'), host)

    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain('secret')
  })

  it('passes HttpExceptions through unchanged and does not log them as crashes', () => {
    const { host, status, json } = makeHost()

    filter.catch(new BadRequestException('Invoice has not finished parsing yet'), host)

    expect(status).toHaveBeenCalledWith(400)
    expect(json.mock.calls[0][0]).toMatchObject({
      statusCode: 400,
      message: 'Invoice has not finished parsing yet',
    })
    expect(json.mock.calls[0][0].requestId).toBeUndefined()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('gives each crash a distinct requestId', () => {
    const first = makeHost()
    const second = makeHost()

    filter.catch(new Error('boom'), first.host)
    filter.catch(new Error('boom'), second.host)

    expect(first.json.mock.calls[0][0].requestId).not.toBe(second.json.mock.calls[0][0].requestId)
  })
})
