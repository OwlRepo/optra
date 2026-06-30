import { get_encoding } from 'tiktoken'

export function countTokens(text: string): number {
  const encoder = get_encoding('cl100k_base')

  try {
    return encoder.encode(text).length
  } finally {
    encoder.free()
  }
}
