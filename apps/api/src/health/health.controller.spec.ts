import { Test, type TestingModule } from '@nestjs/testing'
import { HealthController } from './health.controller'

describe('HealthController', () => {
  let controller: HealthController

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile()

    controller = module.get<HealthController>(HealthController)
  })

  it('is defined', () => {
    expect(controller).toBeDefined()
  })

  it('returns ok status with no dependencies', () => {
    expect(controller.check()).toEqual({ status: 'ok' })
  })
})
