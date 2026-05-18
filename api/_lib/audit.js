/**
 * Audit logging utility.
 *
 * Every call writes two Redis entries (fire-and-forget, never throws):
 *   1. audit_log:{YYYY-MM-DD}:{timestamp_ms}:{rand}  — individual keyed entry
 *   2. audit_log:index  (Redis list, LPUSH)           — ordered index for pagination
 *
 * Consumers read from the index list via LRANGE; LLEN gives the total count.
 */

import redis from './redis.js'

// ── Action type constants ─────────────────────────────────────────────────────

export const AUDIT = {
  DRIVER_CREATED:          'DRIVER_CREATED',
  DRIVER_ACTIVATED:        'DRIVER_ACTIVATED',
  DRIVER_DEACTIVATED:      'DRIVER_DEACTIVATED',
  RATES_UPDATED:           'RATES_UPDATED',
  QUOTE_GENERATED:         'QUOTE_GENERATED',
  QUOTE_EMAILED:           'QUOTE_EMAILED',
  PASSWORD_CHANGED:        'PASSWORD_CHANGED',
  PASSWORD_RESET_REQUESTED:'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_COMPLETED:'PASSWORD_RESET_COMPLETED',
}

// ── Core logger ───────────────────────────────────────────────────────────────

/**
 * @param {{ action: string, performedBy: string, description: string }} opts
 */
export function logAudit({ action, performedBy, description }) {
  const now  = new Date()
  const date = now.toISOString().slice(0, 10)                    // YYYY-MM-DD
  const ms   = now.getTime()
  const rand = Math.random().toString(36).slice(2, 7)            // 5-char suffix for uniqueness
  const key  = `audit_log:${date}:${ms}:${rand}`

  const entry = {
    timestamp:   now.toISOString(),
    action,
    performedBy: performedBy ?? 'system',
    description: description ?? '',
  }

  // Both writes are fire-and-forget; audit failures must never block responses.
  Promise.all([
    redis.set(key, entry),
    redis.lpush('audit_log:index', entry),   // newest first
  ]).catch(err => console.error('[audit] write failed:', err))
}
