#!/usr/bin/env node
// scripts/secrets-rotation/lib/verifyEspoAclSnapshot.mjs
//
// Verificación real y cerrada de la ACL efectiva de Meeting para S9 —
// sustituye la comprobación superficial anterior en gate_s9 ("User
// accesible ⇒ acl_ok=true", incluso con el usuario ausente) por el
// algoritmo exacto de fusión de roles de EspoCRM 10.0.3:
//   - conjunto de roles efectivo = directos ∪ roles de cada equipo
//     (Core/Acl/Table/DefaultRoleListProvider.php:52-91);
//   - fusión "el más permisivo gana"
//     (Core/Acl/Table/DefaultTable.php: $levelList/$fieldLevelList,
//     mergeTableListItem()/mergeFieldTableList());
//   - ausencia total de una clave de campo en el conjunto efectivo ⇒
//     acceso completo por defecto (DefaultTable::getFieldData()).
// Ver docs/fase4b-bloque4-acl-s9.md (informe de cierre) para las citas
// completas con número de línea.
//
// Uso desde bash: node verifyEspoAclSnapshot.mjs   (lee el snapshot JSON
// por stdin — nunca PII, nunca el $SECRETS_FILE real).
//
// Contrato:
//   - snapshot de entrada válido (forma exacta, ver validateSnapshot) ⇒
//     stdout = JSON de una línea con el contrato cerrado (ver
//     computeAclSnapshotResult), exit 0. Un resultado con
//     `aclClosed: false` es un cálculo exitoso, no un error de proceso.
//   - snapshot inválido (clave inesperada, tipo incorrecto, valor ACL
//     fuera del enum cerrado) ⇒ stderr con el nombre del campo
//     ÚNICAMENTE (nunca su valor), exit 1, stdout vacío.

import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const FIELD_RANK = ['yes', 'no']
export const SCOPE_RANK = ['yes', 'all', 'team', 'own', 'no']

const MEETING_FIELD_NAMES = ['name', 'cBookingRequestId', 'cMotivoResolucionReserva', 'cExcluirGoogleCalendarSync']
const PROTECTED_FIELD_NAMES = ['cBookingRequestId', 'cMotivoResolucionReserva', 'cExcluirGoogleCalendarSync']
const MEETING_SCOPE_ACTIONS = ['create', 'delete']

// Matriz ACL esperada — única fuente de verdad (docs/fase4b-decision-flow-final.md
// cierre Puerta 3B, docs/fase4b-puerta4-cierre.md, docs/fase4b-puerta5-propuesta-v3.md,
// docs/fase4b-puerta6-exclusion-gcs.md). No se ajusta para hacer pasar pruebas.
export const PORTAL_EXPECTED = {
  create: 'yes',
  delete: 'no',
  name: { read: 'no', edit: 'yes' },
  cBookingRequestId: { read: 'yes', edit: 'yes' },
  cMotivoResolucionReserva: { read: 'yes', edit: 'yes' },
  cExcluirGoogleCalendarSync: { read: 'yes', edit: 'no' },
}
export const PROFESSIONAL_EXPECTED = {
  cBookingRequestId: { read: 'no', edit: 'no' },
  cMotivoResolucionReserva: { read: 'no', edit: 'no' },
  cExcluirGoogleCalendarSync: { read: 'no', edit: 'no' },
}

export class AclSnapshotError extends Error {}

// --- utilidades puras de fusión ("el más permisivo gana") ---

/** @param {string[]} levels valores en FIELD_RANK, no vacío @returns {'yes'|'no'|null} */
export function mostPermissiveField(levels) {
  if (!Array.isArray(levels) || levels.length === 0) return null
  return levels.includes('yes') ? 'yes' : 'no'
}

/** @param {string[]} levels valores en SCOPE_RANK, no vacío @returns {string|null} */
export function mostPermissiveScope(levels) {
  if (!Array.isArray(levels) || levels.length === 0) return null
  for (const level of SCOPE_RANK) {
    if (levels.includes(level)) return level
  }
  return null
}

