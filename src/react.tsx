'use client'
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'

import { searchTopics } from './topics.js'
import type { PublicTopic } from './types.js'

export type ContactTilesProps = {
  topics: PublicTopic[]
  tiles: { topic: string; label?: string; hint?: string }[]
  /** The endpoint, such as `/api/contact`. */
  action: string
  honeypotField?: string
  maxMessage?: number
  /** Your human check's widget (Turnstile or similar), shown above the send button. Its token goes in the form. */
  humanCheck?: ReactNode
  /** A topic chosen before the page loaded (from `?topic=`). Also what the no-JS tile links produce. */
  initialTopic?: string
  /** From `?sent=1` or `?error=<code>` after a form posted without JavaScript. */
  status?: 'sent' | string
  /** Where the tile links point without JavaScript. Default: the current page. */
  pageHref?: string
  /** Wording, for translation or a different voice. */
  text?: Partial<typeof defaultText>
}

const defaultText = {
  search: 'What are you contacting us about?',
  searchHint: 'Type a few words, such as refund or sponsor, or pick a tile.',
  topicSelect: 'Topic',
  name: 'Your name',
  email: 'Your email',
  message: 'Your message',
  send: 'Send message',
  sending: 'Sending…',
  sent: 'Thanks. Your message is on its way, and we will reply by email.',
  chooseTopic: 'Please choose what you are contacting us about.',
  failed: 'Something went wrong. Please try again later.',
  busy: 'Too many tries. Please try again in an hour.',
  human: 'Please confirm you are a person, then try again.',
  invalid: 'Please check your name, email and message and try again.',
  noMatch: 'No matching topics. Choose “Something else” or pick a tile.',
  honeypot: 'Leave this empty',
  tiles: 'Common reasons',
  selected: 'Selected topic',
  clear: 'Change topic',
  suggestions: (n: number) => (n === 1 ? '1 suggestion available. Use the up and down arrow keys, then Enter.' : `${n} suggestions available. Use the up and down arrow keys, then Enter.`),
}

/** Plain CSS with variables, so a site can retheme without overriding rules. Contrast defaults meet WCAG AA. */
export const contactTilesCss = `
.ct{--ct-fg:#1a1a1a;--ct-bg:#fff;--ct-muted:#4a4a4a;--ct-line:#6b6b6b;--ct-accent:#0b57d0;--ct-accent-fg:#fff;--ct-tile:#f4f4f2;--ct-err:#b00020;font:inherit;color:var(--ct-fg);max-width:46rem;margin:0 auto}
.ct *{box-sizing:border-box}
.ct label,.ct legend{display:block;font-weight:600;margin:1.25rem 0 .4rem}
.ct input,.ct select,.ct textarea{width:100%;font:inherit;font-size:1rem;padding:.8rem .9rem;border:2px solid var(--ct-line);border-radius:.5rem;background:var(--ct-bg);color:var(--ct-fg);min-height:3rem}
.ct textarea{min-height:9rem}
.ct :focus-visible{outline:3px solid var(--ct-accent);outline-offset:2px}
.ct-hint{color:var(--ct-muted);margin:.25rem 0 0;font-size:.95rem}
.ct-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(13rem,1fr));gap:.75rem;margin:.5rem 0 0;padding:0;list-style:none}
.ct-tile{display:flex;flex-direction:column;justify-content:center;gap:.2rem;min-height:5.5rem;width:100%;padding:1rem;border:2px solid var(--ct-line);border-radius:.75rem;background:var(--ct-tile);color:var(--ct-fg);text-decoration:none;font:inherit;text-align:left;cursor:pointer}
.ct-tile strong{font-size:1.05rem}
.ct-tile small{color:var(--ct-muted);font-size:.9rem}
.ct-tile:hover{border-color:var(--ct-accent)}
.ct-tile[aria-pressed=true]{border-color:var(--ct-accent);box-shadow:inset 0 0 0 2px var(--ct-accent)}
.ct-combo{position:relative}
.ct-list{position:absolute;z-index:5;left:0;right:0;margin:.25rem 0 0;padding:.25rem;list-style:none;background:var(--ct-bg);border:2px solid var(--ct-line);border-radius:.5rem;max-height:18rem;overflow:auto}
.ct-opt{padding:.7rem .8rem;border-radius:.4rem;cursor:pointer}
.ct-opt small{display:block;color:var(--ct-muted)}
.ct-opt[aria-selected=true]{background:var(--ct-accent);color:var(--ct-accent-fg)}
.ct-opt[aria-selected=true] small{color:var(--ct-accent-fg)}
.ct-btn{margin-top:1.5rem;min-height:3.25rem;padding:.8rem 1.6rem;border:0;border-radius:.5rem;background:var(--ct-accent);color:var(--ct-accent-fg);font:inherit;font-weight:600;cursor:pointer}
.ct-btn[disabled]{opacity:.6;cursor:progress}
.ct-msg{margin:1rem 0;padding:.9rem 1rem;border-left:5px solid var(--ct-accent);background:var(--ct-tile)}
.ct-msg[data-kind=error]{border-color:var(--ct-err)}
.ct-trap{position:absolute!important;left:-10000px;width:1px;height:1px;overflow:hidden}
@media (max-width:30rem){.ct-tiles{grid-template-columns:1fr}}
@media (prefers-reduced-motion:no-preference){.ct-tile{transition:border-color .15s}}
`

