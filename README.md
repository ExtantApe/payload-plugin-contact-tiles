# payload-plugin-contact-tiles

Contact tiles for Payload: a routed contact page with a search box that autocompletes topics and synonyms, quick tiles, and one short form. The server emails the topic's group address, with the sender as reply-to, and never sends an address to the browser.

**Status:** 0.2.0 (0.1.0 is on npm). 124 tests pass: the server flow with a stubbed email adapter and made-up addresses (routing, refusals, rate limits that fail closed, header injection, the honeypot, the optional human check hook) and the React component in jsdom (combobox keys and ARIA attributes, tiles, the form, and the server-rendered no-JS markup). Nothing has run on a real site, no real email has been sent, and the component hasn't been checked with a real screen reader, in a phone browser, or with a contrast tool. The CSS colors are chosen to meet WCAG AA but that hasn't been measured.

## What it does

- **One search box.** "What are you contacting us about?" completes from your topics. Each topic has synonyms, so "refund" finds Order question. Case, accents, spaces and punctuation do not matter, so "presspodcast" and "press-podcast" find Press podcast, and a single token of 2 or more letters matches the first letters of words, so "tp" finds Tabletop Playground (add "TTPG" as a synonym to find it by that). A word matches inside another word only within that word, never across two. An exact match comes first, then a topic that starts with what you typed. Filler words ("where is my kit", "I want to be featured") are ignored, topics that match more of the meaningful words come first, and the topic with id `other` (change it with `fallbackTopic`) is always last, so a search never ends with nothing to pick. The box takes 200 characters, and search counts at most 12 distinct words, so a pasted block cannot slow the page. Arrow keys, Home, End, Enter and Escape work, and a screen reader hears how many suggestions there are.
- **Quick tiles.** Large buttons for the common reasons. You choose which, and in what order.
- **One short form.** Name, email, message, topic. The server checks it and emails the topic's group address. The reply-to is the sender, so replying goes to them.
- **Routes live on the server.** The browser sends a topic id and nothing else decides where mail goes. An unknown id is refused. Group addresses are never in the page, the topics endpoint, or an error message.
- **Nothing stored.** No collection, no copy of the message. The email is the only record, in the group's inbox. Your server logs may still show an email adapter's error, which can include the visitor's address.

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

Rendered on the server, the topic is a plain select, the tiles are links that reload the page with `?topic=`, and the form posts to the endpoint. The endpoint answers a form post with a redirect to `redirectTo` (default `/contact`) plus `?sent=1` or `?error=<code>`. The redirect ends with `#contact-result`, the id of the message, so a phone lands on it instead of showing the tiles. With JavaScript, focus moves to the message after a send. Once the script runs, the select becomes the search box and the tiles become buttons.

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
| `rateLimit` | built in, in memory | Your own limiter (`(kind, key, req) => boolean`, only `true` allows), or `{ store }` with `hit(key, windowMs) => { count }` backed by Redis or your database. A store that throws refuses the send. |
| `trustProxy` | `false` | `'x-forwarded-for'` (last entry counts) or `'x-real-ip'`, only if your host puts the app behind a proxy that sets that header. With `false` no header is trusted. |
| `clientAddress` | from `trustProxy` | Your own function for which address counts. Overrides `trustProxy`. |
| `verifyTimeoutMs` | 10000 | The human check refuses if it takes longer. Tokens over 2048 characters refuse. |
| `maxKeys` | 50000 | Most keys the built-in limiter keeps. When full and nothing has expired, new keys are refused. |
| `verifyHuman` | off | A human check such as Turnstile: `({ token, address, req }) => boolean`. Runs before routing and sending. Only `true` passes. |
| `humanTokenField` | `humanToken` | Form field that carries the check's token. |
| `maxMessage` | 5000 | Characters. |

## Guards

- **Fail closed.** A limiter that throws, or answers anything but `true`, refuses the request. Bad options stop Payload at start-up.
- **Rate limits** count per address and per email. Every request counts against its address, bots included, before the body is read. The built-in limiter counts in memory, **per server process**, so on several servers or serverless hosting each instance counts on its own; pass `rateLimit: { store }` backed by something shared. It keeps only hashed keys and at most `maxKeys` of them. By default no header is trusted for the address, so a visitor can't pick their own, and all visitors share one count. Set `trustProxy` to the header your proxy sets, or pass `clientAddress`. A request with no address shares the same one count, which fails closed.
- **Body size.** Bodies over 64 KB are refused, and multipart uploads too.
- **Honeypot.** A filled hidden field gets the normal success answer and no email.
- **Header injection.** Line breaks, carriage returns, and the Unicode line separators in the name or email are refused. Quotes and angle brackets are dropped from the name before it goes into a header. The message is body text only.
- **Human check (optional).** Set `verifyHuman` to verify a Turnstile or similar token on the server. A false, a throw or any answer other than exactly `true` refuses with a plain message that gives no reason. Show the widget with the component's `humanCheck` prop; its token field goes in the post, and the no-JS form post forwards it too. Without the hook nothing changes.
- **Limits of the checks.** The email check only catches obvious typos and can't tell whether an address exists. Nothing here stops a determined person with many addresses; for a busy public site set `verifyHuman`.

## Commands

```sh
npm test            # server tests and component tests
npm run typecheck
npm run build
npm run leak-check
```

## License

MIT, copyright EXTANT APE. See [LICENSE](LICENSE).

## Wording

Pass `text` to `ContactTiles` to change any wording. Two are optional and empty by default:

| Key | What it does |
| --- | --- |
| `formHeading` | A heading (h2) above the form, such as `Write to us`. |
| `emailHint` | A line under the email field, such as `We reply to this address.` It is linked to the field for screen readers. |

Messages start with a bold lead word and an icon (`errorLead`, default `Problem:`, and `sentLead`, default `Sent:`), so they don't depend on color alone.
