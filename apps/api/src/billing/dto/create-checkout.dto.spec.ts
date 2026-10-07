import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CreateCheckoutDto } from './create-checkout.dto'

const errorsFor = (value: unknown) => validate(plainToInstance(CreateCheckoutDto, value))

describe('CreateCheckoutDto', () => {
  it.each(['pro', 'enterprise', '', 'SOLO', null, 1])('error: a plan other than solo or team is rejected (%p)', async (plan) => {
    expect((await errorsFor({ plan })).length).toBeGreaterThan(0)
  })

  it('error: a missing plan is rejected', async () => {
    expect((await errorsFor({})).length).toBeGreaterThan(0)
  })

  it.each([0, 26, 1.5, '3', -1])('error: seats 0, 26, 1.5 and a numeric string are rejected (%p)', async (seats) => {
    expect((await errorsFor({ plan: 'team', seats })).length).toBeGreaterThan(0)
  })

  it('edge: seats may be omitted', async () => {
    expect(await errorsFor({ plan: 'team' })).toHaveLength(0)
    expect(await errorsFor({ plan: 'solo' })).toHaveLength(0)
  })

  it('happy: solo, and team with seats 1 and 25, are accepted', async () => {
    expect(await errorsFor({ plan: 'solo' })).toHaveLength(0)
    expect(await errorsFor({ plan: 'team', seats: 1 })).toHaveLength(0)
    expect(await errorsFor({ plan: 'team', seats: 25 })).toHaveLength(0)
  })
})
