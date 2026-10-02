import { notFound } from 'next/navigation'

// [support-surfaces-off] 2026-10-02: this route is disabled and answers 404.
// Its page, BFF routes, API and jobs still exist and are tested.
// To re-enable: comment out the notFound() line below.
// Repo checklist: grep -rn "support-surfaces-off" apps/web apps/e2e

export default function KnowledgeBasesLayout({ children }: { children: React.ReactNode }) {
  notFound() // [support-surfaces-off]
  return children
}
