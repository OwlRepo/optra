import { afterEach, describe, expect, it } from 'vitest'

import { getUmamiScriptProps } from './umami-script'

describe('getUmamiScriptProps', () => {
  const ORIGINAL_ENV = { ...process.env }

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('edge: returns null when NEXT_PUBLIC_UMAMI_WEBSITE_ID is unset', () => {
    delete process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID
    process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL = 'https://analytics.example.com/script.js'

    expect(getUmamiScriptProps()).toBeNull()
  })

  it('edge: returns null when NEXT_PUBLIC_UMAMI_SCRIPT_URL is unset even if the website id is set', () => {
    process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID = 'test-website-id'
    delete process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL

    expect(getUmamiScriptProps()).toBeNull()
  })

  it('happy: returns the script src and website id when both are set', () => {
    process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID = 'test-website-id'
    process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL = 'https://analytics.example.com/script.js'

    expect(getUmamiScriptProps()).toEqual({
      src: 'https://analytics.example.com/script.js',
      websiteId: 'test-website-id',
    })
  })
})
