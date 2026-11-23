# Test audit

Kept by this repo's owning session, per `~/Code/CLAUDE.md`, "Test self-audits". Newest first.

## 2026-11-22: search, focus and the review findings

- Promises: topic search ignores filler words, ranks full matches first and always lists the fallback last; by default no proxy header is trusted, so a spoofed address buys no new count; the built-in limiter has a key cap and refuses when full; large or multipart bodies are refused before reading and streamed ones are cut off; a human check that never answers, or an over-long token, refuses; a custom rate store that throws or answers junk refuses the send; focus moves to the sent message or the error, and errors carry a hidden icon and a bold lead word; no-JS redirects land on the result.
- Covered: `test/contact.test.ts` (search, proxy, limiter, body cap, human check, store) and `test/react.dom.test.tsx` (focus, markers, headings, the anchor).
- Gaps skipped (and why): none.

## 2026-11-17: the optional human check

Suite: 74 tests before, 90 after.

- **Tests added.** Off by default and unchanged; `true` sends and the token, address and request reach the hook; a missing or non-string token is `undefined`; the configured token field; false, a throw, a rejection, undefined, a string, 1 and an object each refuse with 400 `human`, send nothing and reveal no detail; it runs before topic routing; the no-JS post forwards the token and redirects with `error=human`; a failing check still uses up the address count; the component's slot and the human-check message.
- **Mutation checks.** Strict `=== true` loosened, and the refusal removed: both fail the suite.
- **Skipped.** A real Turnstile or other verifier (the hook is a function the site supplies).

## 2026-11-17: first real audit (routing, guards, component)

Suite: 74 tests (`npx vitest run`): 58 server, 16 component (jsdom).

- **Promises.** Routes by topic id only; unknown topics refused; reply-to is the sender; no address reaches the browser; nothing stored; honeypot; rate limits per address and email that fail closed; line breaks refused; combobox with keyboard and announcements; no-JS fallback.
- **Covered.** Each of those, including: ids like `__proto__`, an address in the topic field and in extra `to`, `cc`, `bcc` fields; five kinds of line break in name and email; a limiter that throws, answers false, undefined, `'yes'` or `1`; empty address; faked `x-forwarded-for`; the honeypot still using up the address count; public config and errors scanned for `@`; start-up refusals; the server-rendered markup; arrow keys, Home, End, Enter, Escape, `aria-*` attributes, live announcements, a missing topic, server refusals and a network failure.
- **Mutation checks.** 8 guards each removed in turn (line-break check, honeypot, strict `true`, shared unknown address, client-supplied `to`, name cleaning, email limit, limiter error): all 8 fail the suite.
- **Gaps skipped.** A real screen reader, a phone browser and measured contrast (not possible here; stated in the README). A real email adapter (the test stub records the message instead). Several processes sharing a limiter (the built-in one says it doesn't). CSS rules (no layout engine in jsdom). The email format check beyond the cases listed, since it is only a sanity check.
- **Known weak spot.** The component's focus handling after choosing a topic is only checked for the missing-topic case.

## 2026-11-16: first audit (starter kit)

- Promises: none yet.
- Covered: none yet.
- Gaps added: none.
- Gaps skipped (and why): none.