/**
 * The contact page: tiles, a search box that completes topics (ARIA 1.2 combobox with a listbox popup), and one
 * form. Before the script runs (or without it) the topic is a plain select, the tiles are links that reload the
 * page with `?topic=`, and the form posts to the endpoint, which redirects back with `?sent=1` or `?error=`.
 */
export function ContactTiles(props: ContactTilesProps) {
  const t = { ...defaultText, ...props.text }
  const { topics, tiles, action, honeypotField = 'website', maxMessage = 5000, pageHref = '' } = props
  const uid = useId()
  const [enhanced, setEnhanced] = useState(false)
  useEffect(() => setEnhanced(true), [])
  const [topic, setTopic] = useState(topics.some((x) => x.id === props.initialTopic) ? props.initialTopic! : '')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [result, setResult] = useState<{ kind: 'sent' | 'error'; text: string } | null>(() => {
    const s = props.status
    if (!s) return null
    return s === 'sent' || s === '1' ? { kind: 'sent', text: t.sent } : { kind: 'error', text: s === 'busy' ? t.busy : s === 'human' ? t.human : s === 'invalid' || s === 'unknownTopic' ? t.invalid : t.failed }
  })
  const [sending, setSending] = useState(false)
  const [topicError, setTopicError] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const matches = useMemo(() => searchTopics(topics, query), [topics, query])
  const chosen = topics.find((x) => x.id === topic)
  const listId = `${uid}-list`
  const optId = (i: number) => `${uid}-opt-${i}`
  const announce = !open ? '' : matches.length ? t.suggestions(matches.length) : t.noMatch

  const choose = (id: string) => {
    setTopic(id)
    setQuery('')
    setOpen(false)
    setTopicError(false)
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const last = matches.length - 1
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) setOpen(true)
      else setActive((a) => (a >= last ? 0 : a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) setOpen(true)
      setActive((a) => (a <= 0 ? last : a - 1))
    } else if (e.key === 'Home' && open) {
      e.preventDefault()
      setActive(0)
    } else if (e.key === 'End' && open) {
      e.preventDefault()
      setActive(last)
    } else if (e.key === 'Enter' && open && matches[active]) {
      e.preventDefault()
      choose(matches[active]!.id)
    } else if (e.key === 'Escape' && open) {
      e.preventDefault()
      setOpen(false)
    }
  }

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    if (!enhanced) return
    e.preventDefault()
    if (!topic) {
      setTopicError(true)
      input.current?.focus()
      return
    }
    setSending(true)
    setResult(null)
    const form = e.currentTarget
    const data = Object.fromEntries(new FormData(form).entries())
    try {
      const res = await fetch(action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, topic }) })
      if (res.ok) {
        setResult({ kind: 'sent', text: t.sent })
        form.reset()
        setTopic('')
      } else {
        const code = ((await res.json().catch(() => null)) as { error?: { code?: string } } | null)?.error?.code
        setResult({ kind: 'error', text: code === 'busy' ? t.busy : code === 'human' ? t.human : code === 'invalid' || code === 'unknownTopic' ? t.invalid : t.failed })
      }
    } catch {
      setResult({ kind: 'error', text: t.failed })
    }
    setSending(false)
  }

  return (
    <div className="ct">
      <style>{contactTilesCss}</style>
      <section aria-labelledby={`${uid}-tiles`}>
        <h2 id={`${uid}-tiles`} style={{ fontSize: '1.15rem', margin: '0 0 .25rem' }}>
          {t.tiles}
        </h2>
        <ul className="ct-tiles">
          {tiles.map((tile) => {
            const body = (
              <>
                <strong>{tile.label ?? topics.find((x) => x.id === tile.topic)?.label}</strong>
                {tile.hint ? <small>{tile.hint}</small> : null}
              </>
            )
            return (
              <li key={tile.topic}>
                {enhanced ? (
                  <button type="button" className="ct-tile" aria-pressed={topic === tile.topic} onClick={() => choose(tile.topic)}>
                    {body}
                  </button>
                ) : (
                  <a className="ct-tile" href={`${pageHref}?topic=${encodeURIComponent(tile.topic)}#${uid}-form`}>
                    {body}
                  </a>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <form id={`${uid}-form`} method="post" action={action} onSubmit={submit} noValidate={enhanced}>
        {result ? (
          <p className="ct-msg" data-kind={result.kind} role={result.kind === 'error' ? 'alert' : 'status'}>
            {result.text}
          </p>
        ) : (
          <p role="status" className="ct-trap" />
        )}

        {enhanced ? (
          <div>
            <label htmlFor={`${uid}-input`}>{t.search}</label>
            {chosen ? (
              <p className="ct-msg" id={`${uid}-chosen`}>
                {t.selected}: <strong>{chosen.label}</strong>{' '}
                <button type="button" className="ct-btn" style={{ margin: '0 0 0 .5rem', minHeight: '2.5rem', padding: '.4rem 1rem' }} onClick={() => { setTopic(''); setTimeout(() => input.current?.focus()) }}>
                  {t.clear}
                </button>
              </p>
            ) : null}
            <div className="ct-combo" hidden={!!chosen}>
              <input
                ref={input}
                id={`${uid}-input`}
                type="text"
                role="combobox"
                autoComplete="off"
                aria-autocomplete="list"
                aria-expanded={open}
                aria-controls={listId}
                aria-activedescendant={open && matches[active] ? optId(active) : undefined}
                aria-describedby={`${uid}-hint`}
                aria-invalid={topicError || undefined}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setActive(0)
                  setOpen(true)
                }}
                onKeyDown={onKey}
                onFocus={() => setOpen(true)}
                onBlur={() => setOpen(false)}
              />
              <ul id={listId} role="listbox" aria-label={t.search} className="ct-list" hidden={!open || matches.length === 0}>
                {matches.map((m, i) => (
                  <li
                    key={m.id}
                    id={optId(i)}
                    role="option"
                    className="ct-opt"
                    aria-selected={i === active}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      choose(m.id)
                    }}
                    onMouseMove={() => setActive(i)}
                  >
                    {m.label}
                    {m.hint ? <small>{m.hint}</small> : null}
                  </li>
                ))}
              </ul>
            </div>
            <p className="ct-hint" id={`${uid}-hint`}>
              {t.searchHint}
            </p>
            {topicError ? (
              <p className="ct-hint" role="alert" style={{ color: 'var(--ct-err)' }}>
                {t.chooseTopic}
              </p>
            ) : null}
            <div role="status" className="ct-trap">
              {announce}
            </div>
          </div>
        ) : (
          <div>
            <label htmlFor={`${uid}-select`}>{t.topicSelect}</label>
            <select id={`${uid}-select`} name="topic" required defaultValue={topic}>
              <option value="" disabled>
                {t.search}
              </option>
              {topics.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <label htmlFor={`${uid}-name`}>{t.name}</label>
        <input id={`${uid}-name`} name="name" type="text" autoComplete="name" required maxLength={100} />
        <label htmlFor={`${uid}-email`}>{t.email}</label>
        <input id={`${uid}-email`} name="email" type="email" autoComplete="email" required maxLength={254} />
        <label htmlFor={`${uid}-message`}>{t.message}</label>
        <textarea id={`${uid}-message`} name="message" required minLength={5} maxLength={maxMessage} />
        <div className="ct-trap" aria-hidden="true">
          <label htmlFor={`${uid}-hp`}>{t.honeypot}</label>
          <input id={`${uid}-hp`} name={honeypotField} type="text" tabIndex={-1} autoComplete="off" />
        </div>
        {props.humanCheck}
        <button className="ct-btn" type="submit" disabled={sending}>
          {sending ? t.sending : t.send}
        </button>
      </form>
    </div>
  )
}
