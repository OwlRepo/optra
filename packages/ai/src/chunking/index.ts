import {
  RecursiveCharacterTextSplitter,
  MarkdownTextSplitter,
} from "langchain/text_splitter";
import { get_encoding } from "tiktoken";
import type { LoadedDocument } from "../loaders/types";
import type { Chunk, ChunkOptions } from "./types";

export type { Chunk, ChunkOptions };

const MARKDOWN_FILE_TYPES = new Set([
  "md",
  "mdx",
  "mdc",
  "markdown",
  "mkd",
  "mkdn",
  "mkdown",
  "ron",
]);

const encoder = get_encoding("cl100k_base");

function countTokens(text: string): number {
  return encoder.encode(text).length;
}

function buildSplitter(
  fileType: string,
  chunkSize: number,
  chunkOverlap: number,
) {
  const options = {
    chunkSize,
    chunkOverlap,
    lengthFunction: countTokens,
  };

  return MARKDOWN_FILE_TYPES.has(fileType)
    ? new MarkdownTextSplitter(options)
    : new RecursiveCharacterTextSplitter(options);
}

export async function chunkDocument(
  doc: LoadedDocument,
  options: ChunkOptions = {},
): Promise<Chunk[]> {
  const { chunkSize = 512, chunkOverlap = 50 } = options;

  const splitter = buildSplitter(
    doc.metadata.fileType,
    chunkSize,
    chunkOverlap,
  );
  const splits = await splitter.splitText(doc.content);

  const totalChunks = splits.length;

  return splits.map((content, index) => ({
    content,
    metadata: {
      ...doc.metadata,
      chunkIndex: index,
      totalChunks,
    },
  }));
}
