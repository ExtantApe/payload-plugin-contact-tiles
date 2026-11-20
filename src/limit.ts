import { createHash } from 'node:crypto'

import type { RateKind, RateStore } from './types.js'

/**
 * A small in-memory limiter: at most `limits[kind]` attempts per key in the window. Keys are hashed, so addresses
 * and emails aren't kept as text. It counts per process; on several servers or serverless, pass `rateLimit`.
 */
export function memoryLimiter(limits: Record<RateKind, number>, windowMs: number, now: () => number = Date.now, maxKeys = 50_000) {
  const hits = new Map<string, number[]>()
  let lastSweep = now()
  return (kind: RateKind, key: string): boolean => {
    const t = now()
    if (t - lastSweep > windowMs) {
      for (const [k, v] of hits) if (!v.some((x) => t - x < windowMs)) hits.delete(k)
      lastSweep = t
    }
    const id = `${kind}:${createHash('sha256').update(key.toLowerCase()).digest('hex')}`
    if (!hits.has(id) && hits.size >= maxKeys) {
      // Full: drop what has expired, and if that frees nothing, refuse the new key (fails closed).
      for (const [k, v] of hits) if (!v.some((x) => t - x < windowMs)) hits.delete(k)
      lastSweep = t
      if (hits.size >= maxKeys) return false
    }
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

/** Wraps a shared counter as a limiter. Keys are hashed. A count that isn't a number refuses; a throw propagates and refuses. */
export function storeLimiter(store: RateStore, limits: Record<RateKind, number>, windowMs: number) {
  return async (kind: RateKind, key: string): Promise<boolean> => {
    const id = `${kind}:${createHash('sha256').update(key.toLowerCase()).digest('hex')}`
    const { count } = await store.hit(id, windowMs)
    return typeof count === 'number' && Number.isFinite(count) && count <= limits[kind]
  }
}
