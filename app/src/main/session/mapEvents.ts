import type { SessionTransportEvent } from './transport'

/**
 * Maps one `claude -p --output-format stream-json` NDJSON line to zero or
 * more SessionTransportEvents. Several shapes are handled, per Workspace-OS's
 * `agent-activity.ts` (ported logic, not ported code — see
 * docs/research/external-analysis and the approved Foundation plan):
 *
 *  (A) a complete `assistant` message, `content[]` holding `text` /
 *      `thinking` / `tool_use` blocks — confirmed live against the real
 *      `claude` CLI in chunk 1's spike (see app/scripts/spike-transport.mjs).
 *  (B) a streamed `content_block_start` inside a `stream_event` wrapper
 *      (partial-message deltas, from `--include-partial-messages`) — not
 *      yet exercised by a real run complex enough to produce one; handled
 *      defensively here and flagged for re-verification in chunk 5 against
 *      a real multi-tool-call session, not assumed correct.
 *  (C) a `"system"` event whose subtype starts with `task_` — a subagent's
 *      live status (spawned via a `tool_use` block named `"Agent"`, shape A).
 *      Confirmed live in Workstream C chunk 4 against a real run that
 *      actually spawned a subagent.
 *
 * `thinking` blocks are deliberately discarded — never surfaced in the UI,
 * per product pillar 2 ("never raw text," extended to reasoning traces).
 */
export function mapEvents(line: string): SessionTransportEvent[] {
  const trimmed = line.trim()
  if (!trimmed) return []

  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(trimmed)
  } catch {
    return []
  }

  const out: SessionTransportEvent[] = []

  if (obj.type === 'system' && obj.subtype === 'init') {
    out.push({
      kind: 'session-id',
      payload: { sessionId: obj.session_id, model: obj.model },
    })
    return out
  }

  // Shape A: a complete assistant message.
  const message = obj.message as { content?: unknown[] } | undefined
  if (obj.type === 'assistant' && Array.isArray(message?.content)) {
    for (const raw of message.content) {
      const block = raw as Record<string, unknown>
      if (block.type === 'text' && typeof block.text === 'string') {
        out.push({ kind: 'text', payload: { text: block.text } })
      } else if (block.type === 'tool_use') {
        out.push({
          kind: 'tool-call',
          // `id` (the tool_use's own id, e.g. "toolu_...") is carried through
          // so sessionManager.ts can link a later-arriving `task_started`
          // event's `tool_use_id` back to the specific ActivityLogEntry this
          // tool-call produces — see Subagent.parentActivityLogEntryId.
          payload: { id: block.id, name: block.name, input: block.input, status: 'started' },
        })
      }
      // 'thinking' blocks: discarded.
    }
    return out
  }

  // Shape B: a streamed partial-message delta.
  if (obj.type === 'stream_event') {
    const event = obj.event as Record<string, unknown> | undefined
    if (event?.type === 'content_block_start') {
      const block = event.content_block as Record<string, unknown> | undefined
      if (block?.type === 'tool_use') {
        out.push({
          kind: 'tool-call',
          payload: { id: block.id, name: block.name, input: block.input, status: 'started' },
        })
      }
    }
    return out
  }

  // The main agent spawning a subagent is a normal `tool_use` block (Shape A
  // above, name `"Agent"`) — but its LIVE status comes from a separate
  // family of `system` events, confirmed live against a real multi-turn
  // `claude` run that actually spawned a subagent (see the Workstream C
  // chunk-4 spike): `task_started` (subagent begins), `task_progress`
  // (still running, carries `last_tool_name`), `task_updated` (a status
  // patch — `completed`/`failed`), and `task_notification` (the final
  // word, with a plain-language `summary`). All four share a stable
  // `task_id` that is NOT the same as the `Agent` tool_use's own id.
  if (obj.type === 'system' && typeof obj.subtype === 'string' && obj.subtype.startsWith('task_')) {
    const taskId = obj.task_id as string | undefined
    if (!taskId) return out

    if (obj.subtype === 'task_started') {
      out.push({
        kind: 'subagent',
        payload: {
          taskId,
          // The real `Agent` tool_use's own id — lets sessionManager.ts link
          // this subagent back to the specific ActivityLogEntry row for the
          // tool-call that spawned it (Subagent.parentActivityLogEntryId).
          toolUseId: obj.tool_use_id,
          subagentType: obj.subagent_type,
          description: obj.description,
          status: 'active',
          lastAction: 'started',
        },
      })
    } else if (obj.subtype === 'task_progress') {
      out.push({
        kind: 'subagent',
        payload: {
          taskId,
          status: 'active',
          lastAction: typeof obj.last_tool_name === 'string' ? `Running ${obj.last_tool_name}` : undefined,
        },
      })
    } else if (obj.subtype === 'task_updated') {
      const patch = obj.patch as Record<string, unknown> | undefined
      if (patch?.status === 'completed' || patch?.status === 'failed') {
        out.push({ kind: 'subagent', payload: { taskId, status: 'done' } })
      }
    } else if (obj.subtype === 'task_notification') {
      out.push({
        kind: 'subagent',
        payload: { taskId, status: 'done', lastAction: typeof obj.summary === 'string' ? obj.summary : undefined },
      })
    }
    return out
  }

  // JevGuard (Workstream J) — a blocked tool call arrives as an ordinary
  // `"type":"user"` tool_result message, `is_error: true`, with content in
  // the exact shape Claude Code itself produces for a `PreToolUse` hook
  // denial: `"PreToolUse:<ToolName> hook error: <reason>"` — live-verified
  // against the real CLI during planning. Only JevGuard's own reason text
  // (always starting "JevGuard blocked…", set in `hooks/jevGuard.ts`) is
  // recognized here — any other hook/permission denial is deliberately left
  // as an ordinary failed tool call, not mislabeled.
  if (obj.type === 'user') {
    const content = (obj.message as { content?: unknown[] } | undefined)?.content
    if (Array.isArray(content)) {
      for (const raw of content) {
        const block = raw as Record<string, unknown>
        if (block.type !== 'tool_result' || block.is_error !== true || typeof block.content !== 'string') continue
        const match = block.content.match(/^PreToolUse:(\S+) hook error: (JevGuard blocked[\s\S]*)$/)
        if (match) {
          out.push({
            kind: 'jev-guard-blocked',
            payload: { toolUseId: block.tool_use_id, toolName: match[1], reason: match[2] },
          })
        }
      }
    }
    return out
  }

  if (obj.type === 'result') {
    // Real token breakdown the CLI already reports on every turn (confirmed
    // live, Foundation workstream's own spike) — previously parsed but
    // discarded; captured now per docs/research/observability-landscape-2026.md.
    const usage = obj.usage as Record<string, unknown> | undefined
    out.push({
      kind: 'usage',
      payload: {
        costUsd: obj.total_cost_usd,
        durationMs: obj.duration_ms,
        isError: obj.is_error,
        result: obj.result,
        inputTokens: usage?.input_tokens,
        outputTokens: usage?.output_tokens,
        cacheReadTokens: usage?.cache_read_input_tokens,
        cacheCreationTokens: usage?.cache_creation_input_tokens,
      },
    })
    return out
  }

  return out
}
