// [support-surfaces-off] Knowledge Bases, Datasets, Chat, Tickets and Insights
// are hidden in the web app since 2026-10-02. Their background work is off with
// them: the weekly freshness, FAQ-cluster and topic-gap jobs (the last two call
// OpenAI against the workspace's token budget) and the digest's lines about
// chat, tickets, documents and FAQ drafts. Off unless the env says exactly
// 'true'. Read at call time, like procurement-feature-flags.ts, so a tick and
// the jobs it queued each see the value current when they run.
export function supportSurfacesEnabled(): boolean {
  return process.env.SUPPORT_SURFACES_ENABLED === 'true'
}
