import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent, type UserEvent } from '@testing-library/user-event'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ContactTiles } from '../src/react.js'
import { toPublic } from '../src/index.js'
import { topics } from './helpers.js'

const pub = topics.map(toPublic)
const tiles = [{ topic: 'orders', hint: 'Where is my kit?' }, { topic: 'press' }, { topic: 'other', label: 'Something else' }]
const props = { topics: pub, tiles, action: '/api/contact' }

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('without JavaScript (server render)', () => {
  const html = renderToString(<ContactTiles {...props} pageHref="/contact" />)
  it('has a plain select with every topic and a form that posts to the endpoint', () => {
    const form = html.match(/<form[^>]*>/)![0]
    expect(form).toContain('method="post"')
    expect(form).toContain('action="/api/contact"')
    expect(html).toMatch(/<select[^>]*name="topic"/)
    for (const t of pub) expect(html).toContain(t.label)
  })
  it('renders tiles as links that reload with ?topic=', () => {
    expect(html).toContain('href="/contact?topic=orders#')
    expect(html).not.toMatch(/<button[^>]*class="ct-tile"/)
  })
  it('has no combobox yet, and never an address', () => {
    expect(html).not.toContain('role="combobox"')
    expect(html).not.toContain('@example.com')
  })
  it('names the honeypot and hides it from assistive tech and the tab order', () => {
    expect(html).toMatch(/aria-hidden="true"/)
    expect(html).toMatch(/name="website"[^>]*tabindex="-1"|tabindex="-1"[^>]*name="website"/)
  })
  it('shows a result after a no-JS redirect', () => {
    expect(renderToString(<ContactTiles {...props} status="sent" />)).toContain('Thanks.')
    expect(renderToString(<ContactTiles {...props} status="busy" />)).toContain('Too many tries')
  })
  it('preselects the topic from ?topic=', () => {
    expect(renderToString(<ContactTiles {...props} initialTopic="press" />)).toMatch(/<option value="press" selected/)
  })
})

describe('combobox', () => {
  const setup = async () => {
    const user = userEvent.setup()
    render(<ContactTiles {...props} />)
    const box = await screen.findByRole('combobox', { name: 'What are you contacting us about?' })
    return { user, box }
  }

  it('follows the ARIA 1.2 pattern', async () => {
    const { user, box } = await setup()
    expect(box).toHaveAttribute('aria-autocomplete', 'list')
    expect(box).toHaveAttribute('aria-expanded', 'false')
    await user.type(box, 'ref')
    expect(box).toHaveAttribute('aria-expanded', 'true')
    const list = screen.getByRole('listbox')
    expect(box.getAttribute('aria-controls')).toBe(list.id)
    const options = within(list).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['Order questionWhere is my kit?'])
    expect(box.getAttribute('aria-activedescendant')).toBe(options[0]!.id)
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('matches synonyms and moves with the arrow keys, wrapping', async () => {
    const { user, box } = await setup()
    await user.click(box)
    const opts = () => screen.getAllByRole('option')
    expect(opts()).toHaveLength(4)
    expect(opts()[0]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowDown}')
    expect(opts()[1]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(opts()[3]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Home}')
    expect(opts()[0]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{End}')
    expect(opts()[3]).toHaveAttribute('aria-selected', 'true')
  })

  it('Escape closes, Enter chooses, and focus stays usable', async () => {
    const { user, box } = await setup()
    await user.type(box, 'jour')
    await user.keyboard('{Escape}')
    expect(box).toHaveAttribute('aria-expanded', 'false')
    await user.keyboard('{ArrowDown}')
    expect(box).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{Enter}')
    expect(screen.getByText('Selected topic:', { exact: false }).textContent).toContain('Press or podcast')
  })

  it('announces how many suggestions there are, and when there are none', async () => {
    const { user, box } = await setup()
    await user.type(box, 'zzz')
    expect(screen.getAllByRole('status').some((s) => s.textContent?.includes('No matching topics'))).toBe(true)
    await user.clear(box)
    await user.type(box, 'ord')
    expect(screen.getAllByRole('status').some((s) => s.textContent?.includes('1 suggestion available'))).toBe(true)
  })

  it('a click on an option chooses it', async () => {
    const { user, box } = await setup()
    await user.type(box, 'sponsor')
    await user.click(screen.getByRole('option', { name: /Sponsor us/ }))
    expect(screen.getByText('Selected topic:', { exact: false }).textContent).toContain('Sponsor us')
  })
})

describe('tiles and form', () => {
  const fill = async (user: UserEvent) => {
    await user.type(screen.getByLabelText('Your name'), 'Made Up')
    await user.type(screen.getByLabelText('Your email'), 'made.up@example.org')
    await user.type(screen.getByLabelText('Your message'), 'Where is my order?')
  }
  it('tiles are buttons with a pressed state, and choose the topic', async () => {
    const user = userEvent.setup()
    render(<ContactTiles {...props} />)
    const tile = await screen.findByRole('button', { name: /Order question/ })
    expect(tile).toHaveAttribute('aria-pressed', 'false')
    await user.click(tile)
    expect(screen.getByRole('button', { name: /Order question/ })).toHaveAttribute('aria-pressed', 'true')
  })
  it('refuses to send without a topic, tells the user, and focuses the search box', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<ContactTiles {...props} />)
    await screen.findByRole('combobox')
    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Send message' }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('Please choose')
    expect(screen.getByRole('combobox')).toHaveFocus()
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-invalid', 'true')
  })
  it('posts the topic id as JSON, with no address, and says thanks', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ContactTiles {...props} />)
    await user.click(await screen.findByRole('button', { name: /Order question/ }))
    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/contact')
    expect(JSON.parse(init.body as string)).toMatchObject({ topic: 'orders', name: 'Made Up', email: 'made.up@example.org', website: '' })
    expect(await screen.findByText(/Thanks\./)).toBeInTheDocument()
  })
  it('shows the server’s refusal as an alert', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"code":"busy"}}', { status: 429 })))
    render(<ContactTiles {...props} />)
    await user.click(await screen.findByRole('button', { name: /Order question/ }))
    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Send message' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Too many tries')
  })
  it('shows a network failure as an alert', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    render(<ContactTiles {...props} />)
    await user.click(await screen.findByRole('button', { name: /Order question/ }))
    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Send message' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Something went wrong')
  })
})
