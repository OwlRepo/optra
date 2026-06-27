import type { Chunk } from '../chunking/types'

export interface EmbeddedChunk extends Chunk {
  embedding: number[]
}
