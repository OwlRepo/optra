import { maxUploadBytes, maxUploadMb } from './upload-limit'

describe('upload limit', () => {
  const original = process.env.MAX_UPLOAD_MB

  afterEach(() => {
    if (original === undefined) delete process.env.MAX_UPLOAD_MB
    else process.env.MAX_UPLOAD_MB = original
  })

  it.each(['', 'abc', '0', '-5'])('error: falls back to 25 MB for %p', (value) => {
    process.env.MAX_UPLOAD_MB = value
    expect(maxUploadMb()).toBe(25)
  })

  it('edge: is 25 MB when MAX_UPLOAD_MB is unset', () => {
    delete process.env.MAX_UPLOAD_MB
    expect(maxUploadMb()).toBe(25)
  })

  it('happy: reads MAX_UPLOAD_MB and converts it to bytes', () => {
    process.env.MAX_UPLOAD_MB = '10'
    expect(maxUploadMb()).toBe(10)
    expect(maxUploadBytes()).toBe(10 * 1024 * 1024)
  })
})
