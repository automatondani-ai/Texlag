/**
 * Logo data URL — read once at module initialisation from the committed PNG.
 *
 * Path resolution uses process.cwd() (the Vercel /var/task project root)
 * rather than import.meta.url / __dirname.  When Vercel transpiles ESM to
 * CommonJS, import.meta.url transforms incorrectly and __dirname-relative
 * joins resolve against the wrong base — process.cwd() is stable in every
 * environment.
 *
 * The PNG was generated offline from texlag-logo.avif and committed to the
 * repo at src/assets/texlag-logo.png.  @react-pdf/renderer supports PNG data
 * URLs; AVIF is not supported.
 */

import { readFileSync } from 'fs'
import { join }         from 'path'

const PNG_PATH = join(process.cwd(), 'src', 'assets', 'texlag-logo.png')

function loadLogo() {
  try {
    const buf = readFileSync(PNG_PATH)
    const url = `data:image/png;base64,${buf.toString('base64')}`
    console.log('[logoBase64] PNG loaded OK — path:', PNG_PATH, '— bytes:', buf.length)
    return url
  } catch (e) {
    console.error('[logoBase64] FAILED to read PNG — PDF will render without logo')
    console.error('[logoBase64] Attempted path:', PNG_PATH)
    console.error('[logoBase64] Error:', e.message)
    return null
  }
}

export const LOGO_BASE64 = loadLogo()
