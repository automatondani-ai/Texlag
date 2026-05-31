/**
 * Redis-based rate limiter using INCR + EXPIRE.
 *
 * isRateLimited(key, limit, windowSec)
 *   Increments the counter for `key` and returns true if the new count
 *   exceeds `limit` (i.e. the request should be blocked).  On the first
 *   hit it also sets the key TTL so the window resets automatically.
 *
 *   Fail-open: if Redis is unreachable the request is allowed through
 *   rather than taking the service down.
 *
 * getRateLimitCount(key)
 *   Returns the current counter value without incrementing it.
 *   Used by the login handler to check before running bcrypt.
 *
 * incrementRateLimit(key, windowSec)
 *   Increments the counter without checking the limit.
 *   Used by the login handler to record a failed attempt.
 *
 * clearRateLimit(key)
 *   Deletes the key.  Called on successful login to reset the
 *   failed-attempt counter.
 */

import redis from './redis.js'

export async function isRateLimited(key, limit, windowSec) {
  try {
    const count = await redis.incr(key)
    if (count === 1) await redis.expire(key, windowSec)
    return count > limit
  } catch {
    return false   // fail open
  }
}

export async function getRateLimitCount(key) {
  try {
    return Number(await redis.get(key) ?? 0)
  } catch {
    return 0
  }
}

export async function incrementRateLimit(key, windowSec) {
  try {
    const count = await redis.incr(key)
    if (count === 1) await redis.expire(key, windowSec)
    return count
  } catch {
    // fire-and-forget — never block the request on a counter write failure
  }
}

export async function clearRateLimit(key) {
  try {
    await redis.del(key)
  } catch {
    // non-fatal
  }
}
