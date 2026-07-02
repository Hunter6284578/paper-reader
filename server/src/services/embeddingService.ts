/**
 * Embedding service using SiliconFlow API (BAAI/bge-m3)
 * 1024-dim, bilingual Chinese-English, free tier
 */
import { ENV } from '../config.js';

const SILICONFLOW_API_URL = 'https://api.siliconflow.cn/v1/embeddings';
const BATCH_SIZE = 25;

let overrideApiKey: string | null = null;

export function setEmbeddingApiKey(key: string): void {
  overrideApiKey = key;
}

export function getEmbeddingApiKey(): string | null {
  return overrideApiKey || ENV.SILICONFLOW_API_KEY || null;
}

export function isEmbeddingAvailable(): boolean {
  return Boolean(getEmbeddingApiKey());
}

/**
 * Generate embeddings for a batch of texts
 * Splits into chunks of BATCH_SIZE to respect API limits
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const apiKey = getEmbeddingApiKey();
  if (!apiKey) throw new Error('SiliconFlow API Key not configured');

  const results: number[][] = [];
  const model = ENV.EMBEDDING_MODEL;

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE).map((t) => t.slice(0, 8000)); // truncate long texts

    const response = await fetch(SILICONFLOW_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, input: batch }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`SiliconFlow embedding error (${response.status}): ${error}`);
    }

    const json = await response.json() as { data: Array<{ embedding: number[]; index: number }> };

    // Sort by index to maintain order
    const sorted = json.data.sort((a, b) => a.index - b.index);
    results.push(...sorted.map((d) => d.embedding));
  }

  return results;
}

/**
 * Generate embedding for a single query text
 */
export async function generateQueryEmbedding(text: string): Promise<number[]> {
  const results = await generateEmbeddings([text]);
  return results[0];
}

/**
 * Compute cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
