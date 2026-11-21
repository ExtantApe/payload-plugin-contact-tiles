import type { Config, Endpoint, PayloadRequest, Plugin } from 'payload'

import { ContactError, clientAddressFrom, submitContact } from './handler.js'
import { memoryLimiter, storeLimiter } from './limit.js'
import { resultAnchor } from './anchor.js'
import { toPublic } from './topics.js'
import type { ContactPluginOptions, ResolvedContact } from './types.js'

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

const MAX_BODY = 64 * 1024
const tooBig = () => new ContactError('invalid', 'That message is too large.', 413)

/**
 * Reads a JSON or url-encoded body, at most 64 KB. A larger `content-length` is refused before reading, and a
 * stream is cut off at the cap. Multipart is refused. Anything unreadable counts as empty, which fails validation.
 */
const readBody = async (req: PayloadRequest): Promise<{ data: Record<string, unknown>; form: boolean }> => {
  const type = req.headers.get('content-type') ?? ''
  if (type.includes('multipart/form-data')) throw new ContactError('invalid', 'This form can’t take file uploads.', 415)
  const form = type.includes('application/x-www-form-urlencoded')
  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > MAX_BODY) throw tooBig()
  let body = ''
  const reader = (req.body as ReadableStream<Uint8Array> | null | undefined)?.getReader?.()
  if (reader) {
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY) {
        await reader.cancel().catch(() => undefined)
        throw tooBig()
      }
      chunks.push(value)
    }
    body = new TextDecoder().decode(Buffer.concat(chunks))
  }
  try {
    if (form) return { data: Object.fromEntries(new URLSearchParams(body).entries()), form }
    const parsed = JSON.parse(body) as unknown
    return { data: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}, form }
  } catch {
    return { data: {}, form }
  }
}

/** Resolves and checks the options. Throws at start-up for anything that would fail later or leak. */
export function resolveOptions(options: ContactPluginOptions): ResolvedContact {
  if (!options?.topics?.length) throw new Error('Contact tiles: give `topics`, at least one.')
  const topics = new Map<string, ContactPluginOptions['topics'][number]>()
  for (const t of options.topics) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(t.id ?? '')) throw new Error(`Contact tiles: topic id "${t.id}" must be lowercase letters, digits and hyphens.`)
    if (topics.has(t.id)) throw new Error(`Contact tiles: topic id "${t.id}" is used twice.`)
    if (!t.label?.trim() || /[\r\n]/.test(t.label)) throw new Error(`Contact tiles: topic "${t.id}" needs a one-line label.`)
    if (!t.to || /[\s,;<>"\r\n]/.test(t.to) || !t.to.includes('@')) throw new Error(`Contact tiles: topic "${t.id}" needs one plain email address in \`to\`.`)
    topics.set(t.id, t)
  }
  const tiles = options.tiles ?? options.topics.slice(0, 6).map((t) => ({ topic: t.id }))
  for (const tile of tiles) if (!topics.has(tile.topic)) throw new Error(`Contact tiles: a tile points at "${tile.topic}", which isn't a topic.`)
  const redirectTo = options.redirectTo ?? '/contact'
  if (!redirectTo.startsWith('/') || redirectTo.startsWith('//') || /[\r\n\\]/.test(redirectTo)) throw new Error('Contact tiles: `redirectTo` must be a path on the site, such as /contact.')
  const path = options.path ?? '/contact'
  if (!path.startsWith('/')) throw new Error('Contact tiles: `path` must start with a slash.')
  const limits = { address: 5, email: 3, ...options.limits }
  const windowMs = (options.windowMinutes ?? 60) * 60_000
  const rl = options.rateLimit
  const builtin = rl && typeof rl === 'object' ? storeLimiter(rl.store, limits, windowMs) : memoryLimiter(limits, windowMs, Date.now, options.maxKeys)
  return {
    topics,
    tiles,
    subjectPrefix: options.subjectPrefix ?? '[Contact]',
    path,
    redirectTo,
    honeypotField: options.honeypotField ?? 'website',
    limits,
    windowMs,
    rateLimit: typeof rl === 'function' ? rl : (kind, key) => builtin(kind, key),
    clientAddress: options.clientAddress ?? clientAddressFrom(options.trustProxy ?? false),
    verifyTimeoutMs: options.verifyTimeoutMs ?? 10_000,
    maxMessage: options.maxMessage ?? 5000,
    verifyHuman: options.verifyHuman,
    humanTokenField: options.humanTokenField ?? 'humanToken',
  }
}

export const contactEndpoints = (o: ResolvedContact): Endpoint[] => [
  {
    path: o.path,
    method: 'post',
    handler: async (req) => {
      const form = (req.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded')
      try {
        await submitContact(o, req, async () => (await readBody(req)).data)
        return form ? redirect(o, 'sent=1') : json({ ok: true })
      } catch (err) {
        const e =
          err instanceof ContactError
            ? err
            : (req.payload.logger?.error?.({ err, msg: 'contact-tiles: request failed' }), new ContactError('error', 'Something went wrong. Please try again later.', 500))
        return form ? redirect(o, `error=${e.code}`) : json({ error: { code: e.code, message: e.message } }, e.status)
      }
    },
  },
  {
    // What the browser may know: ids, labels, synonyms and hints. Never an address.
    path: `${o.path}/topics`,
    method: 'get',
    handler: () => json(publicConfig(o)),
  },
]

const redirect = (o: ResolvedContact, query: string) => new Response(null, { status: 303, headers: { Location: `${o.redirectTo}?${query}#${resultAnchor}`, 'Cache-Control': 'no-store' } })

/** Topics and tiles for the page, with no addresses. Use it in a server component, or fetch `GET <path>/topics`. */
export function publicConfig(o: ResolvedContact) {
  return {
    topics: [...o.topics.values()].map(toPublic),
    tiles: o.tiles.map((t) => ({ topic: t.topic, label: t.label ?? o.topics.get(t.topic)!.label, ...(t.hint ?? o.topics.get(t.topic)!.hint ? { hint: t.hint ?? o.topics.get(t.topic)!.hint } : {}) })),
    path: o.path,
    honeypotField: o.honeypotField,
    humanCheck: !!o.verifyHuman,
    humanTokenField: o.humanTokenField,
    maxMessage: o.maxMessage,
  }
}

/**
 * Contact tiles: a contact form's back end. Topics, routes and tiles come from the options. It adds two
 * endpoints and no collections, and stores nothing.
 */
export const contactTilesPlugin =
  (options: ContactPluginOptions): Plugin =>
  (config: Config): Config => {
    const o = resolveOptions(options)
    const taken = new Set((config.endpoints ?? []).map((e) => `${e.method}:${e.path}`))
    for (const e of contactEndpoints(o)) if (taken.has(`${e.method}:${e.path}`)) throw new Error(`Contact tiles: ${e.method.toUpperCase()} ${e.path} already exists in this config. Set \`path\`.`)
    return { ...config, endpoints: [...(config.endpoints ?? []), ...contactEndpoints(o)] }
  }

export type PublicConfig = ReturnType<typeof publicConfig>
