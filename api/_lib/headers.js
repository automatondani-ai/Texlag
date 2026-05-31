/**
 * Sets standard security headers on every API response.
 * Call at the very top of each handler before any response is written.
 */
export function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options',  'nosniff')
  res.setHeader('X-Frame-Options',         'DENY')
  res.setHeader('Referrer-Policy',         'strict-origin-when-cross-origin')
  res.setHeader('Cache-Control',           'no-store')
}
