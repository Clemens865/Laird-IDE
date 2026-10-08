import { useEffect, useState } from 'react'
import type { EvidenceTier, HarnessDisposition, HarnessRun, Project } from '../../shared/types'
import { LivePreviewPanel } from './LivePreviewPanel'

const DISPOSITION_LABEL: Record<HarnessDisposition, string> = {
  ship: 'SHIP',
  hold: 'HOLD',
  rework: 'REWORK',
  unverifiable: 'UNVERIFIABLE',
}

const DISPOSITION_COLOR: Record<HarnessDisposition, { fg: string; bg: string }> = {
  ship: { fg: 'var(--state-success)', bg: 'var(--state-success-soft)' },
  hold: { fg: 'var(--state-warning)', bg: 'var(--state-warning-soft)' },
  rework: { fg: 'var(--state-danger)', bg: 'var(--state-danger-soft)' },
  unverifiable: { fg: 'var(--state-info)', bg: 'var(--state-info-soft)' },
}

// Evidence tiers are a second, independent dimension from disposition — how
// much to trust the verdict, not whether it's good or bad news. Muted the
// less real evidence backs a claim (STATED is just the agent's own word);
// colored only once something outside the agent's own say-so backs it.
const EVIDENCE_COLOR: Record<EvidenceTier, { fg: string; bg: string }> = {
  VERIFIED: { fg: 'var(--state-success)', bg: 'var(--state-success-soft)' },
  CORROBORATED: { fg: 'var(--state-info)', bg: 'var(--state-info-soft)' },
  UNCORROBORATED: { fg: 'var(--muted)', bg: 'var(--surface-raised)' },
  INFERENCE: { fg: 'var(--muted)', bg: 'var(--surface-raised)' },
  STATED: { fg: 'var(--muted)', bg: 'var(--surface-raised)' },
}

function Badge({ label, color }: { label: string; color: { fg: string; bg: string } }) {
  return (
    <span
      className="mono"
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        color: color.fg,
        background: color.bg,
        borderRadius: 6,
        padding: '2px 7px',
        letterSpacing: 0.3,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  )
}

const inputStyle = {
  fontSize: 12.5,
  fontFamily: 'inherit',
  border: '1px solid var(--line)',
  borderRadius: 10,
  padding: '8px 11px',
  background: 'var(--surface-raised)',
  color: 'var(--ink)',
} as const

/**
 * Harness mode — spec authoring (with an opt-in write-time clarity check),
 * the UI-preview and test-command detect-then-confirm configs, a real
 * fresh-context reviewer run, and the "Jev menu" — four independently
 * opt-in TypeSafe/Jev layers (observability-trust-and-harness.md; the Jev
 * additions are a user-directed follow-up, 2026-10-07). `startRun` invokes
 * a real `claude -p` reviewer (`src/main/harness/reviewer.ts`) — never a
 * fabricated judgment.
 */
const JEV_FEATURE_ROWS: Array<{ key: keyof Project['jevFeatures']; label: string; description: string }> = [
  {
    key: 'criterionRouting',
    label: 'Criterion routing',
    description: 'Routes each criterion to a real test run, source-code review, or an honest "not checkable yet" before any reviewer call runs.',
  },
  {
    key: 'shortcutDetection',
    label: 'Rationale quality check',
    description: "Flags a reviewer rationale that doesn't cite concrete evidence — never silently changes the reviewer's own verdict.",
  },
  {
    key: 'criteriaPrefilter',
    label: 'Criteria pre-filter',
    description: 'Warns at write-time if new wording looks too vague to check — advisory only, never blocks adding it.',
  },
  {
    key: 'adaptiveMultiRun',
    label: 'Adaptive multi-run',
    description: 'Re-checks a low-confidence result with a second independent reviewer pass, surfacing any disagreement.',
  },
]

