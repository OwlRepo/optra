// Lightweight, LLM-free query router. Simple lookups ("what is X?") don't need
// the full retrieve -> rewrite -> grade machinery, so they take a lighter path
// (fewer chunks, no rewrite/grade). Heuristic-first keeps routing free and fast;
// a cheap-model fallback for ambiguous cases can be layered on later.
export type QueryClass = 'simple' | 'complex'

const TROUBLESHOOTING_SIGNALS = [
  'error',
  'fail',
  'not working',
  'broken',
  "can't",
  'cannot',
  'how do i',
  'how to',
  'why is',
  'why does',
  'steps',
  'fix',
  'issue',
  'crash',
  'debug',
  'troubleshoot',
  'configure',
  'set up',
  'setup',
]

const SIMPLE_STARTS = [
  'what is',
  'what are',
  "what's",
  'who is',
  'who are',
  'when is',
  'when did',
  'where is',
  'define',
  'definition of',
]

const SIMPLE_MAX_WORDS = 12
const VERY_SHORT_WORDS = 6

// Separate from classifyQuery/QueryClass on purpose: this is a candidate
// gate for routing into the structured (DuckDB/text-to-SQL) pipeline, not a
// change to the existing simple/complex RAG routing contract. Cheap
// keyword heuristic first; the caller layers a workspace-has-datasets check
// and only then an LLM classifier for genuinely ambiguous questions.
const STRUCTURED_SIGNALS = [
  'how many',
  'how much',
  'total',
  'average',
  'avg',
  'sum of',
  'count of',
  'top ',
  'highest',
  'lowest',
  'most',
  'least',
  'trend',
  'compare',
  'per quarter',
  'per month',
  'per week',
  'last quarter',
  'last month',
  'which product',
  'which category',
]

export function classifyStructuredIntent(question: string): boolean {
  const q = question.trim().toLowerCase()
  if (q.length === 0) return false
  return STRUCTURED_SIGNALS.some((signal) => q.includes(signal))
}

// V2 slice F2: distinguishes "trend question about our own tickets" from
// "trend question about an uploaded dataset" — both pass
// classifyStructuredIntent, but only one should route to the fixed tickets
// pseudo-source instead of the pgvector dataset selector.
const TICKET_SIGNALS = ['ticket', 'tickets', 'severity', 'agent', 'reviewer', 'resolution time', 'resolved']

export function classifyTicketIntent(question: string): boolean {
  const q = question.trim().toLowerCase()
  if (q.length === 0) return false
  return TICKET_SIGNALS.some((signal) => q.includes(signal))
}

export function classifyQuery(question: string): QueryClass {
  const q = question.trim().toLowerCase()
  if (q.length === 0) return 'complex'

  const wordCount = q.split(/\s+/).length

  // Any troubleshooting/procedural signal -> keep the full flow.
  if (TROUBLESHOOTING_SIGNALS.some((signal) => q.includes(signal))) {
    return 'complex'
  }

  if (SIMPLE_STARTS.some((start) => q.startsWith(start)) && wordCount <= SIMPLE_MAX_WORDS) {
    return 'simple'
  }

  if (wordCount <= VERY_SHORT_WORDS) {
    return 'simple'
  }

  return 'complex'
}
