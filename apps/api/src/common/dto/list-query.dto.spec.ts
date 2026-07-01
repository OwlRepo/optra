import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { ListQueryDto } from './list-query.dto'

describe('ListQueryDto', () => {
  it('accepts optional cursor and numeric-string limit', async () => {
    const errors = await validate(plainToInstance(ListQueryDto, { cursor: 'abc', limit: '20' }))
    expect(errors).toHaveLength(0)
  })

  it.each(['0', '101', 'abc'])('rejects invalid limit %s', async (limit) => {
    const errors = await validate(plainToInstance(ListQueryDto, { limit }))
    expect(errors.length).toBeGreaterThan(0)
  })

  it('accepts omitted cursor and limit', async () => {
    const errors = await validate(plainToInstance(ListQueryDto, {}))
    expect(errors).toHaveLength(0)
  })
})
