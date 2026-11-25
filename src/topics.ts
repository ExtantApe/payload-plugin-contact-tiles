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

const squash = (s: string): string => s.replace(/ /g, '')
const initials = (s: string): string =>
  s
    .split(' ')
    .map((w) => w[0] ?? '')
    .join('')

/**
 * Topics matching what someone typed, best first. Case, accents, punctuation and spaces do not matter:
 * "presspodcast", "press-podcast" and "Press podcast" all find the same topic, because the squashed forms
 * (spaces removed) are compared as well. A single token of 2 or more letters also matches the word initials of
 * a label or synonym ("ttpg" finds "Tabletop Playground"). Ranking: a query equal to a label or synonym comes
 * first, then one that is the start of a label or synonym. After that, a topic that matches every meaningful
 * word comes before one that matches only some, then more matched words, then the stronger match (label starts
 * with it, a synonym starts with it, a word of either starts with it, then anything that contains it). A topic
 * matching one word is still listed. Filler words ("where", "is", "my", "want") are ignored; if the query is
 * nothing but filler, every word counts. There is no fuzzy matching, so results stay predictable. `fallback`
 * (default `other`) is always last, so a search never ends with no choice; it appears on its own when nothing
 * else matches. An empty query gives every topic in the order given.
 */
export function searchTopics<T extends PublicTopic>(topics: T[], query: string, limit = 8, fallback = 'other'): T[] {
  const q = normalize(query)
  if (!q) return topics.slice(0, limit)
  const all = q.split(' ')
  const meaningful = all.filter((w) => !fillerWords.has(w))
  const words = meaningful.length ? meaningful : all
  const qs = squash(q)
  const scored: { t: T; matched: number; score: number; rank: number; i: number }[] = []
  let other: T | undefined
  topics.forEach((t, i) => {
    if (t.id === fallback) {
      other = t
      return
    }
    const label = normalize(t.label)
    const syns = (t.synonyms ?? []).map(normalize)
    const parts = [label, ...syns]
    const squashed = parts.map(squash)
    let rank = 0
    if (squashed.some((s) => s === qs)) rank = 2
    else if (squashed.some((s) => s.startsWith(qs))) rank = 1
    let matched = 0
    let score = 0
    for (const w of words) {
      let best = 0
      const labelSq = squash(label)
      if (label.startsWith(w) || labelSq.startsWith(w)) best = 4
      else if (syns.some((s) => s.startsWith(w) || squash(s).startsWith(w))) best = 3
      else if (parts.some((s) => s.split(' ').some((x) => x.startsWith(w)))) best = 2
      else if (all.length === 1 && w.length >= 2 && parts.some((s) => s.includes(' ') && initials(s) === w)) best = 2
      else if (parts.some((s) => s.includes(w)) || squashed.some((s) => s.includes(w))) best = 1
      else if (w.length >= 5 && parts.some((s) => s.split(' ').some((x) => x.length >= 4 && w.startsWith(x)))) best = 1
      if (best) {
        matched++
        score += best
      }
    }
    if (rank && matched < words.length) matched = words.length
    if (matched) scored.push({ t, matched, score, rank, i })
  })
  const full = (m: number) => (m === words.length ? 1 : 0)
  const list = scored
    .sort(
      (a, b) =>
        b.rank - a.rank || full(b.matched) - full(a.matched) || b.matched - a.matched || b.score - a.score || a.i - b.i,
    )
    .map((x) => x.t)
  return other ? [...list.slice(0, Math.max(limit - 1, 0)), other] : list.slice(0, limit)
}
