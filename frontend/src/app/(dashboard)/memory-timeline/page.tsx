'use client'

import { useState } from 'react'
import { Ban, GitBranch, Search } from 'lucide-react'
import { EntityGraph, type GraphContext } from '@/components/EntityGraph'
import { useResource } from '@/lib/useResource'
import { ResourceGate, StatePanel } from '@/components/app/ui'

interface Fact { id: string; subject: string; text: string; trust: string; authority?: string; valid_from: number; valid_to?: number }

interface TemporalFact {
  subject: string
  abstain: boolean
  answer: string
  facts?: Fact[]
  current_contexts: string[]
  history_contexts: string[]
  query_time_ms: number
}

interface MemoryResult {
  question: string
  graph_context: GraphContext
  facts?: Fact[]
  chunks: { source_title?: string; source_upload_time?: string; chunk_content?: string }[]
}

// The seeded example built to show temporal reasoning: an on-call fact
// recorded first, then superseded by a newer one.
const DEFAULT_SUBJECT = 'on-call engineer'
const DEFAULT_QUESTION = 'Has the on-call engineer changed across sessions? Which fact was superseded?'

// Validity windows are stored as whole days (UTC midnight), so show the date in UTC.
const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const words = (s?: string) => (s ? s.toLowerCase().replace(/_/g, ' ') : '—')

