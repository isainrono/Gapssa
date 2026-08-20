#!/usr/bin/env node
// scripts/secrets-rotation/lib/decideRecoveryPlan.mjs — Bloque 5
// (Revisión 2, punto 6: inventario cerrado EXACTO por puerta + rechazo
// de combinaciones semánticamente contradictorias)
//
// Decide el ESTADO final de una puerta (S2-S5) tras una restauración de
// $SECRETS_FILE, a partir de EVIDENCIA por sub-secreto ya recogida por el
// llamador (bash) mediante los helpers de aplicación/verificación reales
// — esta función NUNCA toca red/disco/procesos, es pura, y nunca decide
// "por defecto" que algo quedó coordinado sin evidencia verificada.
//
// Un secreto REVERSIBLE (POSTGRES_PASSWORD, ESPOCRM_DB_ROOT_PASSWORD,
// ESPOCRM_DB_PASSWORD, ESPOCRM_ADMIN_PASSWORD, REDIS_PASSWORD, y la
// disponibilidad de aplicación de S3 — ver más abajo) puede reaplicarse:
// el ARCHIVO (ya restaurado) y el SERVIDOR quedan coordinados con el
// valor ANTERIOR (comprometido) — "recuperación hacia atrás".
//
// Un secreto IRREVERSIBLE (ESPOCRM_API_KEY) nunca puede reaplicarse:
// regenerar invalida la anterior para siempre. Si el valor restaurado ya
// no autentica, la única recuperación posible es "hacia delante" — minar
// un valor NUEVO, aplicarlo al servidor, y escribir ESE valor nuevo (no
// el restaurado) en $SECRETS_FILE.
//
// Inventario CERRADO Y EXACTO por puerta (Revisión 2) — evidencia con
// componentes omitidos, adicionales, duplicados, o con la clasificación
// reversible/irreversible equivocada para su nombre, se rechaza:
//   S2: postgres_password (reversible)
//   S3: mariadb_root (reversible), mariadb_espocrm (reversible),
//       espocrm_app_availability (reversible — Revisión 2, punto 7: la
//       credencial de BD coordinada NUNCA implica por sí sola
//       "aplicación disponible"; se modela como un tercer componente
//       reversible obligatorio, nunca como un campo aparte, para que
//       quede sujeto EXACTAMENTE a la misma máquina de decisión que los
//       demás — un fallo aquí cierra la puerta en
//       server_coordination_required igual que cualquier otro)
//   S4: espocrm_admin_password (reversible), espocrm_api_key (irreversible)
//   S5: redis_password (reversible)
//
// Uso CLI: node decideRecoveryPlan.mjs   (lee la evidencia JSON por
// stdin, imprime el veredicto JSON por stdout, exit 0). Evidencia
// inválida → stderr con el nombre del campo únicamente, exit 1, stdout
// vacío — igual que verifyEspoAclSnapshot.mjs (Bloque 4).

import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export class RecoveryPlanError extends Error {}

const COMPONENT_STATUS = {
  COORDINATED: 'coordinated',
  FORWARD_RECOVERED: 'forward_recovered',
  SERVER_MISMATCH: 'server_mismatch',
}

const GATE_STATE = {
  RECOVERY_REQUIRED: 'recovery_required',
  FORWARD_RECOVERY_REQUIRED: 'forward_recovery_required',
  SERVER_COORDINATION_REQUIRED: 'server_coordination_required',
}

// Inventario cerrado: para cada gate, el conjunto EXACTO de nombres de
// componente esperados y si cada uno es reversible. Ni un componente de
// más, ni uno de menos, ni uno duplicado, ni uno con la clasificación
// reversible/irreversible cambiada.
const GATE_COMPONENT_SPEC = {
  S2: { postgres_password: { reversible: true } },
  S3: {
    mariadb_root: { reversible: true },
    mariadb_espocrm: { reversible: true },
    espocrm_app_availability: { reversible: true },
  },
  S4: {
    espocrm_admin_password: { reversible: true },
    espocrm_api_key: { reversible: false },
  },
  S5: { redis_password: { reversible: true } },
}
const KNOWN_GATES = Object.keys(GATE_COMPONENT_SPEC)

// --- validación estricta de la evidencia de entrada ---

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function isBoolean(v) {
  return typeof v === 'boolean'
}
function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0
}

const COMPONENT_KEYS_REVERSIBLE = ['name', 'reversible', 'restoredValueWorks', 'applyAttempted', 'applySucceeded', 'verifiedAfterApply']
const COMPONENT_KEYS_IRREVERSIBLE = ['name', 'reversible', 'restoredValueWorks', 'forwardRecoveryAttempted', 'forwardRecovered']

