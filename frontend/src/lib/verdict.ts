// The one map from a backend decision to what the interface shows. Every page,
// both graph renderers and every chart use it, so the same outcome always looks
// and reads the same. It follows the backend's real verdicts: ALLOW, BLOCK and
// PAUSE, with an ALLOW whose stage is "redact" being a rewritten call (the min
// cut removed one argument and the rest ran). "Critical" is not a backend
// verdict: it marks events the interface itself must escalate (an attack that
// reached an unsafe effect, a broken decision chain).

export type Verdict = 'allowed' | 'rewritten' | 'paused' | 'blocked' | 'critical'

export function verdictOf(decision?: string | null, stage?: string | null): Verdict {
  const d = (decision || '').toUpperCase()
  if (d === 'BLOCK' || d === 'DENY') return 'blocked'
  if (d === 'PAUSE' || d === 'ASK') return 'paused'
  if (stage === 'redact' || d === 'REWRITE' || d === 'REDACT') return 'rewritten'
  return 'allowed'
}

export const VERDICT: Record<Verdict, { label: string; ink: string; mark: string; meaning: string }> = {
  // ink: text/badge fill, >= 4.5:1. mark: chart dots and bars, validated as a
  // colour-vision-safe set (dataviz validator, all pairs) on white.
  allowed:   { label: 'Allowed',   ink: '#6b6158', mark: '#8f8478', meaning: 'Nothing in the graph linked this call to a risk, so it ran.' },
  rewritten: { label: 'Rewritten', ink: '#2c76b0', mark: '#2c76b0', meaning: 'The min cut removed a secret from one argument; the rest of the call ran.' },
  paused:    { label: 'Paused',    ink: '#8a5a12', mark: '#8a5a12', meaning: 'The call waits for a person to approve it.' },
  blocked:   { label: 'Blocked',   ink: '#a8380a', mark: '#ff6b00', meaning: 'The call did not run.' },
  critical:  { label: 'Critical',  ink: '#b42318', mark: '#b42318', meaning: 'Something unsafe happened or evidence was tampered with.' },
}

export const isStopped = (v: Verdict) => v !== 'allowed'

// What each graph signal means, in plain words. Keys are the backend's stages.
export const STAGE_LABEL: Record<string, string> = {
  exfiltration: 'A secret was on its way out',
  provenance: 'Outside content tried to give an order',
  tool_drift: 'The tool changed after it was trusted',
  code_graph: 'A look-alike package',
  entity_policy: 'Shared with a protected person',
  redact: 'A secret was cut out of one argument',
  intent: 'Outside the declared intent',
  forecast: 'The budget would be exceeded',
  budget: 'The budget would be exceeded',
  behavior: 'Unusual behaviour for this agent',
  default: 'No path to a risk',
}
export const stageLabel = (s?: string | null) => (s && STAGE_LABEL[s]) || s || '—'
