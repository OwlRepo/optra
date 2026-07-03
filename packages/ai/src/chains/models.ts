// Per-task model selection. Answering is the expensive, quality-critical call;
// rewrite/grade are cheap classification-style calls that can run on a faster,
// cheaper model. Each role resolves to its own env var, then falls back to the
// shared OPENAI_CHAT_MODEL, then to a safe default — so existing configs keep working.
export type ModelRole = 'answer' | 'rewrite' | 'grade' | 'extraction'

const ROLE_ENV: Record<ModelRole, string> = {
  answer: 'OPENAI_ANSWER_MODEL',
  rewrite: 'OPENAI_REWRITE_MODEL',
  grade: 'OPENAI_GRADE_MODEL',
  extraction: 'OPENAI_EXTRACTION_MODEL',
}

const DEFAULT_MODEL = 'gpt-4-turbo'

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function resolveModel(role: ModelRole): string {
  return (
    nonEmpty(process.env[ROLE_ENV[role]]) ??
    nonEmpty(process.env.OPENAI_CHAT_MODEL) ??
    DEFAULT_MODEL
  )
}
