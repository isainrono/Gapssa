#!/usr/bin/env node
// Detecta la versión de esquema REAL de $SECRETS_FILE inspeccionando su
// CONTENIDO — nunca el estado de la propia sesión de rotación. gate_s7()
// (rotate-all-interactive.sh) nunca migra de "legacy-pre-s7" a "active":
// solo genera y activa una v3 nueva SOBRE mapas que YA son plurales (ver
// su implementación). La forma singular/plural de
// BOOKING_EMAIL_LOOKUP_HMAC_SECRET(S)/BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRET(S)
// es, por tanto, una propiedad FIJA del archivo desde el momento en que
// S1 lo crea — nunca algo que dependa de qué puerta ya se marcó "done"
// en esta sesión. Un detector basado en "¿S7 ya corrió?" puede quedar
// permanentemente desincronizado del contenido real (p. ej. si el
// archivo ya nació en forma "active", como hace .env.example desde el
// primer commit de este repo) y bloquear TODAS las puertas con backup
// (todas: enter_gate llama a esto para cada una) hasta el fin de los
// tiempos, porque S7 nunca puede completarse si ni siquiera puede
// empezar. Ver current_secrets_schema_version() en
// rotate-all-interactive.sh — su único llamador.
//
// Imprime "active" o "legacy-pre-s7" a stdout (nada más, sin salto de
// línea final necesario). Falla cerrado (exit != 0, mensaje en stderr,
// SIN imprimir nada a stdout) si el archivo mezcla ambas formas a la
// vez o no contiene ninguna — nunca "adivina".
//
// Uso: node detectSecretsSchemaVersion.mjs <secretsFilePath>

import { readFileSync } from 'node:fs'
import { parsePlainEnvEntries, ACTIVE_SCHEMA_VERSION, LEGACY_PRE_S7_SCHEMA_VERSION } from './backupSchema.mjs'

const ACTIVE_MARKER_KEYS = ['BOOKING_EMAIL_LOOKUP_HMAC_SECRETS', 'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS']
const LEGACY_MARKER_KEYS = ['BOOKING_EMAIL_LOOKUP_HMAC_SECRET', 'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRET']

const [, , secretsFilePath] = process.argv

if (!secretsFilePath) {
  console.error('Uso: detectSecretsSchemaVersion.mjs <secretsFilePath>')
  process.exit(1)
}

let entries
try {
  entries = parsePlainEnvEntries(readFileSync(secretsFilePath))
} catch (err) {
  console.error(`ERROR al leer/parsear el archivo externo: ${err.message}`)
  process.exit(2)
}

const hasActive = ACTIVE_MARKER_KEYS.some((k) => entries.has(k))
const hasLegacy = LEGACY_MARKER_KEYS.some((k) => entries.has(k))

if (hasActive && hasLegacy) {
  console.error('El archivo externo mezcla claves de booking-email/access-token plurales Y singulares a la vez — estado ambiguo, rechazado.')
  process.exit(2)
}
if (hasActive) {
  process.stdout.write(ACTIVE_SCHEMA_VERSION)
  process.exit(0)
}
if (hasLegacy) {
  process.stdout.write(LEGACY_PRE_S7_SCHEMA_VERSION)
  process.exit(0)
}
console.error('El archivo externo no contiene ninguna clave de booking-email/access-token (ni plural ni singular) — no se puede determinar la versión de esquema.')
process.exit(2)
