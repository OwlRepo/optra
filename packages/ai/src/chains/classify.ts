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
