/**
 * Tenant-namespaced Redis key factory.
 *
 * Set REDIS_NS in your environment to prefix all quote-related keys with
 * "{namespace}:" — this isolates data per tenant when multiple instances
 * share a single Redis database.  Unset = no prefix (backwards-compatible).
 *
 * Usage:
 *   import { k } from './_lib/keys.js'
 *   redis.get(k.quote(quoteId))
 *   redis.lrange(k.quotesDriver(email), 0, -1)
 */

const PREFIX = process.env.REDIS_NS ? `${process.env.REDIS_NS}:` : ''

export const k = {
  quote:         id    => `${PREFIX}quote:${id}`,
  quotesDriver:  email => `${PREFIX}quotes:driver:${email}`,
  platformTotal: ()    => `${PREFIX}quotes:platform:total`,
  quoteCounter:  date  => `${PREFIX}quote_counter:${date}`,
}