/**
 * ¿El conjunto de roles es EXACTAMENTE {expectedId}? Utilidad correctamente
 * implementada y testeada por separado — sustituye cualquier expresión de
 * negación de índice de array (`![...set][0] === x`, ambigua por
 * precedencia de JS). No es, por sí sola, la condición que bloquea
 * `aclClosed` (ver `amplifiesPermissions` para la política real de roles
 * adicionales) — es una señal informativa interna, correcta y probada.
 * @param {Set<string>} roleIds @param {string} expectedId @returns {boolean}
 */
export function setEqualsExpectedRole(roleIds, expectedId) {
  return roleIds instanceof Set && roleIds.size === 1 && roleIds.has(expectedId)
}

function fieldRank(level) {
  const i = FIELD_RANK.indexOf(level)
  return i === -1 ? FIELD_RANK.length : i
}
function scopeRank(level) {
  const i = SCOPE_RANK.indexOf(level)
  return i === -1 ? SCOPE_RANK.length : i // 'unknown' (no rankeable) ⇒ el menos permisivo posible
}
function isMorePermissiveField(a, b) {
  return fieldRank(a) < fieldRank(b)
}
function isMorePermissiveScope(a, b) {
  return scopeRank(a) < scopeRank(b)
}

// --- validación estricta del snapshot (forma cerrada, nunca la RAW de EspoCRM) ---

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0
}
function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0)
}
function isBoolean(v) {
  return typeof v === 'boolean'
}
function isNonNegInt(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0
}

const FIELD_LEVEL_SET = new Set(FIELD_RANK)
const SCOPE_LEVEL_SET = new Set(SCOPE_RANK)

function checkAllowedKeys(obj, allowed, path, errors) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) errors.push(`${path}.${key}: clave inesperada`)
  }
}

function validateMeetingFieldData(obj, path, errors) {
  if (obj === undefined) return
  if (!isPlainObject(obj)) {
    errors.push(`${path}: no es un objeto`)
    return
  }
  for (const key of Object.keys(obj)) {
    if (!MEETING_FIELD_NAMES.includes(key)) {
      errors.push(`${path}.${key}: campo no auditado`)
      continue
    }
    const val = obj[key]
    if (!isPlainObject(val)) {
      errors.push(`${path}.${key}: no es un objeto {read,edit}`)
      continue
    }
    checkAllowedKeys(val, ['read', 'edit'], `${path}.${key}`, errors)
    for (const action of ['read', 'edit']) {
      if (action in val && !FIELD_LEVEL_SET.has(val[action])) {
        errors.push(`${path}.${key}.${action}: valor ACL desconocido`)
      }
    }
  }
}

function validateMeetingScope(obj, path, errors) {
  if (obj === undefined) return
  if (!isPlainObject(obj)) {
    errors.push(`${path}: no es un objeto`)
    return
  }
  checkAllowedKeys(obj, MEETING_SCOPE_ACTIONS, path, errors)
  for (const action of MEETING_SCOPE_ACTIONS) {
    if (action in obj && !SCOPE_LEVEL_SET.has(obj[action])) {
      errors.push(`${path}.${action}: valor ACL desconocido`)
    }
  }
}

function validateUserLike(obj, path, errors, { withTypeAndActive }) {
  if (!isPlainObject(obj)) {
    errors.push(`${path}: no es un objeto`)
    return
  }
  const allowed = withTypeAndActive ? ['id', 'type', 'isActive', 'teamsIds', 'rolesIds'] : ['total', 'found', 'id', 'type', 'isActive', 'teamsIds', 'rolesIds']
  checkAllowedKeys(obj, allowed, path, errors)
  if (!withTypeAndActive) {
    if (!isNonNegInt(obj.total)) errors.push(`${path}.total: tipo inválido`)
    if (!isBoolean(obj.found)) errors.push(`${path}.found: tipo inválido`)
    if (obj.found === false) {
      for (const k of ['id', 'type', 'isActive', 'teamsIds', 'rolesIds']) {
        if (k in obj) errors.push(`${path}.${k}: no debe estar presente si found=false`)
      }
      return
    }
  }
  if (!isNonEmptyString(obj.id)) errors.push(`${path}.id: tipo inválido`)
  if (!isNonEmptyString(obj.type)) errors.push(`${path}.type: tipo inválido`)
  if (!isBoolean(obj.isActive)) errors.push(`${path}.isActive: tipo inválido`)
  if (!isStringArray(obj.teamsIds)) errors.push(`${path}.teamsIds: tipo inválido`)
  if (!isStringArray(obj.rolesIds)) errors.push(`${path}.rolesIds: tipo inválido`)
}

