import type { ArgumentsHost } from '@nestjs/common'
import { BadRequestException, ForbiddenException, PayloadTooLargeException } from '@nestjs/common'
import { MulterError } from 'multer'
import { PhotoUploadExceptionFilter, UploadExceptionFilter } from './upload-exception.filter'

function fakeHost() {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() }
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost
  return { host, res }
}

// One filter for every upload route (procurement, knowledge-base documents,
// datasets, catalogs). It used to be four copies, and all four shared the same
// blind spot: they caught MulterError, but @nestjs/platform-express's
// FileInterceptor converts LIMIT_FILE_SIZE into a PayloadTooLargeException
// BEFORE any filter sees it (transformException in multer.utils). So the
// "File exceeds NMB upload limit" message never reached a user; they got the
// framework's generic "File too large". The old unit test passed a raw
// MulterError - a shape the real pipeline never produces.
describe('UploadExceptionFilter', () => {
  const originalMax = process.env.MAX_UPLOAD_MB
  let filter: UploadExceptionFilter

  beforeEach(() => {
    process.env.MAX_UPLOAD_MB = '25'
    filter = new UploadExceptionFilter()
  })

  afterAll(() => {
    if (originalMax === undefined) delete process.env.MAX_UPLOAD_MB
    else process.env.MAX_UPLOAD_MB = originalMax
  })

  it('regression: the base filter leaves a single-file wrong field as its plain 400 "Unexpected field"', () => {
    const { host, res } = fakeHost()

    filter.catch(new BadRequestException('Unexpected field'), host)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ statusCode: 400, message: 'Unexpected field' })
  })

  it('edge: other multer codes are not swallowed by the base filter', () => {
    const { host } = fakeHost()
    const other = new MulterError('LIMIT_FIELD_COUNT')

    expect(() => filter.catch(other, host)).toThrow(other)
  })

  it('edge: the base filter does not map a raw LIMIT_UNEXPECTED_FILE MulterError either', () => {
    const { host } = fakeHost()
    const unexpected = new MulterError('LIMIT_UNEXPECTED_FILE', 'file')

    expect(() => filter.catch(unexpected, host)).toThrow(unexpected)
  })

  it('answers 413 with the limit for the PayloadTooLargeException FileInterceptor actually throws', () => {
    const { host, res } = fakeHost()

    filter.catch(new PayloadTooLargeException('File too large'), host)

    expect(res.status).toHaveBeenCalledWith(413)
    expect(res.json).toHaveBeenCalledWith({ statusCode: 413, message: 'File exceeds 25MB upload limit' })
  })

  it('names the configured limit, not a hard-coded one', () => {
    process.env.MAX_UPLOAD_MB = '1'
    const { host, res } = fakeHost()

    new UploadExceptionFilter().catch(new PayloadTooLargeException('File too large'), host)

    expect(res.json).toHaveBeenCalledWith({ statusCode: 413, message: 'File exceeds 1MB upload limit' })
  })

  it('still answers 413 for a raw MulterError, should one ever arrive unconverted', () => {
    const { host, res } = fakeHost()

    filter.catch(new MulterError('LIMIT_FILE_SIZE'), host)

    expect(res.status).toHaveBeenCalledWith(413)
    expect(res.json).toHaveBeenCalledWith({ statusCode: 413, message: 'File exceeds 25MB upload limit' })
  })

  it('flattens a plain-string rejection from a fileFilter', () => {
    const { host, res } = fakeHost()

    filter.catch(new BadRequestException('Only CSV, XLSX, or PDF files are supported'), host)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      statusCode: 400,
      message: 'Only CSV, XLSX, or PDF files are supported',
    })
  })

  // ValidationPipe throws a body whose `message` is an ARRAY of per-field
  // errors; flattening it would lose the detail the upload form shows.
  it('preserves the per-field message array from a validation failure', () => {
    const { host, res } = fakeHost()
    const validationError = new BadRequestException({
      statusCode: 400,
      message: ['vendorId must be a UUID', 'currency must be a 3-letter ISO 4217 code'],
      error: 'Bad Request',
    })

    filter.catch(validationError, host)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      statusCode: 400,
      message: ['vendorId must be a UUID', 'currency must be a 3-letter ISO 4217 code'],
      error: 'Bad Request',
    })
  })

  it('rethrows anything that is not an upload problem, untouched', () => {
    const { host } = fakeHost()
    const forbidden = new ForbiddenException()

    expect(() => filter.catch(forbidden as never, host)).toThrow(forbidden)
  })
})

// Only the three */photos routes accept many files, so only they read multer's
// "unexpected field" as "a 6th file".
describe('PhotoUploadExceptionFilter', () => {
  const filter = new PhotoUploadExceptionFilter()

  it('error: the BadRequestException FilesInterceptor throws for a 6th file answers 400 "Too many files"', () => {
    const { host, res } = fakeHost()

    filter.catch(new BadRequestException('Unexpected field'), host)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ statusCode: 400, message: 'Too many files' })
  })

  it('error: a raw LIMIT_UNEXPECTED_FILE MulterError answers 400 "Too many files" without echoing the field name', () => {
    const { host, res } = fakeHost()

    filter.catch(new MulterError('LIMIT_UNEXPECTED_FILE', 'someInternalField'), host)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ statusCode: 400, message: 'Too many files' })
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('someInternalField')
  })

  it('edge: other multer codes are still not swallowed', () => {
    const { host } = fakeHost()
    const other = new MulterError('LIMIT_FIELD_COUNT')

    expect(() => filter.catch(other, host)).toThrow(other)
  })

  it('regression: everything else behaves like the base filter (413 and plain-string 400)', () => {
    const big = fakeHost()
    filter.catch(new PayloadTooLargeException('File too large'), big.host)
    expect(big.res.status).toHaveBeenCalledWith(413)

    const plain = fakeHost()
    filter.catch(new BadRequestException('Photos must be JPEG, PNG or WebP images'), plain.host)
    expect(plain.res.json).toHaveBeenCalledWith({ statusCode: 400, message: 'Photos must be JPEG, PNG or WebP images' })
  })
})
