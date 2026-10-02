import { session, type Session } from 'electron'
import type { NetworkProxySettings } from '../../shared/network-proxy'
import { applyProxySettingsToSession } from '../network/proxy-settings'

// Chromium verify-proc results: 0 accepts the certificate, -3 defers to Chromium's own verdict.
const ACCEPT_CERTIFICATE = 0
const USE_CHROMIUM_VERDICT = -3

let insecureSession: Session | null = null
let trustedHostname: string | null = null
// Why injected: this module holds no store handle; main passes a settings reader at startup.
let resolveNetworkProxySettings: (() => NetworkProxySettings) | null = null

export function setYouTrackNetworkProxySettingsResolver(
  resolver: (() => NetworkProxySettings) | null
): void {
  resolveNetworkProxySettings = resolver
}

/**
 * A dedicated, in-memory session for self-hosted YouTrack behind a self-signed or
 * internal-CA certificate. Why not the default session: a verify proc there would also
 * relax TLS for browser tabs and every other integration. Here only the configured
 * YouTrack hostname skips verification; any other host still gets Chromium's verdict.
 */
export async function getInsecureTlsSession(hostname: string): Promise<Session> {
  trustedHostname = hostname.toLowerCase()
  if (!insecureSession) {
    const created = session.fromPartition('orca-youtrack-insecure-tls', { cache: false })
    created.setCertificateVerifyProc((request, callback) => {
      callback(
        request.hostname.toLowerCase() === trustedHostname
          ? ACCEPT_CERTIFICATE
          : USE_CHROMIUM_VERDICT
      )
    })
    insecureSession = created
  }
  // Why every request: applying is memoized per session, and re-reading picks up proxy edits
  // made in Settings, so this partition follows Orca/env/system proxies like the default one.
  await applyProxySettingsToSession(insecureSession, resolveNetworkProxySettings?.() ?? {})
  return insecureSession
}
