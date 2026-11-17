# payload-plugin-contact-tiles

Contact tiles for Payload: a routed contact page with a search box that autocompletes topics and synonyms, quick tiles, and one short form. The server emails the topic's group address, with the sender as reply-to, and never sends an address to the browser.

**Status:** 0.1.0, not on npm. 74 tests pass: the server flow with a stubbed email adapter and made-up addresses (routing, refusals, rate limits that fail closed, header injection, the honeypot) and the React component in jsdom (combobox keys and ARIA attributes, tiles, the form, and the server-rendered no-JS markup). Nothing has run on a real site, no real email has been sent, and the component hasn't been checked with a real screen reader, in a phone browser, or with a contrast tool. The CSS colors are chosen to meet WCAG AA but that hasn't been measured.

## What it does

- **One search box.** "What are you contacting us about?" completes from your topics. Each topic has synonyms, so "refund" finds Order question. Arrow keys, Home, End, Enter and Escape work, and a screen reader hears how many suggestions there are.
- **Quick tiles.** Large buttons for the common reasons. You choose which, and in what order.
- **One short form.** Name, email, message, topic. The server checks it and emails the topic's group address. The reply-to is the sender, so replying goes to them.
- **Routes live on the server.** The browser sends a topic id and nothing else decides where mail goes. An unknown id is refused. Group addresses are never in the page, the topics endpoint, or an error message.
- **Nothing stored.** No collection, no copy of the message. The email is the only record, in the group's inbox.

## Install

```sh
npm install @extantape/payload-plugin-contact-tiles
```

Not published yet, so for now install from a local checkout. It needs Payload 3 (`^3.80`), Node 22 or later, and a configured email adapter. React 18 or 19 is only needed for the component.

```ts
import { contactTilesPlugin } from '@extantape/payload-plugin-contact-tiles'

export default buildConfig({
  plugins: [
    contactTilesPlugin({
      topics: [
        { id: 'orders', label: 'Order question', synonyms: ['refund', 'shipping'], hint: 'Where is my kit?', to: 'orders@example.com' },
        { id: 'sponsors', label: 'Sponsor us', synonyms: ['donate'], to: 'sponsors@example.com' },
        { id: 'other', label: 'Something else', to: 'help@example.com' },
      ],
      tiles: [{ topic: 'orders' }, { topic: 'sponsors' }, { topic: 'other' }],
    }),
  ],
})
```

The page, as a client component fed by a server component:

```tsx
// app/contact/page.tsx (server)
import { publicConfig, resolveOptions } from '@extantape/payload-plugin-contact-tiles'
import { ContactTiles } from '@extantape/payload-plugin-contact-tiles/react'

const options = resolveOptions(contactOptions) // the same object you gave the plugin
export default async function Page({ searchParams }) {
  const { topic, sent, error } = await searchParams
  const c = publicConfig(options)
  return <ContactTiles topics={c.topics} tiles={c.tiles} action={`/api${c.path}`} honeypotField={c.honeypotField} initialTopic={topic} status={sent ? 'sent' : error} pageHref="/contact" />
}
```

`publicConfig` leaves the addresses out. `GET /api/contact/topics` gives the same data if you would rather fetch it.

## Without JavaScript

Rendered on the server, the topic is a plain select, the tiles are links that reload the page with `?topic=`, and the form posts to the endpoint. The endpoint answers a form post with a redirect to `redirectTo` (default `/contact`) plus `?sent=1` or `?error=<code>`. Once the script runs, the select becomes the search box and the tiles become buttons.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `topics` | required | `id`, `label`, `to`, and optional `synonyms` and `hint`. Ids are lowercase letters, digits and hyphens. `to` is one plain address. |
| `tiles` | first six topics | `{ topic, label?, hint? }`, in order. |
| `subjectPrefix` | `[Contact]` | Subject is `[Contact] Order question: Name`. |
| `path` | `/contact` | Endpoint under Payload's API route. |
| `redirectTo` | `/contact` | Where a no-JS post goes back to. Must be a path on your site. |
| `honeypotField` | `website` | Hidden field a person never fills. |
| `limits` | 5 per address, 3 per email | Attempts per window. |
| `windowMinutes` | 60 | The window. |
| `rateLimit` | built in | Your own limiter. Only `true` allows. |
| `clientAddress` | `x-real-ip`, else last `x-forwarded-for` | Which address counts. |
| `maxMessage` | 5000 | Characters. |

## Guards

- **Fail closed.** A limiter that throws, or answers anything but `true`, refuses the request. Bad options stop Payload at start-up.
- **Rate limits** count per address and per email. Every request counts against its address, bots included. The built-in limiter counts in memory, per server process, and keeps only hashed keys. On several servers or serverless hosting, pass `rateLimit` backed by something shared, or each process counts alone. Which address counts is only right behind one trusted proxy that sets `x-real-ip` or appends to `x-forwarded-for`. Otherwise pass `clientAddress`.
- **Honeypot.** A filled hidden field gets the normal success answer and no email.
- **Header injection.** Line breaks, carriage returns, and the Unicode line separators in the name or email are refused. Quotes and angle brackets are dropped from the name before it goes into a header. The message is body text only.
- **Limits of the checks.** The email check only catches obvious typos and can't tell whether an address exists. Nothing here stops a determined person with many addresses; for a busy public site add a human check in front.

## Commands

```sh
npm test            # server tests and component tests
npm run typecheck
npm run build
npm run leak-check
```

## License

MIT, copyright EXTANT APE. See [LICENSE](LICENSE).
