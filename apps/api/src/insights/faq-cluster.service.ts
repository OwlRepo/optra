import { Injectable } from '@nestjs/common'
import type { UncoveredTicket } from './ticket-doc-coverage.service'

// Resolves this batch's F4 open point: cluster threshold + minimum cluster
// size. 0.75 is deliberately tighter than F3's 0.5 "any decent match"
// threshold — clustering needs WITHIN-cluster similarity tight enough that
// the tickets are plausibly the same underlying question, not just loosely
// related. MIN_CLUSTER_SIZE=3: a pair could be coincidental phrasing overlap;
// three independent tickets asking the same thing is a real repeated pattern
// worth drafting an FAQ for.
export const CLUSTER_SIMILARITY_THRESHOLD = Number.parseFloat(
  process.env.FAQ_CLUSTER_SIMILARITY_THRESHOLD ?? '0.75',
)
export const MIN_CLUSTER_SIZE = Number.parseInt(process.env.FAQ_MIN_CLUSTER_SIZE ?? '3', 10)

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

@Injectable()
export class FaqClusterService {
  // Greedy single-pass clustering: each new cluster is seeded by the first
  // unclustered ticket, then every remaining unclustered ticket within
  // CLUSTER_SIMILARITY_THRESHOLD of that SEED (not a recomputed centroid) is
  // added. Simple and deterministic; a smarter (e.g. centroid-updating)
  // clustering is a documented future improvement if this proves too coarse.
  cluster(tickets: UncoveredTicket[]): string[][] {
    const remaining = [...tickets]
    const clusters: string[][] = []

    while (remaining.length > 0) {
      const seed = remaining.shift()!
      const clusterTicketIds = [seed.ticketId]

      for (let i = remaining.length - 1; i >= 0; i -= 1) {
        if (cosineSimilarity(seed.embedding, remaining[i].embedding) >= CLUSTER_SIMILARITY_THRESHOLD) {
          clusterTicketIds.push(remaining[i].ticketId)
          remaining.splice(i, 1)
        }
      }

      if (clusterTicketIds.length >= MIN_CLUSTER_SIZE) {
        clusters.push(clusterTicketIds)
      }
    }

    return clusters
  }
}