function validateRoleSearch(obj, path, errors) {
  if (!isPlainObject(obj)) {
    errors.push(`${path}: no es un objeto`)
    return
  }
  checkAllowedKeys(obj, ['total', 'found', 'id'], path, errors)
  if (!isNonNegInt(obj.total)) errors.push(`${path}.total: tipo inválido`)
  if (!isBoolean(obj.found)) errors.push(`${path}.found: tipo inválido`)
  if (obj.found === true) {
    if (!isNonEmptyString(obj.id)) errors.push(`${path}.id: tipo inválido`)
  } else if ('id' in obj) {
    errors.push(`${path}.id: no debe estar presente si found=false`)
  }
}

const SNAPSHOT_TOP_LEVEL_KEYS = ['portalUser', 'portalRole', 'professionalRole', 'professionalCandidates', 'teams', 'roles', 'adminRuntimeCoreVerified']

/**
 * Valida la forma cerrada del snapshot construido por gate_s9 — claves
 * exactas, tipos exactos, cualquier valor ACL fuera de {yes,no}/
 * {yes,all,team,own,no} rechaza. Nunca valida la respuesta RAW de EspoCRM
 * (esa reducción ya ocurrió en bash antes de llegar aquí).
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateSnapshot(snapshot) {
  const errors = []
  if (!isPlainObject(snapshot)) return { ok: false, errors: ['snapshot: no es un objeto'] }

  checkAllowedKeys(snapshot, SNAPSHOT_TOP_LEVEL_KEYS, 'snapshot', errors)
  for (const key of SNAPSHOT_TOP_LEVEL_KEYS) {
    if (!(key in snapshot)) errors.push(`snapshot.${key}: falta`)
  }
  if (errors.length > 0) return { ok: false, errors }

  validateUserLike(snapshot.portalUser, 'portalUser', errors, { withTypeAndActive: false })
  validateRoleSearch(snapshot.portalRole, 'portalRole', errors)
  validateRoleSearch(snapshot.professionalRole, 'professionalRole', errors)

  if (!Array.isArray(snapshot.professionalCandidates)) {
    errors.push('professionalCandidates: no es un array')
  } else {
    snapshot.professionalCandidates.forEach((cand, i) => {
      validateUserLike(cand, `professionalCandidates[${i}]`, errors, { withTypeAndActive: true })
    })
  }

  if (!isPlainObject(snapshot.teams)) {
    errors.push('teams: no es un objeto')
  } else {
    for (const [id, team] of Object.entries(snapshot.teams)) {
      if (!isPlainObject(team) || !isBoolean(team.found)) {
        errors.push(`teams.${id}: forma inválida`)
        continue
      }
      if (team.found) {
        checkAllowedKeys(team, ['found', 'rolesIds'], `teams.${id}`, errors)
        if (!isStringArray(team.rolesIds)) errors.push(`teams.${id}.rolesIds: tipo inválido`)
      } else {
        checkAllowedKeys(team, ['found'], `teams.${id}`, errors)
      }
    }
  }

  if (!isPlainObject(snapshot.roles)) {
    errors.push('roles: no es un objeto')
  } else {
    for (const [id, role] of Object.entries(snapshot.roles)) {
      if (!isPlainObject(role) || !isBoolean(role.found)) {
        errors.push(`roles.${id}: forma inválida`)
        continue
      }
      if (role.found) {
        checkAllowedKeys(role, ['found', 'meetingScope', 'meetingFieldData'], `roles.${id}`, errors)
        validateMeetingScope(role.meetingScope, `roles.${id}.meetingScope`, errors)
        validateMeetingFieldData(role.meetingFieldData, `roles.${id}.meetingFieldData`, errors)
      } else {
        checkAllowedKeys(role, ['found'], `roles.${id}`, errors)
      }
    }
  }

  if (!isBoolean(snapshot.adminRuntimeCoreVerified)) errors.push('adminRuntimeCoreVerified: tipo inválido')

  return { ok: errors.length === 0, errors }
}

// --- algoritmo de fusión (replica DefaultTable::load()/getFieldData()) ---

/**
 * Conjunto de roles efectivo = directos ∪ roles de cada equipo
 * (DefaultRoleListProvider.php:52-91). `{ok:false}` si cualquier team/role
 * referenciado no está resuelto en el snapshot — nunca asume vacío.
 * @param {{teamsIds:string[], rolesIds:string[]}} entity
 * @param {Record<string, any>} teams @param {Record<string, any>} roles
 * @returns {{ok: true, ids: Set<string>} | {ok: false, ids: null}}
 */
