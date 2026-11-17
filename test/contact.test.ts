import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { contactTilesPlugin, memoryLimiter, publicConfig, searchTopics, toPublic } from '../src/index.js'
import { good, make, topics } from './helpers.js'

describe('routing and sending', () => {
  it('sends to the topic group with the sender as reply-to, and stores nothing', async () => {
    const { call, sent } = make()
    const res = await call(good)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ to: 'orders@example.com', replyTo: 'Made Up <made.up@example.org>' })
    expect(String(sent[0]!.subject)).toBe('[Contact] Order question: Made Up')
    expect(String(sent[0]!.text)).toContain('Where is my order')
  })

  it('routes each topic to its own group', async () => {
    const { call, sent } = make()
    await call({ ...good, topic: 'press' })
    expect(sent[0]!.to).toBe('press@example.com')
  })

  it('refuses an unknown topic and sends nothing', async () => {
    const { call, sent } = make({ limits: { address: 99, email: 99 } })
    for (const topic of ['nope', '', 'ORDERS', 'orders@example.com', '__proto__', 'constructor', 7]) {
      const res = await call({ ...good, topic })
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('unknownTopic')
    }
    expect(sent).toHaveLength(0)
  })

  it('never trusts an address from the client', async () => {
    const { call, sent } = make()
    await call({ ...good, to: 'attacker@example.net', cc: 'attacker@example.net', bcc: 'attacker@example.net', replyTo: 'x@example.net', recipient: 'attacker@example.net' })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.to).toBe('orders@example.com')
    expect(JSON.stringify(sent[0])).not.toContain('attacker')
    // a topic field holding an address is an unknown topic, not a route
    const res = await call({ ...good, topic: 'attacker@example.net' })
    expect(res.status).toBe(400)
    expect(sent).toHaveLength(1)
  })

  it('a send failure is a plain 500 and the error is logged, not shown', async () => {
    const m = make()
    m.payload.sendEmail = async () => {
      throw new Error('smtp password is hunter2')
    }
    const res = await m.call(good)
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('hunter2')
    expect(m.logs).toHaveLength(1)
  })

  it('unreadable bodies fail validation', async () => {
    const { call, sent } = make()
    for (const body of ['not json', '[]', 'null', '"x"']) expect((await call(body)).status).toBe(400)
    expect(sent).toHaveLength(0)
  })
})

describe('validation', () => {
  it.each([
    ['name', { name: '' }],
    ['name too long', { name: 'x'.repeat(101) }],
    ['email', { email: 'not-an-email' }],
    ['email with a space', { email: 'a b@example.com' }],
    ['email with two addresses', { email: 'a@example.com,b@example.net' }],
    ['email too long', { email: `${'a'.repeat(250)}@example.com` }],
    ['message short', { message: 'hi' }],
    ['message long', { message: 'x'.repeat(5001) }],
    ['non-string fields', { name: ['a'], email: { a: 1 }, message: 5 }],
  ])('refuses a bad %s', async (_n, bad) => {
    const { call, sent } = make()
    const res = await call({ ...good, ...bad })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid')
    expect(sent).toHaveLength(0)
  })
})

