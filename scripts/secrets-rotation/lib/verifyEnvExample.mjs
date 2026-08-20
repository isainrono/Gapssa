// Verifica que `.env.example` (raíz del repo) sigue siendo seguro tras la
// cuarentena de S9 — lee el archivo con `fs.readFileSync` (Node, nunca un
// proceso externo `cat`/`grep`/`sed`), nunca imprime sus líneas.
//
// `.env.example` contiene, legítimamente, muchos valores PÚBLICOS (no
// secretos): imágenes Docker, puertos, nombres de base de datos, URLs de
// localhost, parámetros técnicos (TTLs, límites de frecuencia...). Exigir
// que TODOS sean placeholders sería incorrecto y generaría falsos
// positivos. Solo las variables realmente sensibles deben llevar
// placeholder/estar vacías — el resto se valida por su forma pública
// esperada (nunca se las trata como si fueran secretas).

import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Variables sensibles — deben estar vacías o llevar un marcador de
 * placeholder reconocido (nunca un valor con forma de secreto real).
 * Cerrado: mismas claves que `server/env.ts` valida como secretos
 * criptográficos o credenciales.
 */
export const SENSITIVE_VAR_NAMES = [
  'ESPOCRM_ADMIN_PASSWORD',
  'ESPOCRM_DB_PASSWORD',
  'ESPOCRM_DB_ROOT_PASSWORD',
  'POSTGRES_PASSWORD',
  'DATABASE_URL_CMS',
  'DATABASE_URL_AUTH',
  'DATABASE_URL_BOOKING',
  'REDIS_PASSWORD',
  'REDIS_URL',
  'PAYLOAD_SECRET',
  'OTP_HMAC_SECRET',
  'AUTH_RATE_LIMIT_HMAC_SECRET',
  'BOOKING_FIELD_ENCRYPTION_KEYS',
  'BOOKING_EMAIL_LOOKUP_HMAC_SECRETS',
  'BOOKING_EMAIL_LOOKUP_HMAC_SECRET',
  'BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS',
  'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS',
  'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRET',
  'BOOKING_INTERNAL_API_SECRET',
  'SMTP_PASSWORD',
  'ESPOCRM_API_KEY',
]

const PLACEHOLDER_MARKERS = ['change-me', 'changeme', 'replace_me', 'replace-me']

function looksLikePlaceholder(value) {
  if (value === '') {
    return true
  }
  const lower = value.toLowerCase()
  return PLACEHOLDER_MARKERS.some((marker) => lower.includes(marker))
}

/** Para un valor con forma de mapa JSON `{"v1":"..."}` — cada valor del mapa debe ser placeholder. */
function looksLikePlaceholderMap(value) {
  let parsed
  try {
    parsed = JSON.parse(value)
  } catch {
    return false
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return false
  }
  const values = Object.values(parsed)
  return values.length > 0 && values.every((v) => typeof v === 'string' && looksLikePlaceholder(v))
}

const LINE_PATTERN = /^([A-Z_][A-Z0-9_]*)=(.*)$/

/**
 * Valida `.env.example` — devuelve `{ok, numerosDeLineaConProblema}`,
 * nunca el contenido de ninguna línea. `ok=false` si cualquier variable
 * sensible no es placeholder/vacía; las variables no listadas en
 * `SENSITIVE_VAR_NAMES` se aceptan sin más (son de forma pública por
 * diseño — no se exige nada de ellas).
 */
export function verifyEnvExample(envExamplePath) {
  const raw = readFileSync(envExamplePath, 'utf8')
  const lines = raw.split('\n')
  const numerosDeLineaConProblema = []

  lines.forEach((line, index) => {
    if (line === '' || line.startsWith('#')) {
      return
    }
    const match = LINE_PATTERN.exec(line)
    if (!match) {
      return
    }
    const [, key, value] = match
    if (!SENSITIVE_VAR_NAMES.includes(key)) {
      return
    }
    const ok = looksLikePlaceholder(value) || looksLikePlaceholderMap(value)
    if (!ok) {
      numerosDeLineaConProblema.push(index + 1)
    }
  })

  return { ok: numerosDeLineaConProblema.length === 0, numerosDeLineaConProblema }
}

// Bloque 6 (bug real, detectado por el escenario PTY dedicado
// `tests/s9_env_example_failure_rehearsal.py`): NUNCA comparar
// `import.meta.url` contra `process.argv[1]` por igualdad de cadena
// literal — Node resuelve `import.meta.url` a la ruta REAL (symlinks
// seguidos), pero `process.argv[1]` conserva la ruta TAL CUAL se invocó.
// `rotate-all-interactive.sh` invoca este fichero vía `$SCRIPT_DIR`, que
// puede ser una ruta simbólica (p. ej. dentro del "repo sombra" de los
// ensayos desechables, o cualquier despliegue real que invoque el script
// a través de un symlink) — con la comparación literal, esta guardia
// nunca era verdadera en esos casos: el bloque de abajo JAMÁS se
// ejecutaba, `node` terminaba con éxito (exit 0) sin imprimir nada, y
// `gate_s9` interpretaba silenciosamente eso como "`.env.example` válido"
// SIN HABER VALIDADO NADA. Mismo patrón robusto ya usado en
// `decideRecoveryPlan.mjs`/`secretValueContract.mjs`/
// `validateProbeJson.mjs`/`verifyEspoAclSnapshot.mjs`: comparar la ruta
// REAL de este módulo contra la ruta REAL (`realpathSync`) del argumento
// de invocación, nunca cadenas potencialmente distintas por symlinks.
function resolveIsMain() {
  if (!process.argv[1]) return false
  try {
    return fileURLToPath(import.meta.url) === realpathSync(process.argv[1])
  } catch {
    return false
  }
}

if (resolveIsMain()) {
  const target = process.argv[2]
  if (!target) {
    console.error('Uso: verifyEnvExample.mjs <ruta-a-.env.example>')
    process.exit(1)
  }
  const result = verifyEnvExample(target)
  console.log(JSON.stringify(result))
  process.exit(result.ok ? 0 : 1)
}
