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
  rateLimit?: (kind: RateKind, key: string, req: PayloadRequest) => boolean | Promise<boolean>
  /** The visitor's address for the address limit. Default: `x-real-ip`, else the last `x-forwarded-for` entry. */
  clientAddress?: (req: PayloadRequest) => string | null
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
  rateLimit: NonNullable<ContactPluginOptions['rateLimit']>
  clientAddress: NonNullable<ContactPluginOptions['clientAddress']>
  maxMessage: number
  verifyHuman?: VerifyHuman
  humanTokenField: string
}

export type ErrorCode = 'busy' | 'invalid' | 'unknownTopic' | 'human' | 'error' | 'unavailable'