export function computeEffectiveRoleIds(entity, teams, roles) {
  const ids = new Set(entity.rolesIds)
  for (const teamId of entity.teamsIds) {
    const team = teams[teamId]
    if (!team || team.found !== true) return { ok: false, ids: null }
    for (const rid of team.rolesIds) ids.add(rid)
  }
  for (const rid of ids) {
    const role = roles[rid]
    if (!role || role.found !== true) return { ok: false, ids: null }
  }
  return { ok: true, ids }
}

function mergeScopeAction(roleIds, action, roles) {
  const levels = []
  for (const rid of roleIds) {
    const scope = roles[rid]?.meetingScope
    if (scope && scope[action] !== undefined) levels.push(scope[action])
  }
  // Ningún rol del conjunto efectivo declara este scope-action: EspoCRM
  // aplicaría applyDefault()/strictDefault (metadata no modelada aquí) —
  // se documenta como límite explícito y se falla cerrado con "unknown".
  if (levels.length === 0) return 'unknown'
  return mostPermissiveScope(levels)
}

function mergeFieldAction(roleIds, fieldName, action, roles) {
  const levels = []
  for (const rid of roleIds) {
    const entry = roles[rid]?.meetingFieldData?.[fieldName]
    if (entry && entry[action] !== undefined) levels.push(entry[action])
  }
  // Ausencia total ⇒ acceso completo por defecto (DefaultTable::getFieldData()).
  if (levels.length === 0) return 'yes'
  return mostPermissiveField(levels)
}

function computeTrackedValues(roleIds, roles) {
  const build = (field) => ({
    read: mergeFieldAction(roleIds, field, 'read', roles),
    edit: mergeFieldAction(roleIds, field, 'edit', roles),
  })
  return {
    create: mergeScopeAction(roleIds, 'create', roles),
    delete: mergeScopeAction(roleIds, 'delete', roles),
    name: build('name'),
    cBookingRequestId: build('cBookingRequestId'),
    cMotivoResolucionReserva: build('cMotivoResolucionReserva'),
    cExcluirGoogleCalendarSync: build('cExcluirGoogleCalendarSync'),
  }
}

/**
 * ¿`merged` es, en algún campo auditado, estrictamente más permisiva que
 * `baseline`? Alcance declarado: solo los campos de PORTAL_EXPECTED/
 * PROFESSIONAL_EXPECTED — no modela el resto de scopes de EspoCRM.
 */
export function amplifiesPermissions(merged, baseline) {
  if (isMorePermissiveScope(merged.create, baseline.create)) return true
  if (isMorePermissiveScope(merged.delete, baseline.delete)) return true
  for (const field of MEETING_FIELD_NAMES) {
    if (isMorePermissiveField(merged[field].read, baseline[field].read)) return true
    if (isMorePermissiveField(merged[field].edit, baseline[field].edit)) return true
  }
  return false
}

/**
 * Calcula el contrato de salida cerrado a partir de un snapshot YA
 * validado por `validateSnapshot`. Función pura — nunca imprime, nunca
 * sale del proceso. `aclClosed:false` es un resultado legítimo, no un
 * error de proceso.
 */
