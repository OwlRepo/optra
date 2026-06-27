export function withLangSmith<T extends (...args: any[]) => any>(
  fn: T,
  metadata?: Record<string, any>
): T {
  // TODO: Implement LangSmith tracing wrapper
  // Use LANGSMITH_API_KEY and LANGSMITH_PROJECT from env
  // Wrap function calls with LangSmith tracing
  
  return fn
}
