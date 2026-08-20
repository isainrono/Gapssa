// scripts/secrets-rotation/probes/s7InternalApiAuthCheck.mts
//
// Sustituye al heredoc `ts_internal_check` que antes generaba
// rotate-all-interactive.sh::gate_s7() en tiempo de ejecución dentro de
// apps/web/. Verifica isValidInternalApiSecret directamente (nunca el
// sweep real, ningún efecto de negocio) tras rotar
// BOOKING_INTERNAL_API_SECRET: el valor nuevo se acepta, el anterior se
// rechaza, la ausencia se rechaza.
//
// El valor anterior llega por un fichero (argv[2], ruta — nunca el
// valor en sí por argv), ya creado por bash con
// `gapssa_secrets_mktemp_secure` y registrado en la pila de limpieza
// global del Bloque 2 (`gapssa_cleanup_push shred_plain`).
//
// Contrato de stdout (schema "s7-internal-check"): los 3 booleanos ya
// existentes.

import { readFileSync } from 'node:fs'

import { isValidInternalApiSecret } from '../../../apps/web/src/server/booking/internalAuth'
import { serverEnv } from '../../../apps/web/src/server/env'

function fakeRequest(headerValue: string | null): Request {
  const headers = new Headers()
  if (headerValue !== null) {
    headers.set('x-internal-api-secret', headerValue)
  }
  return new Request('http://internal.invalid/probe', { headers })
}

async function main() {
  const oldValueFile = process.argv[2]
  if (!oldValueFile) {
    throw new Error('CONFIG_ERROR: falta la ruta del fichero con el valor anterior (argv[2]).')
  }
  const line = readFileSync(oldValueFile, 'utf8').trim()
  const oldValue = line.startsWith('OLD_INTERNAL_API_SECRET=') ? line.slice('OLD_INTERNAL_API_SECRET='.length) : ''

  const newAccepted = isValidInternalApiSecret(fakeRequest(serverEnv.BOOKING_INTERNAL_API_SECRET))
  const oldRejected = oldValue === '' ? true : !isValidInternalApiSecret(fakeRequest(oldValue))
  const absentRejected = !isValidInternalApiSecret(fakeRequest(null))

  console.log(JSON.stringify({ newAccepted, oldRejected, absentRejected }))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
