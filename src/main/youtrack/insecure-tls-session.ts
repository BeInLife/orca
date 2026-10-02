import { session, type Session } from 'electron'

// Chromium verify-proc results: 0 accepts the certificate, -3 defers to Chromium's own verdict.
const ACCEPT_CERTIFICATE = 0
const USE_CHROMIUM_VERDICT = -3

let insecureSession: Session | null = null
let trustedHostname: string | null = null

/**
 * A dedicated, in-memory session for self-hosted YouTrack behind a self-signed or
 * internal-CA certificate. Why not the default session: a verify proc there would also
 * relax TLS for browser tabs and every other integration. Here only the configured
 * YouTrack hostname skips verification; any other host still gets Chromium's verdict.
 */
export function getInsecureTlsSession(hostname: string): Session {
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
    void created.setProxy({ mode: 'system' })
    insecureSession = created
  }
  return insecureSession
}
