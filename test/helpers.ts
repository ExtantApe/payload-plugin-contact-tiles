import type { PayloadRequest } from 'payload'

import { contactEndpoints, resolveOptions, type ContactPluginOptions } from '../src/index.js'

export const topics = [
  { id: 'orders', label: 'Order question', synonyms: ['refund', 'shipping', 'kit'], to: 'orders@example.com', hint: 'Where is my kit?' },
  { id: 'sponsors', label: 'Sponsor us', synonyms: ['donate', 'partnership'], to: 'sponsors@example.com' },
  { id: 'press', label: 'Press or podcast', synonyms: ['interview', 'journalist'], to: 'press@example.com' },
  { id: 'other', label: 'Something else', to: 'help@example.com' },
]

export const make = (extra: Partial<ContactPluginOptions> = {}) => {
  const o = resolveOptions({ topics, ...extra })
  const sent: Record<string, unknown>[] = []
  const logs: unknown[] = []
  const payload = {
    sendEmail: async (m: Record<string, unknown>) => void sent.push(m),
    logger: { error: (x: unknown) => void logs.push(x) },
  }
  const [post, get] = contactEndpoints(o)
  const call = async (body: unknown, opts: { ip?: string; form?: boolean; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { 'x-real-ip': opts.ip ?? '203.0.113.1', ...opts.headers }
    let init: RequestInit
    if (opts.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded'
      init = { method: 'POST', headers, body: new URLSearchParams(body as Record<string, string>).toString() }
    } else {
      headers['content-type'] = 'application/json'
      init = { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }
    }
    const req = Object.assign(new Request('https://site.example.com/api/contact', init), { payload }) as unknown as PayloadRequest
    return post!.handler(req) as Promise<Response>
  }
  const topicsReq = () => get!.handler(Object.assign(new Request('https://site.example.com/api/contact/topics'), { payload }) as unknown as PayloadRequest) as Promise<Response>
  return { o, sent, logs, call, topicsReq, payload }
}

export const good = { name: 'Made Up', email: 'made.up@example.org', message: 'Where is my order, please?', topic: 'orders' }
