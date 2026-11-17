import { createHash } from 'node:crypto'

import type { RateKind } from './types.js'

/**
 * A small in-memory limiter: at most `limits[kind]` attempts per key in the window. Keys are hashed, so addresses
 * and emails aren't kept as text. It counts per process; on several servers or serverless, pass `rateLimit`.
 */
export function memoryLimiter(limits: Record<RateKind, number>, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, number[]>()
  let lastSweep = now()
  return (kind: RateKind, key: string): boolean => {
    const t = now()
    if (t - lastSweep > windowMs) {
      for (const [k, v] of hits) if (!v.some((x) => t - x < windowMs)) hits.delete(k)
      lastSweep = t
    }
    const id = `${kind}:${createHash('sha256').update(key.toLowerCase()).digest('hex')}`
    const recent = (hits.get(id) ?? []).filter((x) => t - x < windowMs)
    if (recent.length >= limits[kind]) {
      hits.set(id, recent)
      return false
    }
    recent.push(t)
    hits.set(id, recent)
    return true
  }
}
