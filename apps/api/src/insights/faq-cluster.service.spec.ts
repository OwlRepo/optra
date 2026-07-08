import { FaqClusterService, CLUSTER_SIMILARITY_THRESHOLD, MIN_CLUSTER_SIZE } from './faq-cluster.service'
import type { UncoveredTicket } from './ticket-doc-coverage.service'

function ticket(id: string, embedding: number[]): UncoveredTicket {
  return { ticketId: id, embedding, score: 0.1 }
}

describe('FaqClusterService', () => {
  const service = new FaqClusterService()

  it('groups tickets with near-identical embeddings into one cluster', () => {
    const tickets = [ticket('a', [1, 0, 0]), ticket('b', [1, 0, 0]), ticket('c', [1, 0, 0])]

    const clusters = service.cluster(tickets)

    expect(clusters).toHaveLength(1)
    expect(clusters[0].sort()).toEqual(['a', 'b', 'c'])
  })

  it('drops clusters smaller than MIN_CLUSTER_SIZE', () => {
    expect(MIN_CLUSTER_SIZE).toBeGreaterThanOrEqual(2)
    const tickets = [ticket('a', [1, 0, 0]), ticket('b', [0, 1, 0])]

    const clusters = service.cluster(tickets)

    expect(clusters).toHaveLength(0)
  })

  it('keeps dissimilar tickets in separate clusters', () => {
    expect(CLUSTER_SIMILARITY_THRESHOLD).toBeGreaterThan(0)
    const tickets = [
      ticket('a1', [1, 0, 0]),
      ticket('a2', [1, 0, 0]),
      ticket('a3', [1, 0, 0]),
      ticket('b1', [0, 1, 0]),
      ticket('b2', [0, 1, 0]),
      ticket('b3', [0, 1, 0]),
    ]

    const clusters = service.cluster(tickets)

    expect(clusters).toHaveLength(2)
    expect(clusters.map((cluster) => cluster.length).sort()).toEqual([3, 3])
  })

  it('returns no clusters for an empty input', () => {
    expect(service.cluster([])).toEqual([])
  })
})
