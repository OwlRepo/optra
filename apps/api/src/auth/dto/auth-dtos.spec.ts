import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { RegisterDto } from './register.dto'
import { LoginDto } from './login.dto'
import { VerifyOtpDto } from './verify-otp.dto'

async function errorsFor<T extends object>(cls: new () => T, plain: object) {
  const instance = plainToInstance(cls, plain)
  return validate(instance)
}

describe('RegisterDto', () => {
  it('accepts a valid email and an 8-character password (lower boundary)', async () => {
    const errors = await errorsFor(RegisterDto, { email: 'a@example.com', password: '12345678' })
    expect(errors).toHaveLength(0)
  })

  it('rejects a 7-character password (just under the boundary)', async () => {
    const errors = await errorsFor(RegisterDto, { email: 'a@example.com', password: '1234567' })
    expect(errors).toHaveLength(1)
    expect(errors[0].constraints).toHaveProperty('minLength')
  })

  it('rejects an email with no domain', async () => {
    const errors = await errorsFor(RegisterDto, { email: 'not-an-email', password: '12345678' })
    expect(errors).toHaveLength(1)
    expect(errors[0].constraints).toHaveProperty('isEmail')
  })

  it('rejects an empty email', async () => {
    const errors = await errorsFor(RegisterDto, { email: '', password: '12345678' })
    expect(errors.length).toBeGreaterThan(0)
  })
})

describe('LoginDto', () => {
  it('accepts a valid email and password', async () => {
    const errors = await errorsFor(LoginDto, { email: 'a@example.com', password: '12345678' })
    expect(errors).toHaveLength(0)
  })

  it('rejects a missing password', async () => {
    const errors = await errorsFor(LoginDto, { email: 'a@example.com' })
    expect(errors.length).toBeGreaterThan(0)
  })
})

describe('VerifyOtpDto', () => {
  it('accepts a 6-digit code', async () => {
    const errors = await errorsFor(VerifyOtpDto, { email: 'a@example.com', code: '123456' })
    expect(errors).toHaveLength(0)
  })

  it('rejects a 5-digit code (just under the boundary)', async () => {
    const errors = await errorsFor(VerifyOtpDto, { email: 'a@example.com', code: '12345' })
    expect(errors).toHaveLength(1)
    expect(errors[0].constraints).toHaveProperty('isLength')
  })

  it('rejects a 7-digit code (just over the boundary)', async () => {
    const errors = await errorsFor(VerifyOtpDto, { email: 'a@example.com', code: '1234567' })
    expect(errors).toHaveLength(1)
    expect(errors[0].constraints).toHaveProperty('isLength')
  })

  it('documents current behavior: 6 letters pass DTO validation (Length checks size, not digits)', async () => {
    const errors = await errorsFor(VerifyOtpDto, { email: 'a@example.com', code: 'abcdef' })
    expect(errors).toHaveLength(0)
  })
})