function validateComponent(c, path, errors) {
  if (!isPlainObject(c)) {
    errors.push(`${path}: no es un objeto`)
    return
  }
  if (!isNonEmptyString(c.name)) errors.push(`${path}.name: tipo inválido`)
  if (!isBoolean(c.reversible)) {
    errors.push(`${path}.reversible: tipo inválido`)
    return
  }
  if (!isBoolean(c.restoredValueWorks)) errors.push(`${path}.restoredValueWorks: tipo inválido`)

  const expectedKeys = c.reversible ? COMPONENT_KEYS_REVERSIBLE : COMPONENT_KEYS_IRREVERSIBLE
  for (const key of Object.keys(c)) {
    if (!expectedKeys.includes(key)) errors.push(`${path}.${key}: clave inesperada para reversible=${c.reversible}`)
  }
  for (const key of expectedKeys) {
    if (!(key in c)) {
      errors.push(`${path}.${key}: falta`)
      continue
    }
  }
  if (c.reversible) {
    for (const key of ['applyAttempted', 'applySucceeded', 'verifiedAfterApply']) {
      if (key in c && !isBoolean(c[key])) errors.push(`${path}.${key}: tipo inválido`)
    }
    if (isBoolean(c.restoredValueWorks) && isBoolean(c.applyAttempted) && isBoolean(c.applySucceeded) && isBoolean(c.verifiedAfterApply)) {
      // Combinaciones semánticamente contradictorias — rechazadas como
      // evidencia inválida, nunca "absorbidas" en silencio por la
      // máquina de decisión:
      //   - restoredValueWorks=true junto con CUALQUIER intento de
      //     aplicar: si el valor restaurado ya funcionaba, no hay
      //     motivo (ni evidencia legítima) de haber intentado aplicar
      //     nada.
      //   - verifiedAfterApply=true sin applySucceeded=true: no se
      //     puede verificar lo que no tuvo éxito.
      //   - applySucceeded=true sin applyAttempted=true: no se puede
      //     tener éxito en algo que nunca se intentó.
      if (c.restoredValueWorks === true && (c.applyAttempted === true || c.applySucceeded === true || c.verifiedAfterApply === true)) {
        errors.push(`${path}: restoredValueWorks=true es incompatible con applyAttempted/applySucceeded/verifiedAfterApply=true`)
      }
      if (c.verifiedAfterApply === true && c.applySucceeded !== true) {
        errors.push(`${path}: verifiedAfterApply=true exige applySucceeded=true`)
      }
      if (c.applySucceeded === true && c.applyAttempted !== true) {
        errors.push(`${path}: applySucceeded=true exige applyAttempted=true`)
      }
    }
  } else {
    for (const key of ['forwardRecoveryAttempted', 'forwardRecovered']) {
      if (key in c && !isBoolean(c[key])) errors.push(`${path}.${key}: tipo inválido`)
    }
    if (isBoolean(c.restoredValueWorks) && isBoolean(c.forwardRecoveryAttempted) && isBoolean(c.forwardRecovered)) {
      // Mismas contradicciones que arriba, trasladadas al vocabulario
      // irreversible (forwardRecoveryAttempted/forwardRecovered en vez
      // de applyAttempted/applySucceeded/verifiedAfterApply):
      //   - restoredValueWorks=true junto con cualquier intento de
      //     recuperación hacia delante.
      //   - forwardRecovered=true sin forwardRecoveryAttempted=true.
      if (c.restoredValueWorks === true && (c.forwardRecoveryAttempted === true || c.forwardRecovered === true)) {
        errors.push(`${path}: restoredValueWorks=true es incompatible con forwardRecoveryAttempted/forwardRecovered=true`)
      }
      if (c.forwardRecovered === true && c.forwardRecoveryAttempted !== true) {
        errors.push(`${path}: forwardRecovered=true exige forwardRecoveryAttempted=true`)
      }
    }
  }
}

