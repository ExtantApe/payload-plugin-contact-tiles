import type { PublicTopic, Topic } from './types.js'

/** Lowercase, no accents, single spaces. */
export const normalize = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** Strips the address. Everything the browser may see goes through here. */
export const toPublic = (t: Pick<Topic, 'id' | 'label' | 'synonyms' | 'hint'>): PublicTopic => ({
  id: t.id,
  label: t.label,
  ...(t.synonyms?.length ? { synonyms: [...t.synonyms] } : {}),
  ...(t.hint ? { hint: t.hint } : {}),
})

/**
 * Topics matching what someone typed, best first: label starts with it, a synonym starts with it, a word of the label
 * or a synonym starts with it, then anything that contains it. Every typed word has to match. An empty query
 * gives every topic in the order given.
 */
export function searchTopics<T extends PublicTopic>(topics: T[], query: string, limit = 8): T[] {
  const q = normalize(query)
  if (!q) return topics.slice(0, limit)
  const words = q.split(' ')
  const scored: { t: T; score: number; i: number }[] = []
  topics.forEach((t, i) => {
    const label = normalize(t.label)
    const syns = (t.synonyms ?? []).map(normalize)
    let total = 0
    for (const w of words) {
      let best = 0
      if (label.startsWith(w)) best = 4
      else if (syns.some((s) => s.startsWith(w))) best = 3
      else if ([label, ...syns].some((s) => s.split(' ').some((x) => x.startsWith(w)))) best = 2
      else if ([label, ...syns].some((s) => s.includes(w))) best = 1
      if (!best) return
      total += best
    }
    scored.push({ t, score: total, i })
  })
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).slice(0, limit).map((x) => x.t)
}
