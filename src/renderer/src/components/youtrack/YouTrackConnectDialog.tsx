import { useId, useState } from 'react'
import { LoaderCircle, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import { useYouTrackStore } from './youtrack-store'

export function YouTrackConnectDialog({
  open,
  onOpenChange,
  onConnected
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnected?: () => void
}): React.JSX.Element {
  const connect = useYouTrackStore((s) => s.connect)
  const savedBaseUrl = useYouTrackStore((s) => s.status.baseUrl)
  const [baseUrl, setBaseUrl] = useState(savedBaseUrl ?? '')
  const [token, setToken] = useState('')
  const savedAllowInsecureTls = useYouTrackStore((s) => s.status.allowInsecureTls === true)
  const [allowInsecureTls, setAllowInsecureTls] = useState(savedAllowInsecureTls)
  const insecureTlsId = useId()
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const baseUrlId = useId()
  const tokenId = useId()
  const canSubmit = baseUrl.trim().length > 0 && token.trim().length > 0 && !submitting

  const handleOpenChange = (next: boolean): void => {
    if (submitting) {
      return
    }
    if (!next) {
      setToken('')
      setError(null)
    }
    onOpenChange(next)
  }

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit) {
      return
    }
    setSubmitting(true)
    setError(null)
    const result = await connect(baseUrl, token, allowInsecureTls)
    setSubmitting(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setToken('')
    onOpenChange(false)
    onConnected?.()
  }

  const tokenSettingsUrl = (() => {
    try {
      return baseUrl.trim()
        ? new URL('users/me?tab=account-security', `${baseUrl.trim().replace(/\/+$/, '')}/`).href
        : null
    } catch {
      return null
    }
  })()

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{translate('youtrack.connect.title', 'Connect YouTrack')}</DialogTitle>
          <DialogDescription>
            {translate(
              'youtrack.connect.description',
              'Use your YouTrack address and a permanent token to browse and update issues.'
            )}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void handleSubmit()
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor={baseUrlId}>
              {translate('youtrack.connect.baseUrl', 'YouTrack URL')}
            </Label>
            <Input
              id={baseUrlId}
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://youtrack.example.com"
              autoFocus
              disabled={submitting}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={tokenId}>
              {translate('youtrack.connect.token', 'Permanent token')}
            </Label>
            <Input
              id={tokenId}
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="perm:…"
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">
              {translate(
                'youtrack.connect.tokenHint',
                'Create one under Profile → Account Security'
              )}
              {tokenSettingsUrl ? (
                <>
                  {' · '}
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs align-baseline"
                    onClick={() => void window.api.shell.openUrl(tokenSettingsUrl)}
                  >
                    {translate('youtrack.connect.openTokenSettings', 'open in YouTrack')}
                  </Button>
                </>
              ) : null}
            </p>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id={insecureTlsId}
              checked={allowInsecureTls}
              onCheckedChange={(checked) => setAllowInsecureTls(checked === true)}
              disabled={submitting}
              className="mt-0.5"
            />
            <div className="grid gap-0.5">
              <Label htmlFor={insecureTlsId}>
                {translate('youtrack.connect.insecureTls', 'Skip certificate verification')}
              </Label>
              <p className="text-xs text-muted-foreground">
                {translate(
                  'youtrack.connect.insecureTlsHint',
                  'For self-signed or internal-CA certificates. Applies only to this YouTrack host; use it only on networks you trust.'
                )}
              </p>
            </div>
          </div>
          {error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Lock className="mt-0.5 size-3 shrink-0" />
            {translate(
              'youtrack.connect.storageNote',
              'Your token is stored locally and encrypted when the OS keychain is available.'
            )}
          </p>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
              {translate('youtrack.connect.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {translate('youtrack.connect.submit', 'Connect')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
