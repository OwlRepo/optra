import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { OffsetQueryDto } from './offset-query.dto'

describe('OffsetQueryDto', () => {
  it('accepts a full valid offset query', async () => {
    const errors = await validate(
      plainToInstance(OffsetQueryDto, {
        page: '3',
        pageSize: '25',
        q: 'invoice',
        sort: 'createdAt',
        sortDir: 'desc',
      }),
    )
    expect(errors).toHaveLength(0)
  })

  it('accepts an empty query (all optional)', async () => {
    const errors = await validate(plainToInstance(OffsetQueryDto, {}))
    expect(errors).toHaveLength(0)
  })

  it.each(['abc', '1.5', '-2'])('rejects non-integer page %s', async (page) => {
    const errors = await validate(plainToInstance(OffsetQueryDto, { page }))
    expect(errors.length).toBeGreaterThan(0)
  })

  it.each(['0', '101', 'abc'])('rejects out-of-range pageSize %s', async (pageSize) => {
    const errors = await validate(plainToInstance(OffsetQueryDto, { pageSize }))
    expect(errors.length).toBeGreaterThan(0)
  })

  it('rejects an unknown sort direction', async () => {
    const errors = await validate(plainToInstance(OffsetQueryDto, { sortDir: 'up' }))
    expect(errors.length).toBeGreaterThan(0)
  })
})