export function HarnessView({ project, onProjectUpdate }: { project: Project; onProjectUpdate: (updated: Project) => void }) {
  const [newCriterion, setNewCriterion] = useState('')
  const [previewDraft, setPreviewDraft] = useState<{ command: string; port: string }>({
    command: project.uiPreview?.command ?? '',
    port: project.uiPreview?.port != null ? String(project.uiPreview.port) : '',
  })
  const [detecting, setDetecting] = useState(false)
  const [testDraft, setTestDraft] = useState(project.testCommand?.command ?? '')
  const [detectingTest, setDetectingTest] = useState(false)
  const [costCeilingDraft, setCostCeilingDraft] = useState(project.harnessCostCeilingUsd != null ? String(project.harnessCostCeilingUsd) : '')
  const [prefilterWarning, setPrefilterWarning] = useState<{ text: string; confidence: number } | null>(null)
  const [checkingClarity, setCheckingClarity] = useState(false)
  const [runs, setRuns] = useState<HarnessRun[]>([])
  const [loadingRuns, setLoadingRuns] = useState(true)
  const [running, setRunning] = useState(false)
  const [typesafeStatus, setTypesafeStatus] = useState<{ configured: boolean; available: boolean } | null>(null)
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [apiKeyError, setApiKeyError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoadingRuns(true)
    window.laird.harness.listRuns({ projectId: project.id }).then((result) => {
      if (!cancelled) {
        setRuns(result)
        setLoadingRuns(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [project.id])

  useEffect(() => {
    let cancelled = false
    window.laird.settings.typesafeStatus().then((status) => {
      if (!cancelled) setTypesafeStatus(status)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setPreviewDraft({
      command: project.uiPreview?.command ?? '',
      port: project.uiPreview?.port != null ? String(project.uiPreview.port) : '',
    })
  }, [project.id, project.uiPreview])

  useEffect(() => {
    setTestDraft(project.testCommand?.command ?? '')
  }, [project.id, project.testCommand])

  useEffect(() => {
    setCostCeilingDraft(project.harnessCostCeilingUsd != null ? String(project.harnessCostCeilingUsd) : '')
  }, [project.id, project.harnessCostCeilingUsd])

  async function commitAddCriterion(text: string) {
    const updated = await window.laird.harness.setCriteria({ projectId: project.id, criteria: [...project.harnessCriteria, text] })
    if (updated) onProjectUpdate(updated)
    setNewCriterion('')
    setPrefilterWarning(null)
  }

  async function handleAddCriterion() {
    const text = newCriterion.trim()
    if (!text) return
    if (project.jevFeatures.criteriaPrefilter) {
      setCheckingClarity(true)
      try {
        const result = await window.laird.harness.criterionPrefilter({ projectId: project.id, criterion: text })
        if (!result.clear) {
          setPrefilterWarning({ text, confidence: result.confidence })
          return
        }
      } finally {
        setCheckingClarity(false)
      }
    }
    await commitAddCriterion(text)
  }

  async function handleAddAnyway() {
    if (prefilterWarning) await commitAddCriterion(prefilterWarning.text)
  }

  async function handleRemoveCriterion(index: number) {
    const next = project.harnessCriteria.filter((_, i) => i !== index)
    const updated = await window.laird.harness.setCriteria({ projectId: project.id, criteria: next })
    if (updated) onProjectUpdate(updated)
  }

  async function handleDetectPreview() {
    setDetecting(true)
    try {
      const proposal = await window.laird.harness.detectPreview({ projectId: project.id })
      if (proposal) {
        setPreviewDraft({ command: proposal.command, port: proposal.port != null ? String(proposal.port) : '' })
      }
    } finally {
      setDetecting(false)
    }
  }

  async function handleSavePreview() {
    const command = previewDraft.command.trim()
    if (!command) return
    const port = previewDraft.port.trim() ? Number(previewDraft.port.trim()) : null
    const updated = await window.laird.harness.setPreview({
      projectId: project.id,
      uiPreview: { command, port: Number.isFinite(port) ? port : null },
    })
    if (updated) onProjectUpdate(updated)
  }

  async function handleDetectTest() {
    setDetectingTest(true)
    try {
      const proposal = await window.laird.harness.detectTest({ projectId: project.id })
      if (proposal) setTestDraft(proposal.command)
    } finally {
      setDetectingTest(false)
    }
  }

  async function handleSaveTest() {
    const command = testDraft.trim()
    if (!command) return
    const updated = await window.laird.harness.setTest({ projectId: project.id, testCommand: { command } })
    if (updated) onProjectUpdate(updated)
  }

  async function handleSaveCostCeiling() {
    const trimmed = costCeilingDraft.trim()
    const costCeilingUsd = trimmed ? Number(trimmed) : undefined
    if (trimmed && (!Number.isFinite(costCeilingUsd) || costCeilingUsd! < 0)) return
    const updated = await window.laird.harness.setCostCeiling({ projectId: project.id, costCeilingUsd })
    if (updated) onProjectUpdate(updated)
  }

  async function handleRun() {
    setRunning(true)
    try {
      const run = await window.laird.harness.startRun({ projectId: project.id })
      setRuns((prev) => [run, ...prev])
    } finally {
      setRunning(false)
    }
  }

  async function handleCancelRun() {
    await window.laird.harness.cancelRun({ projectId: project.id })
  }

  async function handleSaveApiKey() {
    const apiKey = apiKeyDraft.trim()
    if (!apiKey) return
    setApiKeyError(null)
    setSavingKey(true)
    try {
      const status = await window.laird.settings.typesafeSetKey({ apiKey })
      setTypesafeStatus(status)
      setApiKeyDraft('')
    } catch (err) {
      setApiKeyError(err instanceof Error ? err.message : 'Could not save that key.')
    } finally {
      setSavingKey(false)
    }
  }

  async function handleClearApiKey() {
    const status = await window.laird.settings.typesafeClearKey()
    setTypesafeStatus(status)
  }

  async function handleToggleJevFeature(key: keyof Project['jevFeatures'], enabled: boolean) {
    const updated = await window.laird.harness.setJevFeatures({ projectId: project.id, features: { [key]: enabled } })
    if (updated) onProjectUpdate(updated)
  }

  return (
    <div className="skills-view" data-testid="harness-view">
      <div className="skills-section">
        <div className="label">Acceptance criteria</div>
        {project.harnessCriteria.length === 0 ? (
          <div className="skills-section-empty">No criteria yet — write what "done" means for this project, in plain language.</div>
        ) : (
          project.harnessCriteria.map((criterion, index) => (
            <div className="row-card" key={index} data-testid="harness-criterion-row">
              <div style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>
                {index + 1}. {criterion}
              </div>
              <span
                className="mono"
                onClick={() => handleRemoveCriterion(index)}
                data-testid="harness-criterion-remove"
                style={{ fontSize: 11, color: 'var(--muted)', cursor: 'pointer' }}
              >
                remove
              </span>
            </div>
          ))
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <input
            value={newCriterion}
            onChange={(e) => setNewCriterion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddCriterion()}
            placeholder="e.g. the signup form should work on mobile"
            style={{ ...inputStyle, flex: 1 }}
            data-testid="harness-criterion-input"
          />
          <div
            className="btn"
            onClick={checkingClarity ? undefined : handleAddCriterion}
            data-testid="harness-criterion-add"
            style={{ cursor: checkingClarity ? 'default' : 'pointer', opacity: checkingClarity ? 0.6 : 1 }}
          >
            {checkingClarity ? 'Checking…' : 'Add'}
          </div>
        </div>
        {prefilterWarning && (
          <div
            className="row-card"
            data-testid="harness-prefilter-warning"
            style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, marginTop: 10, borderColor: 'var(--state-warning)' }}
          >
            <div style={{ fontSize: 11.5, color: 'var(--state-warning)' }}>
              ⚠ TypeSafe/Jev flagged this as too vague to check as written — add it anyway, or rewrite it to be more specific?
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div className="btn" onClick={handleAddAnyway} data-testid="harness-prefilter-add-anyway" style={{ cursor: 'pointer' }}>
                Add anyway
              </div>
              <div
                className="btn"
                onClick={() => setPrefilterWarning(null)}
                data-testid="harness-prefilter-rewrite"
                style={{ cursor: 'pointer', opacity: 0.7 }}
              >
                Let me rewrite it
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="skills-section">
        <div className="label">Test command (for criteria that reduce to "the tests should pass")</div>
        <div className="row-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          <input
            value={testDraft}
            onChange={(e) => setTestDraft(e.target.value)}
            placeholder="npm test"
            className="mono"
            style={inputStyle}
            data-testid="harness-test-command"
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <div
              className="btn"
              onClick={detectingTest ? undefined : handleDetectTest}
              data-testid="harness-test-detect"
              style={{ cursor: detectingTest ? 'default' : 'pointer', opacity: detectingTest ? 0.6 : 1 }}
            >
              {detectingTest ? 'Detecting…' : 'Detect from project'}
            </div>
            <div className="btn" onClick={handleSaveTest} data-testid="harness-test-save" style={{ cursor: 'pointer' }}>
              Save
            </div>
          </div>
          <div className="mono" data-testid="harness-test-status" style={{ fontSize: 10.5, color: 'var(--muted)' }}>
            {project.testCommand
              ? `Confirmed: ${project.testCommand.command}`
              : 'Not configured yet — a run never executes anything without this set explicitly.'}
          </div>
        </div>
      </div>

      <div className="skills-section">
        <div className="label">UI preview (for screenshot/click-through criteria)</div>
        <div className="row-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={previewDraft.command}
              onChange={(e) => setPreviewDraft((prev) => ({ ...prev, command: e.target.value }))}
              placeholder="npm run dev"
              className="mono"
              style={{ ...inputStyle, flex: 2 }}
              data-testid="harness-preview-command"
            />
            <input
              value={previewDraft.port}
              onChange={(e) => setPreviewDraft((prev) => ({ ...prev, port: e.target.value }))}
              placeholder="port (optional)"
              className="mono"
              style={{ ...inputStyle, flex: 1 }}
              data-testid="harness-preview-port"
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div
              className="btn"
              onClick={detecting ? undefined : handleDetectPreview}
              data-testid="harness-preview-detect"
              style={{ cursor: detecting ? 'default' : 'pointer', opacity: detecting ? 0.6 : 1 }}
            >
              {detecting ? 'Detecting…' : 'Detect from project'}
            </div>
            <div className="btn" onClick={handleSavePreview} data-testid="harness-preview-save" style={{ cursor: 'pointer' }}>
              Save
            </div>
          </div>
          <div className="mono" data-testid="harness-preview-status" style={{ fontSize: 10.5, color: 'var(--muted)' }}>
            {project.uiPreview
              ? `Confirmed: ${project.uiPreview.command}${project.uiPreview.port != null ? ` on port ${project.uiPreview.port}` : ''}`
              : 'Not configured yet — a run never starts anything without this set explicitly.'}
          </div>
        </div>
      </div>

      <div className="skills-section">
        <div className="label">Cost ceiling (real reviewer spend per run)</div>
        <div className="row-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="mono" style={{ fontSize: 12.5 }}>¤</span>
            <input
              value={costCeilingDraft}
              onChange={(e) => setCostCeilingDraft(e.target.value)}
              placeholder="no ceiling"
              inputMode="decimal"
              className="mono"
              style={{ ...inputStyle, flex: 1 }}
              data-testid="harness-cost-ceiling-input"
            />
            <div className="btn" onClick={handleSaveCostCeiling} data-testid="harness-cost-ceiling-save" style={{ cursor: 'pointer' }}>
              Save
            </div>
          </div>
          <div className="mono" data-testid="harness-cost-ceiling-status" style={{ fontSize: 10.5, color: 'var(--muted)' }}>
            {project.harnessCostCeilingUsd != null
              ? `A run stops starting new reviewer passes once it's spent ¤${project.harnessCostCeilingUsd.toFixed(2)} — any criterion left unchecked reports why, honestly.`
              : 'No ceiling set — a run can spend as much as checking every criterion genuinely takes.'}
          </div>
        </div>
      </div>

      <div className="skills-section">
        <div className="label">Live preview</div>
        <LivePreviewPanel project={project} />
      </div>

      <div className="skills-section">
        <div className="label">TypeSafe (Jev) assist — optional, machine-wide</div>
        <div className="row-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            Sends your harness criteria and reviewer rationales to a third-party API (typesafe.ai) when enabled. The key below
            applies to every project on this machine, not just this one.
          </div>
          <div className="mono" data-testid="telemetry-disclosure" style={{ fontSize: 10.5, color: 'var(--muted)' }}>
            Laird itself collects no usage telemetry, analytics, or crash reports, opt-in or otherwise. This is the only
            network request Laird's own code ever makes on its own — everything else that touches the network (a Claude Code
            session, a plugin install) is something you directly asked it to do, not telemetry.
          </div>
          {typesafeStatus?.configured ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="mono" style={{ fontSize: 11, color: 'var(--state-success)' }} data-testid="typesafe-key-status">
                API key configured
              </span>
              <span
                className="mono"
                onClick={handleClearApiKey}
                data-testid="typesafe-key-clear"
                style={{ fontSize: 11, color: 'var(--muted)', cursor: 'pointer' }}
              >
                remove
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="password"
                value={apiKeyDraft}
                onChange={(e) => setApiKeyDraft(e.target.value)}
                placeholder="TypeSafe API key"
                className="mono"
                style={{ ...inputStyle, flex: 1 }}
                data-testid="typesafe-key-input"
              />
              <div
                className="btn"
                onClick={savingKey ? undefined : handleSaveApiKey}
                data-testid="typesafe-key-save"
                style={{ cursor: savingKey ? 'default' : 'pointer', opacity: savingKey ? 0.6 : 1 }}
              >
                {savingKey ? 'Saving…' : 'Save key'}
              </div>
            </div>
          )}
          {apiKeyError && (
            <div data-testid="typesafe-key-error" style={{ fontSize: 11.5, color: 'var(--state-danger)' }}>
              {apiKeyError}
            </div>
          )}
          {typesafeStatus && !typesafeStatus.available && (
            <div style={{ fontSize: 11, color: 'var(--state-warning)' }}>
              Secure storage isn't available on this machine, so a key can't be saved safely here.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="jev-feature-menu">
            {JEV_FEATURE_ROWS.map((row) => (
              <label
                key={row.key}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  cursor: typesafeStatus?.configured ? 'pointer' : 'default',
                  opacity: typesafeStatus?.configured ? 1 : 0.5,
                }}
              >
                <input
                  type="checkbox"
                  checked={project.jevFeatures[row.key]}
                  disabled={!typesafeStatus?.configured}
                  onChange={(e) => handleToggleJevFeature(row.key, e.target.checked)}
                  data-testid={`jev-feature-toggle-${row.key}`}
                  style={{ marginTop: 2 }}
                />
                <span>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{row.label}</span>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{row.description}</div>
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="skills-section">
        <div className="label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Run harness
          <div style={{ display: 'flex', gap: 8 }}>
            {running && (
              <div
                className="btn"
                onClick={handleCancelRun}
                data-testid="harness-run-cancel"
                style={{ cursor: 'pointer', color: 'var(--state-danger)' }}
              >
                Take back control
              </div>
            )}
            <div
              className="btn"
              onClick={running || project.harnessCriteria.length === 0 ? undefined : handleRun}
              data-testid="harness-run-button"
              style={{
                cursor: running || project.harnessCriteria.length === 0 ? 'default' : 'pointer',
                opacity: running || project.harnessCriteria.length === 0 ? 0.5 : 1,
                fontWeight: 600,
              }}
            >
              {running ? 'Running…' : 'Run harness'}
            </div>
          </div>
        </div>
        {project.harnessCriteria.length === 0 && (
          <div className="skills-section-empty">Add at least one criterion above before running.</div>
        )}

        {loadingRuns ? (
          <span className="mono" style={{ color: 'var(--muted)', fontSize: 12 }}>
            Loading…
          </span>
        ) : runs.length === 0 ? (
          <div className="skills-section-empty">No runs yet.</div>
        ) : (
          runs.map((run) => (
            <div key={run.id} className="row-card" data-testid="harness-run-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {new Date(run.createdAt).toLocaleString()} · ¤{run.totalCostUsd.toFixed(2)}
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {run.costCeilingHit && (
                    <span data-testid="harness-run-cost-ceiling-hit" title="Stopped early — the cost ceiling was reached before every criterion could be checked.">
                      <Badge label="⚠ cost ceiling hit" color={{ fg: 'var(--state-warning)', bg: 'var(--state-warning-soft)' }} />
                    </span>
                  )}
                  <Badge label={DISPOSITION_LABEL[run.disposition]} color={DISPOSITION_COLOR[run.disposition]} />
                </div>
              </div>
              {run.perCriterionResult.map((result, i) => (
                <div
                  key={i}
                  data-testid="harness-criterion-result"
                  style={{ borderTop: '1px solid var(--line)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 12, flex: 1 }}>{result.criterion}</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Badge label={DISPOSITION_LABEL[result.disposition]} color={DISPOSITION_COLOR[result.disposition]} />
                      <Badge label={result.evidenceTier} color={EVIDENCE_COLOR[result.evidenceTier]} />
                      {result.evidenceQualityFlag && (
                        <span data-testid="harness-evidence-quality-flag" title={result.evidenceQualityFlag.note}>
                          <Badge label="⚠ low-confidence rationale" color={{ fg: 'var(--state-warning)', bg: 'var(--state-warning-soft)' }} />
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{result.rationale}</div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
