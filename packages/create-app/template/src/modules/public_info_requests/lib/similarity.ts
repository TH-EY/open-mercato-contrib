import { stemPolish, tokenizePolish } from './text'

export type SimilarityDocument = { id: string; text: string }
export type SimilarityHit = { id: string; score: number; sharedTerms: string[] }

type Vector = Map<string, number>

function termFrequencies(text: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const token of tokenizePolish(text)) {
    const stem = stemPolish(token)
    counts.set(stem, (counts.get(stem) ?? 0) + 1)
  }
  return counts
}

function norm(vector: Vector): number {
  let sum = 0
  for (const value of vector.values()) sum += value * value
  return Math.sqrt(sum)
}

export type SimilarityIndex = {
  query: (text: string, limit?: number) => SimilarityHit[]
  size: number
}

export function buildSimilarityIndex(documents: SimilarityDocument[]): SimilarityIndex {
  const frequencies = documents.map((document) => ({ id: document.id, terms: termFrequencies(document.text) }))
  const documentFrequency = new Map<string, number>()
  for (const entry of frequencies) {
    for (const term of entry.terms.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
  }
  const total = Math.max(frequencies.length, 1)
  const idf = (term: string) => Math.log(1 + total / (1 + (documentFrequency.get(term) ?? 0)))
  const weigh = (terms: Map<string, number>): Vector => {
    const vector: Vector = new Map()
    for (const [term, count] of terms) vector.set(term, (1 + Math.log(count)) * idf(term))
    return vector
  }
  const vectors = frequencies.map((entry) => {
    const vector = weigh(entry.terms)
    return { id: entry.id, vector, norm: norm(vector) }
  })
  return {
    size: vectors.length,
    query(text: string, limit = 10): SimilarityHit[] {
      const queryVector = weigh(termFrequencies(text))
      const queryNorm = norm(queryVector)
      if (queryNorm === 0) return []
      const hits: SimilarityHit[] = []
      for (const candidate of vectors) {
        if (candidate.norm === 0) continue
        let dot = 0
        const shared: Array<{ term: string; weight: number }> = []
        for (const [term, weight] of queryVector) {
          const other = candidate.vector.get(term)
          if (other) {
            dot += weight * other
            shared.push({ term, weight: weight * other })
          }
        }
        if (dot <= 0) continue
        const score = dot / (queryNorm * candidate.norm)
        hits.push({
          id: candidate.id,
          score: Math.min(1, Math.round(score * 1000) / 1000),
          sharedTerms: shared.sort((left, right) => right.weight - left.weight).slice(0, 8).map((entry) => entry.term),
        })
      }
      return hits.sort((left, right) => right.score - left.score).slice(0, limit)
    },
  }
}
