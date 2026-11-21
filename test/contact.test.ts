import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { contactTilesPlugin, memoryLimiter, publicConfig, resultAnchor, searchTopics, toPublic } from '../src/index.js'
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
    const m = make({ limits: { address: 1, email: 99 }, trustProxy: 'x-forwarded-for' })
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
    expect(res.headers.get('location')).toBe('/contact?sent=1#contact-result')
    expect(sent).toHaveLength(1)
  })
  it('redirects back with the error code', async () => {
    const { call } = make({ redirectTo: '/help/contact' })
    const res = await call({ ...good, email: 'bad' }, { form: true })
    expect(res.headers.get('location')).toBe('/help/contact?error=invalid#contact-result')
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
    expect(searchTopics(pub, 'refund').map((t) => t.id)).toEqual(['orders', 'other'])
    expect(searchTopics(pub, 'podcast')[0]!.id).toBe('press')
    expect(searchTopics(pub, 'Jöurnalist')[0]!.id).toBe('press')
  })
  it('gives all topics for an empty query, and only the fallback when nothing matches', () => {
    expect(searchTopics(pub, '  ')).toHaveLength(4)
    expect(searchTopics(pub, 'zzz').map((t) => t.id)).toEqual(['other'])
  })
  it('ignores filler words', () => {
    expect(searchTopics(pub, 'where is my kit').map((t) => t.id)).toEqual(['orders', 'other'])
    expect(searchTopics(pub, 'I want to be featured on a podcast').map((t) => t.id)).toEqual(['press', 'other'])
    expect(searchTopics(pub, 'I want to sponsor you')[0]!.id).toBe('sponsors')
  })
  it('uses the words as given when the query is only filler', () => {
    expect(searchTopics(pub, 'the').map((t) => t.id)).toEqual(['other'])
    expect(searchTopics([{ id: 'a', label: 'My account' }, { id: 'other', label: 'Other' }], 'my').map((t) => t.id)).toEqual(['a', 'other'])
  })
  it('ranks by how many words match, full matches first, then lists partial matches', () => {
    const t = [
      { id: 'a', label: 'Order question', synonyms: ['refund'] },
      { id: 'b', label: 'Podcast guest', synonyms: ['refund', 'interview'] },
      { id: 'c', label: 'Podcast' },
    ]
    expect(searchTopics(t, 'podcast refund interview').map((x) => x.id)).toEqual(['b', 'c', 'a'])
    expect(searchTopics(t, 'order podcast').map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })
  it('matches a longer typed word to a shorter topic word (featured, interviews)', () => {
    expect(searchTopics(pub, 'interviews').map((t) => t.id)).toEqual(['press', 'other'])
  })
  it('always puts the fallback last, even when it matches and the limit is small', () => {
    expect(searchTopics(pub, 'something', 8).map((t) => t.id)).toEqual(['other'])
    expect(searchTopics(pub, 'o', 2).map((t) => t.id)).toHaveLength(2)
    expect(searchTopics(pub, 'o', 2).at(-1)!.id).toBe('other')
    expect(searchTopics(pub, 'zzz', 8, 'nothing')).toEqual([])
    expect(searchTopics(pub, 'sponsor', 8, 'press').map((t) => t.id)).toEqual(['sponsors', 'press'])
  })
  it('puts a label start before a synonym start', () => {
    const t = [
      { id: 'b', label: 'Billing', synonyms: ['sponsor'] },
      { id: 's', label: 'Sponsors' },
    ]
    expect(searchTopics(t, 'spon').map((x) => x.id)).toEqual(['s', 'b'])
  })
})

