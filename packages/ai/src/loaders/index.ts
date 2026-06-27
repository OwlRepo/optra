import { Document } from 'langchain/document'

export async function loadFromPDF(path: string): Promise<Document[]> {
  // TODO: Implement PDF loading using LangChain PDF loader
  // Use PDFLoader from @langchain/community
  throw new Error('Not implemented')
}

export async function loadFromURL(url: string): Promise<Document[]> {
  // TODO: Implement URL loading using LangChain web loaders
  // Use CheerioWebBaseLoader or similar
  throw new Error('Not implemented')
}