/**
 * Valida la forma cerrada de la evidencia: { gate: string, components: Component[] }
 * — incluyendo, para un `gate` conocido, el inventario EXACTO de nombres
 * de componente esperado (ni omitidos, ni adicionales, ni duplicados) y
 * su clasificación reversible/irreversible correcta.
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateEvidence(evidence) {
  const errors = []
  if (!isPlainObject(evidence)) return { ok: false, errors: ['evidence: no es un objeto'] }
  const allowedTop = ['gate', 'components']
  for (const key of Object.keys(evidence)) {
    if (!allowedTop.includes(key)) errors.push(`evidence.${key}: clave inesperada`)
  }
  if (!isNonEmptyString(evidence.gate)) {
    errors.push('evidence.gate: tipo inválido')
  } else if (!KNOWN_GATES.includes(evidence.gate)) {
    errors.push(`evidence.gate: "${evidence.gate}" no es una puerta reconocida (solo se aceptan ${KNOWN_GATES.join(', ')})`)
  }

  if (!Array.isArray(evidence.components) || evidence.components.length === 0) {
    errors.push('evidence.components: debe ser un array no vacío')
    return { ok: errors.length === 0, errors }
  }
  evidence.components.forEach((c, i) => validateComponent(c, `evidence.components[${i}]`, errors))

  const spec = GATE_COMPONENT_SPEC[evidence.gate]
  if (spec) {
    const expectedNames = Object.keys(spec)
    const seenNames = new Set()
    const duplicateNames = new Set()
    for (const c of evidence.components) {
      const name = isPlainObject(c) ? c.name : undefined
      if (typeof name !== 'string') continue
      if (seenNames.has(name)) duplicateNames.add(name)
      seenNames.add(name)
    }
    for (const dup of duplicateNames) {
      errors.push(`evidence.components: componente "${dup}" duplicado`)
    }
    for (const expected of expectedNames) {
      if (!seenNames.has(expected)) {
        errors.push(`evidence.components: falta el componente obligatorio "${expected}" para la puerta ${evidence.gate}`)
      }
    }
    for (const seen of seenNames) {
      if (!expectedNames.includes(seen)) {
        errors.push(`evidence.components: componente "${seen}" no pertenece al inventario cerrado de la puerta ${evidence.gate}`)
      }
    }
    for (const c of evidence.components) {
      if (!isPlainObject(c) || typeof c.name !== 'string' || !spec[c.name]) continue
      if (typeof c.reversible === 'boolean' && c.reversible !== spec[c.name].reversible) {
        errors.push(`evidence.components: "${c.name}" debe ser reversible=${spec[c.name].reversible} para la puerta ${evidence.gate}, recibido reversible=${c.reversible}`)
      }
    }
  }

  return { ok: errors.length === 0, errors }
}

/**
 * Decide el estado de UN componente a partir de su evidencia — nunca
 * asume "coordinado" sin verificación explícita.
 */
function decideComponentStatus(c) {
  if (c.restoredValueWorks === true) return COMPONENT_STATUS.COORDINATED
  if (c.reversible) {
    if (c.applyAttempted === true && c.applySucceeded === true && c.verifiedAfterApply === true) {
      return COMPONENT_STATUS.COORDINATED
    }
    return COMPONENT_STATUS.SERVER_MISMATCH
  }
  // Irreversible: el valor restaurado ya no autentica — la única vía es
  // hacia delante, y solo cuenta si quedó genuinamente verificada.
  if (c.forwardRecoveryAttempted === true && c.forwardRecovered === true) {
    return COMPONENT_STATUS.FORWARD_RECOVERED
  }
  return COMPONENT_STATUS.SERVER_MISMATCH
}

/**
 * Calcula el veredicto completo a partir de evidencia YA validada por
 * `validateEvidence`. Función pura.
 * @returns {{gate: string, componentStatuses: Record<string,string>, gateState: string, allCoordinated: boolean}}
 */
export function decideRecoveryPlan(evidence) {
  const componentStatuses = {}
  for (const c of evidence.components) {
    componentStatuses[c.name] = decideComponentStatus(c)
  }
  const statuses = Object.values(componentStatuses)
  const anyMismatch = statuses.includes(COMPONENT_STATUS.SERVER_MISMATCH)
  const anyForwardRecovered = statuses.includes(COMPONENT_STATUS.FORWARD_RECOVERED)

  let gateState
  if (anyMismatch) {
    // Cualquier componente sin coordinar cierra la puerta en
    // server_coordination_required, incluso si otros sí se recuperaron
    // hacia delante — "archivo y servidor deben quedar en una
    // combinación coherente" nunca se cumple parcialmente.
    gateState = GATE_STATE.SERVER_COORDINATION_REQUIRED
  } else if (anyForwardRecovered) {
    gateState = GATE_STATE.FORWARD_RECOVERY_REQUIRED
  } else {
    gateState = GATE_STATE.RECOVERY_REQUIRED
  }

  return {
    gate: evidence.gate,
    componentStatuses,
    gateState,
    allCoordinated: !anyMismatch,
  }
}

// --- CLI ---

function readAllStdin() {
  return new Promise((resolve, reject) => {
    const chunks = []
    process.stdin.on('data', (chunk) => chunks.push(chunk))
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    process.stdin.on('error', reject)
  })
}

async function runCli() {
  const raw = await readAllStdin()
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.error('ERROR decideRecoveryPlan: stdin no es JSON válido.')
    process.exit(1)
    return
  }
  const { ok, errors } = validateEvidence(parsed)
  if (!ok) {
    console.error(`ERROR decideRecoveryPlan: evidencia inválida — ${errors.slice(0, 8).join('; ')}`)
    process.exit(1)
    return
  }
  const result = decideRecoveryPlan(parsed)
  process.stdout.write(JSON.stringify(result) + '\n')
}

function resolveIsMain() {
  if (!process.argv[1]) return false
  try {
    return fileURLToPath(import.meta.url) === realpathSync(process.argv[1])
  } catch {
    return false
  }
}

if (resolveIsMain()) {
  runCli().catch((err) => {
    console.error(`ERROR decideRecoveryPlan: error interno inesperado (${err instanceof Error ? err.constructor.name : 'error'}).`)
    process.exit(1)
  })
}