export function computeAclSnapshotResult(snapshot) {
  const { portalUser, portalRole, professionalRole, professionalCandidates, teams, roles, adminRuntimeCoreVerified } = snapshot

  const portalUserPresent = portalUser.found === true && portalUser.total === 1
  const portalUserActive = portalUserPresent && portalUser.isActive === true && portalUser.type === 'api'
  const portalRoleFound = portalRole.found === true && portalRole.total === 1

  let portalRoleSetValid = false
  let unexpectedPermissiveInheritedRole = true // fail-closed por defecto
  let portalValues = computeTrackedValues(new Set(), {}) // todo "unknown"/"yes" por defecto vacío — se sustituye abajo si procede
  // Ojo: computeTrackedValues con roleIds vacío da field defaults "yes" (ausencia
  // total = acceso completo) y scope "unknown" — no es el resultado real salvo
  // que realmente no haya ningún rol resuelto; se sobrescribe explícitamente
  // cuando el cálculo real es posible.
  portalValues = {
    create: 'unknown',
    delete: 'unknown',
    name: { read: 'unknown', edit: 'unknown' },
    cBookingRequestId: { read: 'unknown', edit: 'unknown' },
    cMotivoResolucionReserva: { read: 'unknown', edit: 'unknown' },
    cExcluirGoogleCalendarSync: { read: 'unknown', edit: 'unknown' },
  }

  if (portalUserPresent && portalRoleFound) {
    const eff = computeEffectiveRoleIds(portalUser, teams, roles)
    if (eff.ok && eff.ids.has(portalRole.id)) {
      portalRoleSetValid = true
      const merged = computeTrackedValues(eff.ids, roles)
      const baseline = computeTrackedValues(new Set([portalRole.id]), roles)
      unexpectedPermissiveInheritedRole = amplifiesPermissions(merged, baseline)
      portalValues = merged
    } else {
      portalRoleSetValid = false
      unexpectedPermissiveInheritedRole = true
    }
  }

  let professionalUserCount = 0
  let candidatesUnresolved = false
  let unexpectedProfessionalPermissiveRole = false
  const professionalAgg = {
    cBookingRequestId: { read: 'no', edit: 'no' },
    cMotivoResolucionReserva: { read: 'no', edit: 'no' },
    cExcluirGoogleCalendarSync: { read: 'no', edit: 'no' },
  }
  const professionalRoleFound = professionalRole.found === true && professionalRole.total === 1

  if (professionalRoleFound) {
    for (const cand of professionalCandidates) {
      if (cand.type !== 'regular' || cand.isActive !== true) continue
      const eff = computeEffectiveRoleIds(cand, teams, roles)
      if (!eff.ok) {
        // No se puede resolver el conjunto efectivo de este candidato —
        // no se puede descartar que sea profesional (y, si lo es, no se
        // puede descartar amplificación) — falla cerrado.
        candidatesUnresolved = true
        continue
      }
      if (!eff.ids.has(professionalRole.id)) continue // no es profesional
      professionalUserCount += 1
      const merged = computeTrackedValues(eff.ids, roles)
      const baseline = computeTrackedValues(new Set([professionalRole.id]), roles)
      if (amplifiesPermissions(merged, baseline)) unexpectedProfessionalPermissiveRole = true
      for (const field of PROTECTED_FIELD_NAMES) {
        professionalAgg[field].read = mostPermissiveField([professionalAgg[field].read, merged[field].read])
        professionalAgg[field].edit = mostPermissiveField([professionalAgg[field].edit, merged[field].edit])
      }
    }
  }
  if (candidatesUnresolved) unexpectedProfessionalPermissiveRole = true

  const professionalUsersVerified = professionalRoleFound && professionalUserCount >= 1 && !candidatesUnresolved
  const professionalFieldsOk = PROTECTED_FIELD_NAMES.every(
    (f) => professionalAgg[f].read === PROFESSIONAL_EXPECTED[f].read && professionalAgg[f].edit === PROFESSIONAL_EXPECTED[f].edit,
  )
  const professionalEffectiveAclClosed = professionalUsersVerified && !unexpectedProfessionalPermissiveRole && professionalFieldsOk

  const portalFieldsOk =
    portalValues.create === PORTAL_EXPECTED.create &&
    portalValues.delete === PORTAL_EXPECTED.delete &&
    portalValues.name.read === PORTAL_EXPECTED.name.read &&
    portalValues.name.edit === PORTAL_EXPECTED.name.edit &&
    portalValues.cBookingRequestId.read === PORTAL_EXPECTED.cBookingRequestId.read &&
    portalValues.cBookingRequestId.edit === PORTAL_EXPECTED.cBookingRequestId.edit &&
    portalValues.cMotivoResolucionReserva.read === PORTAL_EXPECTED.cMotivoResolucionReserva.read &&
    portalValues.cMotivoResolucionReserva.edit === PORTAL_EXPECTED.cMotivoResolucionReserva.edit &&
    portalValues.cExcluirGoogleCalendarSync.read === PORTAL_EXPECTED.cExcluirGoogleCalendarSync.read &&
    portalValues.cExcluirGoogleCalendarSync.edit === PORTAL_EXPECTED.cExcluirGoogleCalendarSync.edit

  const aclClosed =
    portalUserPresent &&
    portalUserActive &&
    portalRoleSetValid &&
    portalFieldsOk &&
    professionalRoleFound &&
    professionalUserCount >= 1 &&
    professionalUsersVerified &&
    professionalFieldsOk &&
    professionalEffectiveAclClosed &&
    !unexpectedPermissiveInheritedRole &&
    !unexpectedProfessionalPermissiveRole &&
    adminRuntimeCoreVerified === true

  return {
    portalUserPresent,
    portalUserActive,
    portalRoleSetValid,
    portalMeetingCreate: portalValues.create,
    portalMeetingDelete: portalValues.delete,
    portalMeetingNameRead: portalValues.name.read,
    portalMeetingNameEdit: portalValues.name.edit,
    portalBookingRequestIdRead: portalValues.cBookingRequestId.read,
    portalBookingRequestIdEdit: portalValues.cBookingRequestId.edit,
    portalMotivoResolucionRead: portalValues.cMotivoResolucionReserva.read,
    portalMotivoResolucionEdit: portalValues.cMotivoResolucionReserva.edit,
    portalExcludeGcsRead: portalValues.cExcluirGoogleCalendarSync.read,
    portalExcludeGcsEdit: portalValues.cExcluirGoogleCalendarSync.edit,
    professionalRolePresent: professionalRoleFound,
    professionalUserCount,
    professionalUsersVerified,
    professionalBookingRequestIdRead: professionalAgg.cBookingRequestId.read,
    professionalBookingRequestIdEdit: professionalAgg.cBookingRequestId.edit,
    professionalMotivoResolucionRead: professionalAgg.cMotivoResolucionReserva.read,
    professionalMotivoResolucionEdit: professionalAgg.cMotivoResolucionReserva.edit,
    professionalExcludeGcsRead: professionalAgg.cExcluirGoogleCalendarSync.read,
    professionalExcludeGcsEdit: professionalAgg.cExcluirGoogleCalendarSync.edit,
    professionalEffectiveAclClosed,
    unexpectedPermissiveInheritedRole,
    unexpectedProfessionalPermissiveRole,
    adminRuntimeCoreVerified: adminRuntimeCoreVerified === true,
    aclClosed,
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
    console.error('ERROR verifyEspoAclSnapshot: stdin no es JSON válido.')
    process.exit(1)
    return
  }
  const { ok, errors } = validateSnapshot(parsed)
  if (!ok) {
    console.error(`ERROR verifyEspoAclSnapshot: snapshot inválido — ${errors.slice(0, 8).join('; ')}`)
    process.exit(1)
    return
  }
  const result = computeAclSnapshotResult(parsed)
  process.stdout.write(JSON.stringify(result) + '\n')
}

// Comparación de "¿soy el módulo de entrada?" por ruta real (nunca por
// comparación literal de import.meta.url contra process.argv[1] — un
// directorio temporal de prueba bajo /var/folders en macOS es un symlink
// a /private/var/folders, y una comparación literal fallaría en silencio).
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
    console.error(`ERROR verifyEspoAclSnapshot: error interno inesperado (${err instanceof Error ? err.constructor.name : 'error'}).`)
    process.exit(1)
  })
}
