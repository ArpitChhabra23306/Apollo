import openai from '../config/ai.js';
import { DocumentChunk } from '../models/Document.js';

const EMBEDDING_MODEL = 'text-embedding-3-small';

/**
 * Splits text into overlapping chunks of approx targetSize characters.
 */
export function chunkText(text, targetSize = 700, overlap = 100) {
  if (!text || typeof text !== 'string') return [];
  
  const clean = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (clean.length <= targetSize) return [clean];

  const chunks = [];
  let startIndex = 0;

  while (startIndex < clean.length) {
    let endIndex = startIndex + targetSize;

    if (endIndex < clean.length) {
      // Try to find a sentence or newline boundary near endIndex
      const slice = clean.slice(startIndex, endIndex + 50);
      const boundaryMatch = slice.search(/(\.\s|\n\n|\n)/);
      
      if (boundaryMatch !== -1 && boundaryMatch >= targetSize - 150) {
        endIndex = startIndex + boundaryMatch + 1;
      }
    } else {
      endIndex = clean.length;
    }

    const chunk = clean.slice(startIndex, endIndex).trim();
    if (chunk.length > 20) {
      chunks.push(chunk);
    }

    startIndex = endIndex - overlap;
    if (startIndex >= clean.length - overlap) break;
  }

  return chunks;
}

/**
 * Generates vector embeddings for an array of text chunks using OpenAI text-embedding-3-small.
 */
export async function generateEmbeddings(texts) {
  if (!Array.isArray(texts) || texts.length === 0) return [];

  // Batch process if > 50 chunks
  const batchSize = 50;
  const allEmbeddings = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
    });

    for (const item of response.data) {
      allEmbeddings.push(item.embedding);
    }
  }

  return allEmbeddings;
}

/**
 * Computes cosine similarity between two vectors.
 */
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Retrieves the topK most relevant document chunks for a query using vector similarity.
 */
export async function findRelevantChunks(queryText, docId = null, topK = 4) {
  if (!queryText || typeof queryText !== 'string') return [];

  try {
    // 1. Generate embedding for query
    const queryRes = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: queryText.slice(0, 1000),
    });
    const queryVector = queryRes.data[0]?.embedding;
    if (!queryVector) return [];

    // 2. Fetch candidate chunks from MongoDB
    const filter = docId ? { docId } : {};
    const chunks = await DocumentChunk.find(filter).lean();
    if (!chunks || chunks.length === 0) return [];

    // 3. Score chunks by cosine similarity
    const scoredChunks = chunks.map(chunk => ({
      chunkIndex: chunk.chunkIndex,
      text: chunk.text,
      similarity: cosineSimilarity(queryVector, chunk.embedding),
    }));

    // 4. Sort descending and take topK
    scoredChunks.sort((a, b) => b.similarity - a.similarity);
    return scoredChunks.slice(0, topK);
  } catch (error) {
    console.error('Error finding relevant chunks in RAG service:', error.message);
    return [];
  }
}
