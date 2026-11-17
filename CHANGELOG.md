# Changelog

## Unreleased

- First version, 0.1.0. A Payload plugin that adds `POST <path>` (default `/contact`) and `GET <path>/topics`, and a React component at `/react`. Topics, synonyms, routes and tiles come from options. The server routes by topic id only, refuses unknown topics, sends through Payload's email adapter with the sender as reply-to, and stores nothing. Honeypot, per-address and per-email rate limits that fail closed, and refusal of line breaks in the name and email. The component is an ARIA 1.2 combobox with a no-JS fallback (select, tile links, redirecting form post).

Tested: 74 tests (58 server, 16 component). Server: routing, unknown topics, client-supplied addresses ignored, validation, header injection, honeypot, limits and fail-closed limiter, no-JS redirects, nothing public carries an address, option errors, search. Component: server-rendered no-JS markup, combobox roles and keys, announcements, tiles, the form, refusals. Eight guards were mutation-checked and each fails a test when removed. Not tested: a real site, a real email adapter or mail delivery, a real screen reader, a phone browser, contrast measured with a tool, several server processes.
