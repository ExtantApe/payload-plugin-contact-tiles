import type { PayloadRequest } from 'payload'

import type { ErrorCode, ResolvedContact } from './types.js'

export class ContactError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

const CRLF = /[\r\n\u2028\u2029\0]/
const EMAIL = /^[^\s@<>(),;:\\"[\]]+@[^\s@<>(),;:\\"[\]]+\.[^\s@<>(),;:\\"[\]]{2,}$/

export const defaultClientAddress = (req: PayloadRequest): string | null => {
  const h = req.headers
  const real = h?.get?.('x-real-ip')?.trim()
  if (real) return real
  return h?.get?.('x-forwarded-for')?.split(',').at(-1)?.trim() || null
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Plain, safe in a header: no quotes, angle brackets or control characters. */
const displayName = (name: string) => name.replace(/["\\<>,;]/g, '').replace(/\s+/g, ' ').trim()

export type Sent = { ok: true; delivered: boolean }

/**
 * The whole flow, in this order: count the address, honeypot, validate (refusing line breaks), count the email,
 * look the topic up by id, send. A limiter that breaks refuses. Nothing is stored.
 */
export async function submitContact(o: ResolvedContact, req: PayloadRequest, raw: Record<string, unknown>): Promise<Sent> {
  const allow = async (kind: 'address' | 'email', key: string) => {
    try {
      return (await o.rateLimit(kind, key, req)) === true
    } catch {
      throw new ContactError('unavailable', 'Contact is unavailable right now. Please try again later.', 503)
    }
  }
  const busy = () => new ContactError('busy', 'Too many tries. Please try again in an hour.', 429)

  // Every request counts against its address, junk and bots included. No address shares one "unknown" count.
  if (!(await allow('address', o.clientAddress(req) ?? 'unknown'))) throw busy()

  // A filled honeypot looks like success, so a bot learns nothing, and sends nothing.
  if (text(raw[o.honeypotField]).trim() !== '') return { ok: true, delivered: false }

  const name = text(raw.name).trim()
  const email = text(raw.email).trim()
  const message = text(raw.message).trim()
  const topicId = text(raw.topic).trim()
  if (CRLF.test(name) || CRLF.test(email)) throw new ContactError('invalid', 'Name and email can’t contain line breaks.', 400)
  if (!name || name.length > 100) throw new ContactError('invalid', 'Please give your name (up to 100 characters).', 400)
  if (!email || email.length > 254 || !EMAIL.test(email)) throw new ContactError('invalid', 'Please give a valid email address.', 400)
  if (message.length < 5 || message.length > o.maxMessage) throw new ContactError('invalid', `Please write a message of 5 to ${o.maxMessage} characters.`, 400)
  const safeName = displayName(name)
  if (!safeName) throw new ContactError('invalid', 'Please give your name.', 400)

  if (!(await allow('email', email))) throw busy()

  // The route comes from the topic id and nothing else. An address sent by the browser is never read.
  const topic = o.topics.get(topicId)
  if (!topic) throw new ContactError('unknownTopic', 'Please choose what you are contacting us about.', 400)

  const subject = `${o.subjectPrefix} ${topic.label}: ${safeName}`.replace(/\s+/g, ' ').trim()
  if (CRLF.test(subject)) throw new ContactError('error', 'Something went wrong. Please try again later.', 500)
  try {
    await req.payload.sendEmail({
      to: topic.to,
      replyTo: `${safeName} <${email}>`,
      subject,
      text: `Topic: ${topic.label}\nFrom: ${safeName} <${email}>\n\n${message}\n`,
    })
  } catch (err) {
    req.payload.logger?.error?.({ err, msg: 'contact-tiles: send failed' })
    throw new ContactError('error', 'Something went wrong. Please try again later.', 500)
  }
  return { ok: true, delivered: true }
}
