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

/** Words that carry no meaning in a search ("where is my kit", "I want to be featured"). */
export const fillerWords = new Set(
  'a about am an and any are as at be been being but by can could did do does for from get got had has have hello hi how i if in into is it its me my of on or our please so some than that the their them then there these they this to us want wanted was we were what when where which who why will with would you your'.split(' '),
)

/**
 * Topics matching what someone typed, best first. Filler words ("where", "is", "my", "want") are ignored. A topic
 * that matches every meaningful word comes before one that matches only some; after that, more matched words
 * come first, then the stronger match (label starts with it, a synonym starts with it, a word of either starts
 * with it, then anything that contains it). A topic matching one word is still listed. If the query is nothing
 * but filler, every word counts. `fallback` (default `other`) is always last, so a search never ends with no
 * choice; it appears on its own when nothing else matches. An empty query gives every topic in the order given.
 */
export function searchTopics<T extends PublicTopic>(topics: T[], query: string, limit = 8, fallback = 'other'): T[] {
  const q = normalize(query)
  if (!q) return topics.slice(0, limit)
  const all = q.split(' ')
  const meaningful = all.filter((w) => !fillerWords.has(w))
  const words = meaningful.length ? meaningful : all
  const scored: { t: T; matched: number; score: number; i: number }[] = []
  let other: T | undefined
  topics.forEach((t, i) => {
    if (t.id === fallback) {
      other = t
      return
    }
    const label = normalize(t.label)
    const syns = (t.synonyms ?? []).map(normalize)
    const parts = [label, ...syns]
    let matched = 0
    let score = 0
    for (const w of words) {
      let best = 0
      if (label.startsWith(w)) best = 4
      else if (syns.some((s) => s.startsWith(w))) best = 3
      else if (parts.some((s) => s.split(' ').some((x) => x.startsWith(w)))) best = 2
      else if (parts.some((s) => s.includes(w))) best = 1
      else if (w.length >= 5 && parts.some((s) => s.split(' ').some((x) => x.length >= 4 && w.startsWith(x)))) best = 1
      if (best) {
        matched++
        score += best
      }
    }
    if (matched) scored.push({ t, matched, score, i })
  })
  const full = (m: number) => (m === words.length ? 1 : 0)
  const list = scored
    .sort((a, b) => full(b.matched) - full(a.matched) || b.matched - a.matched || b.score - a.score || a.i - b.i)
    .map((x) => x.t)
  return other ? [...list.slice(0, Math.max(limit - 1, 0)), other] : list.slice(0, limit)
}
