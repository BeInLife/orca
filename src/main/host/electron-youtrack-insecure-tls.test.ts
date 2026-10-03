import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  let verifyProc:
    | ((request: { hostname: string }, callback: (result: number) => void) => void)
    | null = null
  const fakeSession = {
    setCertificateVerifyProc: vi.fn((proc: typeof verifyProc) => {
      verifyProc = proc
    }),
    fetch: vi.fn()
  }
  return {
    fakeSession,
    verify: (hostname: string): number => {
      let result = Number.NaN
      verifyProc?.({ hostname }, (value) => {
        result = value
      })
      return result
    },
    applyProxySettingsToSession: vi.fn(async () => ({ source: 'system' }))
  }
})

vi.mock('electron', () => ({ session: { fromPartition: () => mocks.fakeSession } }))
vi.mock('../network/proxy-settings', () => ({
  applyProxySettingsToSession: mocks.applyProxySettingsToSession
}))

const { getInsecureTlsSession } = await import('./electron-youtrack-insecure-tls')

describe('getInsecureTlsSession', () => {
  it('applies the current Orca proxy settings before every use', async () => {
    await getInsecureTlsSession('yt.corp', { httpProxyUrl: 'http://proxy.corp:3128' })
    await getInsecureTlsSession('yt.corp', { httpProxyUrl: 'http://other:8080' })
    expect(mocks.applyProxySettingsToSession).toHaveBeenNthCalledWith(1, mocks.fakeSession, {
      httpProxyUrl: 'http://proxy.corp:3128'
    })
    expect(mocks.applyProxySettingsToSession).toHaveBeenNthCalledWith(2, mocks.fakeSession, {
      httpProxyUrl: 'http://other:8080'
    })
  })

  it('relaxes certificate checks for the YouTrack host only', async () => {
    await getInsecureTlsSession('YT.corp', {})
    expect(mocks.verify('yt.corp')).toBe(0)
    expect(mocks.verify('evil.example.com')).toBe(-3)
  })
})