describe('header injection', () => {
  const evil = ['A\r\nBcc: x@example.net', 'A\nBcc: x@example.net', 'A\rBcc: x@example.net', 'A B', 'A\0B']
  it.each(evil)('refuses a line break in the name (%j)', async (name) => {
    const { call, sent } = make()
    expect((await call({ ...good, name })).status).toBe(400)
    expect(sent).toHaveLength(0)
  })
  it.each(evil)('refuses a line break in the email (%j)', async (tail) => {
    const { call, sent } = make()
    expect((await call({ ...good, email: `made.up@example.org${tail}` })).status).toBe(400)
    expect(sent).toHaveLength(0)
  })
  it('keeps angle brackets and quotes in a name out of the reply-to', async () => {
    const { call, sent } = make()
    await call({ ...good, name: 'Mallory "<evil@example.net>"' })
    expect(sent[0]!.replyTo).toBe('Mallory evil@example.net <made.up@example.org>')
    expect(String(sent[0]!.replyTo)).not.toMatch(/[<>"].*[<>"].*[<>"]/)
  })
  it('refuses a topic label with a line break at start-up', () => {
    expect(() => make({ topics: [{ id: 'a', label: 'A\r\nBcc: x@example.net', to: 'a@example.com' }] })).toThrow(/label/)
  })
  it('a line break in the message is body text and can’t reach a header', async () => {
    const { call, sent } = make()
    await call({ ...good, message: 'line one\r\nBcc: x@example.net\r\nmore' })
    expect(String(sent[0]!.subject)).not.toMatch(/[\r\n]/)
    expect(String(sent[0]!.replyTo)).not.toMatch(/[\r\n]/)
    expect(sent[0]).not.toHaveProperty('bcc')
  })
})

describe('honeypot', () => {
  it('looks like success and sends nothing', async () => {
    const { call, sent } = make()
    const res = await call({ ...good, website: 'https://spam.example.net' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(sent).toHaveLength(0)
  })
  it('uses the configured field name, and the default name then does nothing', async () => {
    const { call, sent } = make({ honeypotField: 'url' })
    await call({ ...good, url: 'x' })
    expect(sent).toHaveLength(0)
    await call({ ...good, website: 'x' })
    expect(sent).toHaveLength(1)
  })
  it('whitespace alone doesn’t trip it', async () => {
    const { call, sent } = make()
    await call({ ...good, website: '   ' })
    expect(sent).toHaveLength(1)
  })
  it('a bot that fills it still uses up its address count', async () => {
    const { call } = make({ limits: { address: 2 } })
    await call({ ...good, website: 'x' })
    await call({ ...good, website: 'x' })
    expect((await call({ ...good })).status).toBe(429)
  })
})

describe('rate limits', () => {
  it('limits per address, counting refused requests too', async () => {
    const { call, sent } = make({ limits: { address: 3, email: 99 } })
    for (let i = 0; i < 3; i++) expect((await call({ ...good, message: 'x' })).status).toBe(400)
    const res = await call(good)
    expect(res.status).toBe(429)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('busy')
    expect(sent).toHaveLength(0)
    expect((await call(good, { ip: '203.0.113.9' })).status).toBe(200)
  })
  it('limits per email, whatever the address or letter case', async () => {
    const { call, sent } = make({ limits: { address: 99, email: 2 } })
    expect((await call(good, { ip: '203.0.113.1' })).status).toBe(200)
    expect((await call({ ...good, email: 'MADE.UP@example.org' }, { ip: '203.0.113.2' })).status).toBe(200)
    expect((await call(good, { ip: '203.0.113.3' })).status).toBe(429)
    expect(sent).toHaveLength(2)
    expect((await call({ ...good, email: 'other@example.org' }, { ip: '203.0.113.3' })).status).toBe(200)
  })
  it('requests with no address share one count', async () => {
    const m = make({ limits: { address: 2, email: 99 } })
    const call = (b: unknown) => m.call(b, { ip: '' })
    // an empty x-real-ip is no address at all
    expect((await call(good)).status).toBe(200)
    expect((await call(good)).status).toBe(200)
    expect((await call(good)).status).toBe(429)
  })
  it('behind a proxy the last x-forwarded-for entry counts, so a faked first entry buys nothing', async () => {
    const m = make({ limits: { address: 1, email: 99 } })
    const call = (xff: string) => m.call(good, { ip: '', headers: { 'x-real-ip': '', 'x-forwarded-for': xff } })
    expect((await call('1.1.1.1, 203.0.113.7')).status).toBe(200)
    expect((await call('2.2.2.2, 203.0.113.7')).status).toBe(429)
  })
  it('fails closed when the limiter throws, answers false, or answers something other than true', async () => {
    for (const rateLimit of [() => { throw new Error('db down') }, async () => { throw new Error('down') }, () => false, () => undefined as never, () => 'yes' as never, () => 1 as never]) {
      const { call, sent } = make({ rateLimit })
      const res = await call(good)
      expect([429, 503]).toContain(res.status)
      expect(sent).toHaveLength(0)
    }
    const { call } = make({ rateLimit: () => { throw new Error('x') } })
    expect((await call(good)).status).toBe(503)
  })
  it('a custom limiter is asked about the address and the email', async () => {
    const asked: string[] = []
    const { call } = make({ rateLimit: (kind, key) => (asked.push(kind), key !== '', true) })
    await call(good)
    expect(asked).toEqual(['address', 'email'])
  })
  it('the built-in limiter lets the window expire, and keeps no plain keys', () => {
    let now = 0
    const lim = memoryLimiter({ address: 1, email: 1 }, 1000, () => now)
    expect(lim('address', 'a')).toBe(true)
    expect(lim('address', 'a')).toBe(false)
    now = 1001
    expect(lim('address', 'a')).toBe(true)
  })
})

describe('no-JS form posts', () => {
  it('redirects back with sent=1', async () => {
    const { call, sent } = make()
    const res = await call(good, { form: true })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/contact?sent=1')
    expect(sent).toHaveLength(1)
  })
  it('redirects back with the error code', async () => {
    const { call } = make({ redirectTo: '/help/contact' })
    const res = await call({ ...good, email: 'bad' }, { form: true })
    expect(res.headers.get('location')).toBe('/help/contact?error=invalid')
  })
})

describe('what the browser may see', () => {
  it('lists topics and tiles with no address anywhere', async () => {
    const { topicsReq } = make()
    const text = JSON.stringify(await (await topicsReq()).json())
    expect(text).toContain('Order question')
    expect(text).toContain('refund')
    expect(text).not.toMatch(/@example\.com/)
    expect(text).not.toContain('"to"')
  })
  it('publicConfig and toPublic drop the address', () => {
    expect(toPublic(topics[0]!)).not.toHaveProperty('to')
    expect(JSON.stringify(publicConfig(make().o))).not.toContain('@')
  })
  it('an error never includes an address', async () => {
    const { call } = make()
    const res = await call({ ...good, topic: 'nope' })
    expect(await res.text()).not.toContain('@example.com')
  })
  it('tiles default to the first six topics and use the topic label', () => {
    const cfg = publicConfig(make({ tiles: [{ topic: 'press', label: 'Media' }] }).o)
    expect(cfg.tiles).toEqual([{ topic: 'press', label: 'Media' }])
    expect(publicConfig(make().o).tiles.map((t) => t.topic)).toEqual(['orders', 'sponsors', 'press', 'other'])
  })
})

describe('configuration', () => {
  it.each([
    ['no topics', { topics: [] }],
    ['a bad id', { topics: [{ id: 'Bad Id', label: 'x', to: 'a@example.com' }] }],
    ['a repeated id', { topics: [topics[0]!, topics[0]!] }],
    ['no address', { topics: [{ id: 'a', label: 'A', to: '' }] }],
    ['two addresses', { topics: [{ id: 'a', label: 'A', to: 'a@example.com, b@example.com' }] }],
    ['a display name in the address', { topics: [{ id: 'a', label: 'A', to: 'A <a@example.com>' }] }],
    ['a tile for no topic', { tiles: [{ topic: 'ghost' }] }],
    ['an outside redirect', { redirectTo: 'https://example.net/' }],
    ['a protocol-relative redirect', { redirectTo: '//example.net/' }],
  ])('refuses %s at start-up', (_n, extra) => {
    expect(() => make(extra as never)).toThrow(/Contact tiles/)
  })
  it('adds two endpoints and no collections, and refuses a clash', async () => {
    const cfg = (await contactTilesPlugin({ topics })({ collections: [] } as never)) as Config
    expect(cfg.endpoints?.map((e) => `${e.method} ${e.path}`)).toEqual(['post /contact', 'get /contact/topics'])
    expect(cfg.collections).toEqual([])
    expect(() => contactTilesPlugin({ topics })(cfg)).toThrow(/already exists/)
  })
})

describe('search', () => {
  const pub = topics.map(toPublic)
  it('finds by label, synonym and word, best first', () => {
    expect(searchTopics(pub, 'ord')[0]!.id).toBe('orders')
    expect(searchTopics(pub, 'refund').map((t) => t.id)).toEqual(['orders'])
    expect(searchTopics(pub, 'podcast')[0]!.id).toBe('press')
    expect(searchTopics(pub, 'Jöurnalist')[0]!.id).toBe('press')
  })
  it('needs every word to match, and gives all topics for an empty query', () => {
    expect(searchTopics(pub, 'order podcast')).toEqual([])
    expect(searchTopics(pub, '  ')).toHaveLength(4)
    expect(searchTopics(pub, 'zzz')).toEqual([])
  })
  it('puts a label start before a synonym start', () => {
    const t = [
      { id: 'b', label: 'Billing', synonyms: ['sponsor'] },
      { id: 's', label: 'Sponsors' },
    ]
    expect(searchTopics(t, 'spon').map((x) => x.id)).toEqual(['s', 'b'])
  })
})
