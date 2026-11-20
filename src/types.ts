import type { PayloadRequest } from 'payload'

/** One thing a visitor may be contacting the site about. */
export type Topic = {
  /** Stable id, such as `orders`. The browser sends this and nothing else to choose a route. */
  id: string
  /** What the visitor sees: "Order question". */
  label: string
  /** Other words people use for it, matched by the search box: "refund", "shipping". */
  synonyms?: string[]
  /** A line shown under the label in the list and on a tile. */
  hint?: string
  /** The group address this topic goes to. Server only: never sent to the browser. */
  to: string
}

/** A large quick tile. It points at a topic. */
export type Tile = {
  topic: string
  /** Overrides the topic's label on the tile. */
  label?: string
  hint?: string
}

/** What the browser is allowed to know about a topic: no address. */
export type PublicTopic = Pick<Topic, 'id' | 'label' | 'synonyms' | 'hint'>

export type RateKind = 'address' | 'email'

export type VerifyHuman = (args: { token: string | undefined; address: string | null; req: PayloadRequest }) => boolean | Promise<boolean>

/** A shared counter, such as Redis or a database table. `hit` adds one for `key` in the window and returns the new count. */
export type RateStore = { hit: (key: string, windowMs: number) => { count: number } | Promise<{ count: number }> }

export type TrustProxy = false | 'x-forwarded-for' | 'x-real-ip'

export type ContactPluginOptions = {
  topics: Topic[]
  /** Quick tiles, in order. Default: the first six topics. */
  tiles?: Tile[]
  /** Subject is `<prefix> <topic label>`. Default `[Contact]`. */
  subjectPrefix?: string
  /** Endpoint base path under Payload's API route. Default `/contact`. */
  path?: string
  /**
   * Where a form posted without JavaScript is sent afterwards (a path on the site, such as `/contact`), with
   * `?sent=1` or `?error=<code>` added. Default `/contact`.
   */
  redirectTo?: string
  /** Name of the hidden honeypot field. Default `website`. */
  honeypotField?: string
  /** Attempts allowed per window. Defaults: 5 per address and 3 per email, per hour. */
  limits?: Partial<Record<RateKind, number>>
  /** Window for the built-in limiter, in minutes. Default 60. */
  windowMinutes?: number
  /**
   * Your own limiter, for several servers or serverless hosting (the built-in one counts in memory, per process).
   * Return exactly `true` to allow. Anything else, or a throw, refuses.
   */
  rateLimit?: ((kind: RateKind, key: string, req: PayloadRequest) => boolean | Promise<boolean>) | { store: RateStore }
  /**
   * Which header carries the visitor's address, only when your host puts the app behind a proxy that sets it:
   * `'x-forwarded-for'` (the last entry counts) or `'x-real-ip'`. Default `false`: no header is trusted, so a
   * visitor can't pick their own address, and every request shares one count unless you pass `clientAddress`.
   */
  trustProxy?: TrustProxy
  /** The visitor's address for the address limit. Overrides `trustProxy`. Default: from `trustProxy`, else none. */
  clientAddress?: (req: PayloadRequest) => string | null
  /** Most the human check may take, in milliseconds. Default 10000. A check that runs out refuses. */
  verifyTimeoutMs?: number
  /** Most the built-in limiter keeps, in keys. Default 50000. When full, new keys are refused. */
  maxKeys?: number
  /**
   * A human check, such as Turnstile. Off unless set. Runs before routing or sending. Only an answer of exactly
   * `true` passes; false, a throw or anything else refuses, and the refusal never says why.
   */
  verifyHuman?: VerifyHuman
  /** Form field carrying the check's token. Default `humanToken`. Turnstile's own is `cf-turnstile-response`. */
  humanTokenField?: string
  /** Largest message, in characters. Default 5000. */
  maxMessage?: number
}

export type ResolvedContact = {
  topics: Map<string, Topic>
  tiles: Tile[]
  subjectPrefix: string
  path: string
  redirectTo: string
  honeypotField: string
  limits: Record<RateKind, number>
  windowMs: number
  rateLimit: (kind: RateKind, key: string, req: PayloadRequest) => boolean | Promise<boolean>
  clientAddress: NonNullable<ContactPluginOptions['clientAddress']>
  maxMessage: number
  verifyHuman?: VerifyHuman
  humanTokenField: string
  verifyTimeoutMs: number
}

export type ErrorCode = 'busy' | 'invalid' | 'unknownTopic' | 'human' | 'error' | 'unavailable'