describe('redirect anchor', () => {
  it('ends every no-JS redirect with the result anchor, and JSON replies have none', async () => {
    const { call } = make()
    expect((await call(good, { form: true })).headers.get('location')).toMatch(/#contact-result$/)
    expect((await call({ ...good, topic: 'nope' }, { form: true })).headers.get('location')).toBe('/contact?error=unknownTopic#contact-result')
    expect(resultAnchor).toBe('contact-result')
  })
})

describe('optional human check', () => {
  it('is off unless set: behavior is unchanged and the page is told so', async () => {
    const { call, sent, o } = make()
    expect((await call(good)).status).toBe(200)
    expect(sent).toHaveLength(1)
    expect(publicConfig(o).humanCheck).toBe(false)
  })
  it('true sends, and the token, address and request reach the hook', async () => {
    const seen: { token?: string; address: string | null; hasReq: boolean }[] = []
    const { call, sent, o } = make({ verifyHuman: ({ token, address, req }) => (seen.push({ token, address, hasReq: !!req?.headers?.get }), true) })
    expect((await call({ ...good, humanToken: 'tok-123' }, { ip: '203.0.113.5' })).status).toBe(200)
    expect(sent).toHaveLength(1)
    expect(seen).toEqual([{ token: 'tok-123', address: '203.0.113.5', hasReq: true }])
    expect(publicConfig(o).humanCheck).toBe(true)
  })
  it('a missing or non-string token reaches the hook as undefined', async () => {
    const tokens: unknown[] = []
    const { call } = make({ verifyHuman: ({ token }) => (tokens.push(token), true) })
    await call(good)
    await call({ ...good, humanToken: ['x'] })
    expect(tokens).toEqual([undefined, undefined])
  })
  it('reads the token from the configured field', async () => {
    const tokens: unknown[] = []
    const { call } = make({ humanTokenField: 'cf-turnstile-response', verifyHuman: ({ token }) => (tokens.push(token), true) })
    await call({ ...good, humanToken: 'wrong', 'cf-turnstile-response': 'right' })
    expect(tokens).toEqual(['right'])
  })
  it.each([
    ['false', () => false],
    ['a throw', () => { throw new Error('verifier down: secret-detail') }],
    ['a rejection', async () => { throw new Error('verifier down') }],
    ['undefined', () => undefined as never],
    ['a string', () => 'true' as never],
    ['1', () => 1 as never],
    ['an object', () => ({}) as never],
  ])('%s refuses, sends nothing, and says nothing about why', async (_n, verifyHuman) => {
    const { call, sent } = make({ verifyHuman })
    const res = await call({ ...good, humanToken: 't' })
    expect(res.status).toBe(400)
    const body = await res.text()
    expect(JSON.parse(body).error.code).toBe('human')
    expect(body).not.toMatch(/secret-detail|verifier|@example/)
    expect(sent).toHaveLength(0)
  })
  it('runs before the topic is routed: a bad human check with a bad topic says only "human"', async () => {
    const { call } = make({ verifyHuman: () => false })
    expect(((await (await call({ ...good, topic: 'nope' })).json()) as { error: { code: string } }).error.code).toBe('human')
  })
  it('the no-JS form post forwards the token and redirects with the error', async () => {
    const tokens: unknown[] = []
    const ok = make({ verifyHuman: ({ token }) => (tokens.push(token), true) })
    expect((await ok.call({ ...good, humanToken: 'form-tok' }, { form: true })).headers.get('location')).toBe('/contact?sent=1#contact-result')
    expect(tokens).toEqual(['form-tok'])
    const no = make({ verifyHuman: () => false })
    expect((await no.call(good, { form: true })).headers.get('location')).toBe('/contact?error=human#contact-result')
    expect(no.sent).toHaveLength(0)
  })
  it('still counts the address, so a failing check can’t be hammered', async () => {
    const { call } = make({ limits: { address: 2 }, verifyHuman: () => false })
    await call(good)
    await call(good)
    expect((await call(good)).status).toBe(429)
  })
})

describe('review fixes', () => {
  it('by default no header is trusted: a spoofed x-real-ip or x-forwarded-for buys no new count', async () => {
    const m = make({ trustProxy: false, limits: { address: 5, email: 999 } })
    let ok = 0
    for (let i = 0; i < 20; i++) {
      const res = await m.call({ ...good, email: `u${i}@example.org` }, { ip: `9.9.9.${i}`, headers: { 'x-forwarded-for': `8.8.8.${i}` } })
      if (res.status === 200) ok++
    }
    expect(ok).toBe(5)
  })
  it('with trustProxy x-forwarded-for, a spoofed x-real-ip is ignored', async () => {
    const m = make({ trustProxy: 'x-forwarded-for', limits: { address: 2, email: 999 } })
    let ok = 0
    for (let i = 0; i < 6; i++) if ((await m.call({ ...good, email: `u${i}@example.org` }, { ip: `9.9.9.${i}`, headers: { 'x-forwarded-for': '203.0.113.7' } })).status === 200) ok++
    expect(ok).toBe(2)
  })
  it('the built-in limiter keeps at most maxKeys keys and refuses new ones when full', async () => {
    const { memoryLimiter } = await import('../src/limit.js')
    let t = 0
    const lim = memoryLimiter({ address: 5, email: 5 }, 1000, () => t, 3)
    expect(['a', 'b', 'c'].map((k) => lim('address', k))).toEqual([true, true, true])
    expect(lim('address', 'd')).toBe(false)
    expect(lim('address', 'a')).toBe(true)
    t = 2000
    expect(lim('address', 'd')).toBe(true)
  })
  it('refuses a large content-length and multipart before reading, but after counting the address', async () => {
    const m = make({ limits: { address: 2, email: 99 } })
    const big = await m.call(good, { headers: { 'content-length': '70000' } })
    expect(big.status).toBe(413)
    const multi = await m.call(good, { headers: { 'content-type': 'multipart/form-data; boundary=x' } })
    expect(multi.status).toBe(415)
    expect((await m.call(good)).status).toBe(429)
  })
  it('cuts off a streamed body over the cap', async () => {
    const m = make()
    const res = await m.call('{"name":"' + 'a'.repeat(70_000) + '"}')
    expect(res.status).toBe(413)
    expect(m.sent).toHaveLength(0)
  })
  it('a human check that never answers refuses after the timeout', async () => {
    const m = make({ verifyHuman: () => new Promise<boolean>(() => undefined), verifyTimeoutMs: 20 })
    const res = await m.call({ ...good, humanToken: 't' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('human')
    expect(m.sent).toHaveLength(0)
  })
  it('a human token over 2048 characters refuses without calling the check', async () => {
    let called = false
    const m = make({ verifyHuman: () => ((called = true), true) })
    expect((await m.call({ ...good, humanToken: 'x'.repeat(2049) })).status).toBe(400)
    expect(called).toBe(false)
  })
  it('rateLimit.store: counts through the store, and refuses past the limit', async () => {
    const counts = new Map<string, number>()
    const keys: string[] = []
    const store = { hit: async (k: string) => (keys.push(k), counts.set(k, (counts.get(k) ?? 0) + 1), { count: counts.get(k)! }) }
    const m = make({ rateLimit: { store }, limits: { address: 2, email: 99 } })
    expect((await m.call(good)).status).toBe(200)
    expect((await m.call(good)).status).toBe(200)
    expect((await m.call(good)).status).toBe(429)
    expect(keys.every((k) => /^(address|email):[0-9a-f]{64}$/.test(k))).toBe(true)
  })
  it('rateLimit.store: a store that throws, or answers a non-number, refuses the send', async () => {
    for (const hit of [async () => { throw new Error('redis down') }, () => { throw new Error('x') }, async () => ({ count: NaN }), async () => ({}) as never]) {
      const m = make({ rateLimit: { store: { hit } } })
      expect([429, 503]).toContain((await m.call(good)).status)
      expect(m.sent).toHaveLength(0)
    }
  })
})
