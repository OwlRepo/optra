import { readFile, stat } from 'fs/promises'
import { basename } from 'path'
import MsgReader from '@kenjiuno/msgreader'
import type { LoadedDocument } from './types'

export async function loadMSG(filePath: string): Promise<LoadedDocument> {
  const [buffer, stats] = await Promise.all([
    readFile(filePath),
    stat(filePath),
  ])

  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  const reader = new MsgReader(arrayBuffer)
  const msg = reader.getFileData()

  const content = msg.body ?? ''

  return {
    content,
    metadata: {
      source: filePath,
      fileType: 'msg',
      fileName: basename(filePath),
      fileSize: stats.size,
      subject: msg.subject ?? undefined,
      from: msg.senderEmail ?? undefined,
      date: msg.creationTime ?? undefined,
    },
  }
}