function Timeline({ facts }: { facts: Fact[] }) {
  const sorted = [...facts].sort((a, b) => a.valid_from - b.valid_from)
  return (
    <ol className="relative ml-2 border-l-2 border-[#e6ded2] space-y-4">
      {sorted.map(f => {
        const current = !f.valid_to
        return (
          <li key={f.id} className="relative pl-5">
            <span aria-hidden="true" className={`absolute -left-[7px] top-1.5 w-3 h-3 rounded-full border-2 ${current ? 'bg-[#ff6b00] border-[#ff6b00]' : 'bg-white border-[#8f8478]'}`} />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-md ${current ? 'bg-[#fdeee4] text-[#a8380a]' : 'bg-[#f1ede7] text-[#5e544b]'}`}>{current ? 'Current' : 'Superseded'}</span>
              <span className="app-meta">{day(f.valid_from)} → {f.valid_to ? day(f.valid_to) : 'now'}</span>
            </div>
            <p className={`mt-1 text-[15px] leading-[22px] ${current ? 'text-[#14100d] font-medium' : 'text-[#5e544b]'}`}>{f.text}</p>
            <p className="app-meta">Source trust: {words(f.trust)}{f.authority ? ` · authority: ${words(f.authority)}` : ''}</p>
          </li>
        )
      })}
    </ol>
  )
}

export default function MemoryTimelinePage() {
  const [subjectInput, setSubjectInput] = useState('')
  const [subject, setSubject] = useState(DEFAULT_SUBJECT)
  const [questionInput, setQuestionInput] = useState('')
  const [question, setQuestion] = useState(DEFAULT_QUESTION)
  const trace = (s: string) => { setSubjectInput(s); setSubject(s.trim() || DEFAULT_SUBJECT) }

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto animate-fadeIn">
      <h1>Memory Timeline</h1>
      <p>What VIGIL remembers across sessions: each fact with the window it was true in, what replaced it, and how far its source can be trusted. Ask about something never recorded and it answers NOT_IN_HISTORY instead of guessing.</p>

      <section aria-labelledby="mt-trace" className="mt-6 mb-8">
        <h2 id="mt-trace" className="app-h2">Trace a fact</h2>
        <p className="app-sub mb-3">The current value of a fact and every value it replaced.</p>
        <form onSubmit={e => { e.preventDefault(); trace(subjectInput) }} className="app-card p-4 sm:p-5 mb-4">
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="app-field flex-1">
              <label htmlFor="mt-subject">Fact subject</label>
              <div className="relative">
                <GitBranch className="w-4 h-4 text-[#6b6158] absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
                <input id="mt-subject" value={subjectInput} onChange={e => setSubjectInput(e.target.value)} className="app-input" style={{ paddingLeft: 36 }} placeholder={`e.g. ${DEFAULT_SUBJECT}`} />
              </div>
            </div>
            <button type="submit" className="app-btn app-btn-primary">Trace fact</button>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <span className="app-meta">Try:</span>
            <button type="button" className="app-btn app-btn-secondary app-btn-sm" aria-pressed={subject === DEFAULT_SUBJECT} onClick={() => trace(DEFAULT_SUBJECT)}>{DEFAULT_SUBJECT}</button>
            <button type="button" className="app-btn app-btn-secondary app-btn-sm" aria-pressed={subject === 'gym time'} onClick={() => trace('gym time')}>gym time <span className="app-meta">(never recorded)</span></button>
          </div>
        </form>
        <FactTrace key={subject} subject={subject} />
      </section>

      <section aria-labelledby="mt-ask">
        <h2 id="mt-ask" className="app-h2">Ask the memory</h2>
        <p className="app-sub mb-3">Matches the words of a question against recorded facts and the SUPERSEDES edges between them.</p>
        <form onSubmit={e => { e.preventDefault(); setQuestion(questionInput.trim() || DEFAULT_QUESTION) }} className="app-card p-4 sm:p-5 mb-4 flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="app-field flex-1">
            <label htmlFor="mt-question">Question</label>
            <div className="relative">
              <Search className="w-4 h-4 text-[#6b6158] absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input id="mt-question" value={questionInput} onChange={e => setQuestionInput(e.target.value)} className="app-input" style={{ paddingLeft: 36 }} placeholder={DEFAULT_QUESTION} />
            </div>
          </div>
          <button type="submit" className="app-btn app-btn-primary">Ask memory</button>
        </form>
        <MemoryAnswer key={question} question={question} />
      </section>
    </div>
  )
}

function FactTrace({ subject }: { subject: string }) {
  const r = useResource<TemporalFact>(`/api/v1/memory/fact?subject=${encodeURIComponent(subject)}`)
  return (
    <ResourceGate r={r} loading={`Tracing “${subject}”…`}>
      {f => f.abstain ? (
        <div className="app-panel p-4 sm:p-5 flex items-start gap-3" role="status">
          <Ban className="w-5 h-5 text-[#5e544b] shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="font-semibold">No fact recorded about “{f.subject}”</p>
            <p className="app-sub mt-1">The graph answered <code className="app-mono px-1.5 py-0.5 rounded bg-[#f1ede7] text-[#14100d]">NOT_IN_HISTORY</code>, so VIGIL abstains rather than make an answer up.</p>
          </div>
        </div>
      ) : (
        <div className="app-panel p-4 sm:p-5">
          <span className="app-label">Current value of “{f.subject}”</span>
          <p className="text-[19px] leading-[26px] font-semibold mt-1 mb-4">{f.answer}</p>
          {f.facts?.length ? <Timeline facts={f.facts} /> : (
            // Older servers return sentences only.
            <ul className="space-y-1.5 text-[14px]">
              {f.current_contexts.map((c, i) => <li key={`c${i}`}><strong>Current:</strong> {c}</li>)}
              {f.history_contexts.map((c, i) => <li key={`h${i}`} className="text-[#5e544b]">Earlier: {c}</li>)}
            </ul>
          )}
          <p className="app-meta mt-4">Answered by the graph in {f.query_time_ms < 1 ? '<1' : f.query_time_ms.toFixed(1)} ms.</p>
        </div>
      )}
    </ResourceGate>
  )
}

function chunkText(c: MemoryResult['chunks'][number]) {
  const raw = c.chunk_content || ''
  try { return (JSON.parse(raw) as { content?: { text?: string } }).content?.text || raw } catch { return raw || c.source_title || '' }
}

function MemoryAnswer({ question }: { question: string }) {
  const r = useResource<MemoryResult>(`/api/v1/memory?question=${encodeURIComponent(question)}`)
  return (
    <ResourceGate r={r} loading="Searching the memory graph…"
      isEmpty={d => !(d.facts?.length) && !d.chunks?.length}
      empty={<StatePanel kind="empty" title="No recorded fact matches this question">Nothing in the memory graph shares its key words. VIGIL does not guess an answer.</StatePanel>}>
      {d => (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-4">
          <div className="app-panel p-4 sm:p-5 min-w-0">
            <h3 className="app-h3" style={{ marginBottom: 12 }}>How the facts connect</h3>
            <EntityGraph graphContext={d.graph_context} label="Fact graph" height={300}
              emptyTitle="No edges between these facts" emptyText="The matching facts are not linked by a SUPERSEDES or DERIVED_FROM edge." />
          </div>
          <div className="app-panel p-4 sm:p-5 min-w-0">
            <h3 className="app-h3" style={{ marginBottom: 12 }}>Matching facts, oldest first</h3>
            {d.facts?.length ? <Timeline facts={d.facts} /> : (
              <ol className="space-y-2">
                {[...d.chunks].sort((a, b) => (a.source_upload_time || '').localeCompare(b.source_upload_time || '')).map((c, i) => (
                  <li key={i} className="text-[14px]"><span className="app-meta block">{c.source_upload_time ? day(Date.parse(c.source_upload_time)) : '—'}</span>{chunkText(c)}</li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </ResourceGate>
  )
}
