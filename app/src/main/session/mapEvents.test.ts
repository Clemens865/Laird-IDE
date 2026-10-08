import { describe, expect, it } from 'vitest'
import { mapEvents } from './mapEvents'

// Fixtures: the real NDJSON lines captured live in chunk 1's spike
// (app/scripts/spike-transport.mjs) and chunk 3's own manual verification —
// not synthesized, to keep this test honest about what the real CLI emits.

describe('mapEvents', () => {
  it('maps a system/init line to a session-id event', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'init',
      session_id: 'a9938324-566b-4c37-9698-b84e7f96c738',
      model: 'claude-haiku-4-5-20251001',
    })
    expect(mapEvents(line)).toEqual([
      { kind: 'session-id', payload: { sessionId: 'a9938324-566b-4c37-9698-b84e7f96c738', model: 'claude-haiku-4-5-20251001' } },
    ])
  })

  it('maps an assistant message with a tool_use block to a tool-call event', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Write', input: { file_path: '/tmp/hello.txt', content: 'hi' } },
        ],
      },
    })
    const events = mapEvents(line)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'tool-call', payload: { name: 'Write', status: 'started' } })
  })

  it('maps an assistant message with a text block to a text event', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Done.' }] },
    })
    expect(mapEvents(line)).toEqual([{ kind: 'text', payload: { text: 'Done.' } }])
  })

  it('discards thinking blocks', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'thinking', thinking: 'internal reasoning' }] },
    })
    expect(mapEvents(line)).toEqual([])
  })

  it('maps a streamed tool_use content_block_start to a tool-call event', () => {
    const line = JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'Edit', input: {} } },
    })
    const events = mapEvents(line)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'tool-call', payload: { name: 'Edit' } })
  })

  it('maps a result line to a usage event', () => {
    const line = JSON.stringify({
      type: 'result',
      total_cost_usd: 0.0505993,
      duration_ms: 4670,
      is_error: false,
      result: 'Done.',
    })
    expect(mapEvents(line)).toEqual([
      { kind: 'usage', payload: { costUsd: 0.0505993, durationMs: 4670, isError: false, result: 'Done.' } },
    ])
  })

  it('captures the real token breakdown from a result line\'s usage object, not just cost/duration', () => {
    const line = JSON.stringify({
      type: 'result',
      total_cost_usd: 0.01,
      duration_ms: 1000,
      is_error: false,
      result: 'Done.',
      usage: { input_tokens: 17, output_tokens: 238, cache_read_input_tokens: 21604, cache_creation_input_tokens: 21884 },
    })
    expect(mapEvents(line)).toEqual([
      {
        kind: 'usage',
        payload: {
          costUsd: 0.01,
          durationMs: 1000,
          isError: false,
          result: 'Done.',
          inputTokens: 17,
          outputTokens: 238,
          cacheReadTokens: 21604,
          cacheCreationTokens: 21884,
        },
      },
    ])
  })

  it('carries the real tool_use id through on a tool-call event, for later subagent-parent linkage', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'toolu_abc123', name: 'Write', input: {} }] },
    })
    const events = mapEvents(line)
    expect(events[0]).toMatchObject({ kind: 'tool-call', payload: { id: 'toolu_abc123', name: 'Write' } })
  })

  // Fixtures below are the real captured task_* lines from the Workstream C
  // chunk-4 spike (a real `claude` run that spawned a real subagent via the
  // `Agent` tool) — not synthesized.

  it('maps a task_started line to an active subagent event', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'task_started',
      task_id: 'a3252556f74317899',
      tool_use_id: 'toolu_0194Hz8UReLdrGPBt15b4wnE',
      description: 'Count files in current directory',
      subagent_type: 'general-purpose',
      is_backgrounded: false,
    })
    expect(mapEvents(line)).toEqual([
      {
        kind: 'subagent',
        payload: {
          taskId: 'a3252556f74317899',
          toolUseId: 'toolu_0194Hz8UReLdrGPBt15b4wnE',
          subagentType: 'general-purpose',
          description: 'Count files in current directory',
          status: 'active',
          lastAction: 'started',
        },
      },
    ])
  })

  it('maps a task_progress line to an active subagent event with a last-tool lastAction', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'task_progress',
      task_id: 'a3252556f74317899',
      description: 'Running Count files in current directory',
      last_tool_name: 'Bash',
    })
    expect(mapEvents(line)).toEqual([
      { kind: 'subagent', payload: { taskId: 'a3252556f74317899', status: 'active', lastAction: 'Running Bash' } },
    ])
  })

  it('maps a task_updated completed patch to a done subagent event', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'task_updated',
      task_id: 'a3252556f74317899',
      patch: { status: 'completed', end_time: 1791373658947 },
    })
    expect(mapEvents(line)).toEqual([{ kind: 'subagent', payload: { taskId: 'a3252556f74317899', status: 'done' } }])
  })

  it('ignores a task_updated patch that is not a completion/failure', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'task_updated',
      task_id: 'a3252556f74317899',
      patch: { status: 'running' },
    })
    expect(mapEvents(line)).toEqual([])
  })

  it('maps a task_notification line to a done subagent event with its summary', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'a3252556f74317899',
      status: 'completed',
      summary: '0',
    })
    expect(mapEvents(line)).toEqual([
      { kind: 'subagent', payload: { taskId: 'a3252556f74317899', status: 'done', lastAction: '0' } },
    ])
  })

  it('maps an Agent tool_use block to a plain tool-call event (subagent liveness comes from task_* lines, not this)', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            name: 'Agent',
            input: { description: 'Count files', subagent_type: 'general-purpose', prompt: 'count' },
          },
        ],
      },
    })
    const events = mapEvents(line)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'tool-call', payload: { name: 'Agent', status: 'started' } })
  })

  // Workstream J (JevGuard) — the exact real `"type":"user"` tool_result
  // shape captured live during planning against the real CLI (2.1.294),
  // for a hook that returned `permissionDecision: "deny"`.
  it('maps a real JevGuard-blocked tool_result to a jev-guard-blocked event', () => {
    const line = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            tool_use_id: 'toolu_01JRYALSwAiRyVd19xBG8fAt',
            type: 'tool_result',
            content:
              'PreToolUse:Bash hook error: JevGuard blocked this Bash call — 92% confidence it would destroy or irreversibly overwrite real data.',
            is_error: true,
          },
        ],
      },
    })
    expect(mapEvents(line)).toEqual([
      {
        kind: 'jev-guard-blocked',
        payload: {
          toolUseId: 'toolu_01JRYALSwAiRyVd19xBG8fAt',
          toolName: 'Bash',
          reason: 'JevGuard blocked this Bash call — 92% confidence it would destroy or irreversibly overwrite real data.',
        },
      },
    ])
  })

  it('does not mistake an ordinary (non-JevGuard) tool error for a JevGuard block', () => {
    const line = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ tool_use_id: 't1', type: 'tool_result', content: 'File not found: /tmp/missing.txt', is_error: true }],
      },
    })
    expect(mapEvents(line)).toEqual([])
  })

  it('ignores a real (non-error) tool_result line entirely', () => {
    const line = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ tool_use_id: 't1', type: 'tool_result', content: '1\thello world\n', is_error: false }] },
    })
    expect(mapEvents(line)).toEqual([])
  })

  it('returns an empty array for an unparseable line', () => {
    expect(mapEvents('not json')).toEqual([])
  })

  it('returns an empty array for an empty line', () => {
    expect(mapEvents('')).toEqual([])
    expect(mapEvents('   ')).toEqual([])
  })
})
