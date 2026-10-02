import { expect, it } from 'vitest'
import { parseOpenCodeUsageRow } from './opencode-usage-row-parsing'

it.each([
  { input: 638, read: 642944, write: 1024, total: 644706 },
  { input: 0, read: 0, write: 1024, total: 1124 }
])(
  'preserves cache writes and uncached input in $total tokens',
  ({ input, read, write, total }) => {
    const parsed = parseOpenCodeUsageRow({
      id: 'cache-write-message',
      session_id: 'cache-write-session',
      time_created: 1_777_777_700_000,
      time_updated: null,
      directory: null,
      title: null,
      worktree: null,
      session_model: null,
      data: JSON.stringify({
        tokens: { input, output: 100, reasoning: 0, total, cache: { read, write } }
      })
    })
    expect(parsed).toMatchObject({
      inputTokens: input + read + write,
      cachedInputTokens: read + write,
      outputTokens: 100,
      totalTokens: total
    })
    expect((parsed?.inputTokens ?? 0) - (parsed?.cachedInputTokens ?? 0)).toBe(input)
  }
)
