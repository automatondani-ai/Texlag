/**
 * Logo data URL — loaded once at module initialisation from the committed PNG.
 *
 * The PNG was generated offline from src/assets/texlag-logo.avif using sharp
 * and committed to the repo.  Reading it with readFileSync here avoids any
 * runtime sharp dependency (sharp is unreliable in Vercel serverless).
 *
 * @react-pdf/renderer supports PNG data URLs; AVIF is not supported.
 */

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join }  from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)

// Resolve relative to this file: api/_lib/ → ../../src/assets/
const PNG_PATH = join(__dirname, '../../src/assets/texlag-logo.png')

let _logoBase64 = null

function getLogoBase64() {
  if (_logoBase64) return _logoBase64
  try {
    const buf    = readFileSync(PNG_PATH)
    _logoBase64  = `data:image/png;base64,${buf.toString('base64')}`
    console.log('[logoBase64] PNG loaded — bytes:', buf.length)
  } catch (e) {
    console.error('[logoBase64] Failed to read PNG logo — PDF will render without logo:', e.message)
    _logoBase64  = null
  }
  return _logoBase64
}

export const LOGO_BASE64 = getLogoBase64()
