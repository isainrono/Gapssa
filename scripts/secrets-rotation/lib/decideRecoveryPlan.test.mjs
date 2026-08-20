// Pruebas de lib/decideRecoveryPlan.mjs — decisión de recuperación por
// puerta a partir de evidencia por sub-secreto (Bloque 5, endurecido en
// la Revisión 2: inventario cerrado EXACTO por puerta + rechazo de
// combinaciones semánticamente contradictorias).
import { validateEvidence, decideRecoveryPlan, decideRecoveryPlan as decide } from './decideRecoveryPlan.mjs'
import { ok, summarizeAndExit } from './testHarness.mjs'

function reversible(name, overrides = {}) {
  return { name, reversible: true, restoredValueWorks: false, applyAttempted: true, applySucceeded: true, verifiedAfterApply: true, ...overrides }
}
function irreversible(name, overrides = {}) {
  return { name, reversible: false, restoredValueWorks: false, forwardRecoveryAttempted: false, forwardRecovered: false, ...overrides }
}
function evidenceOf(gate, components) {
  return { gate, components }
}
function computeValid(evidence) {
  const { ok: valid, errors } = validateEvidence(evidence)
  if (!valid) throw new Error(`evidencia inválida en fixture: ${errors.join('; ')}`)
  return decide(evidence)
}
// S3 completo (3 componentes exactos): root + espocrm + disponibilidad
// de aplicación — por defecto todos "ya coordinados sin intervención".
function s3Components(overrides = {}) {
  return [
    reversible('mariadb_root', { restoredValueWorks: true, applyAttempted: false, applySucceeded: false, verifiedAfterApply: false, ...(overrides.mariadb_root || {}) }),
    reversible('mariadb_espocrm', { restoredValueWorks: true, applyAttempted: false, applySucceeded: false, verifiedAfterApply: false, ...(overrides.mariadb_espocrm || {}) }),
    reversible('espocrm_app_availability', { restoredValueWorks: true, applyAttempted: false, applySucceeded: false, verifiedAfterApply: false, ...(overrides.espocrm_app_availability || {}) }),
  ]
}

// ============================================================
// S2 — un único componente reversible (postgres_password)
// ============================================================
{
  const restoredWorksAlready = computeValid(evidenceOf('S2', [reversible('postgres_password', { restoredValueWorks: true, applyAttempted: false, applySucceeded: false, verifiedAfterApply: false })]))
  ok('S2: valor restaurado ya autentica (nada que aplicar) -> recovery_required', restoredWorksAlready.gateState === 'recovery_required')
  ok('S2: componente coordinated', restoredWorksAlready.componentStatuses.postgres_password === 'coordinated')

  const appliedOk = computeValid(evidenceOf('S2', [reversible('postgres_password')]))
  ok('S2: aplicado y verificado con éxito -> recovery_required', appliedOk.gateState === 'recovery_required')

  const applyFailed = computeValid(evidenceOf('S2', [reversible('postgres_password', { applySucceeded: false, verifiedAfterApply: false })]))
  ok('S2: fallo al aplicar -> server_coordination_required', applyFailed.gateState === 'server_coordination_required')
  ok('S2: componente server_mismatch', applyFailed.componentStatuses.postgres_password === 'server_mismatch')

  const appliedButNotVerified = computeValid(evidenceOf('S2', [reversible('postgres_password', { verifiedAfterApply: false })]))
  ok('S2: aplicado pero NO re-verificado -> server_coordination_required (nunca se asume)', appliedButNotVerified.gateState === 'server_coordination_required')

  const neverAttempted = computeValid(evidenceOf('S2', [reversible('postgres_password', { applyAttempted: false, applySucceeded: false, verifiedAfterApply: false })]))
  ok('S2: nunca se intentó aplicar y el restaurado no funciona -> server_coordination_required', neverAttempted.gateState === 'server_coordination_required')
}

// ============================================================
// S3 — tres componentes reversibles (root + espocrm +
// espocrm_app_availability), reconciliación idempotente por usuario, y
// disponibilidad de aplicación como componente obligatorio (Revisión 2)
// ============================================================
{
  const allCoordinated = computeValid(evidenceOf('S3', s3Components()))
  ok('S3: root, espocrm y aplicación coordinados -> recovery_required', allCoordinated.gateState === 'recovery_required')

  const onlyRootChanged = computeValid(
    evidenceOf(
      'S3',
      s3Components({
        mariadb_root: { restoredValueWorks: false, applyAttempted: true, applySucceeded: true, verifiedAfterApply: true },
      }),
    ),
  )
  ok('S3: solo root cambió (espocrm y app ya estaban coordinados) -> recovery_required', onlyRootChanged.gateState === 'recovery_required')

  const dbCoordinatedButAppDown = computeValid(
    evidenceOf(
      'S3',
      s3Components({
        espocrm_app_availability: { restoredValueWorks: false, applyAttempted: true, applySucceeded: true, verifiedAfterApply: false },
      }),
    ),
  )
  ok(
    'S3 (Revisión 2, punto 7): credenciales de BD coordinadas pero app-check nunca verificado -> server_coordination_required, NUNCA recovery_required',
    dbCoordinatedButAppDown.gateState === 'server_coordination_required',
  )
  ok('S3: componente de aplicación queda server_mismatch, root/espocrm coordinated', dbCoordinatedButAppDown.componentStatuses.espocrm_app_availability === 'server_mismatch' && dbCoordinatedButAppDown.componentStatuses.mariadb_root === 'coordinated')

  const rootStillMismatched = computeValid(
    evidenceOf(
      'S3',
      s3Components({
        mariadb_root: { restoredValueWorks: false, applyAttempted: true, applySucceeded: false, verifiedAfterApply: false },
      }),
    ),
  )
  ok('S3: espocrm y app coordinados pero root sigue sin poder aplicarse -> server_coordination_required (combinación incoherente)', rootStillMismatched.gateState === 'server_coordination_required')

  const allFailed = computeValid(
    evidenceOf(
      'S3',
      s3Components({
        mariadb_root: { restoredValueWorks: false, applyAttempted: true, applySucceeded: false, verifiedAfterApply: false },
        mariadb_espocrm: { restoredValueWorks: false, applyAttempted: true, applySucceeded: false, verifiedAfterApply: false },
        espocrm_app_availability: { restoredValueWorks: false, applyAttempted: false, applySucceeded: false, verifiedAfterApply: false },
      }),
    ),
  )
  ok('S3: los tres fallan -> server_coordination_required', allFailed.gateState === 'server_coordination_required')
}

// ============================================================
// S4 — admin password (reversible) + API key (irreversible)
// ============================================================
{
  const onlyAdminChanged = computeValid(evidenceOf('S4', [reversible('espocrm_admin_password'), irreversible('espocrm_api_key', { restoredValueWorks: true })]))
  ok('S4: solo admin password cambió, API key restaurada sigue válida -> recovery_required', onlyAdminChanged.gateState === 'recovery_required')

  const onlyApiKeyRegenerated = computeValid(evidenceOf('S4', [reversible('espocrm_admin_password', { restoredValueWorks: true, applyAttempted: false, applySucceeded: false, verifiedAfterApply: false }), irreversible('espocrm_api_key', { forwardRecoveryAttempted: true, forwardRecovered: true })]))
  ok('S4: solo API Key regenerada (admin ya coordinado) -> forward_recovery_required', onlyApiKeyRegenerated.gateState === 'forward_recovery_required')
  ok('S4: componente API key queda forward_recovered', onlyApiKeyRegenerated.componentStatuses.espocrm_api_key === 'forward_recovered')

  const bothChanged = computeValid(evidenceOf('S4', [reversible('espocrm_admin_password'), irreversible('espocrm_api_key', { forwardRecoveryAttempted: true, forwardRecovered: true })]))
  ok('S4: ambos cambiados (admin reaplicado + API key forward-recovered) -> forward_recovery_required', bothChanged.gateState === 'forward_recovery_required')

  const apiKeyDefinitivelyInvalidNoRecovery = computeValid(evidenceOf('S4', [reversible('espocrm_admin_password', { restoredValueWorks: true, applyAttempted: false, applySucceeded: false, verifiedAfterApply: false }), irreversible('espocrm_api_key')]))
  ok('S4: API Key anterior definitivamente inválida y sin forward recovery -> server_coordination_required (nunca finge una API Key inválida como recuperada)', apiKeyDefinitivelyInvalidNoRecovery.gateState === 'server_coordination_required')
  ok('S4: nunca marca "recovery_required" con una API Key inválida en el archivo', apiKeyDefinitivelyInvalidNoRecovery.gateState !== 'recovery_required')

  const forwardAttemptedButFailed = computeValid(evidenceOf('S4', [reversible('espocrm_admin_password'), irreversible('espocrm_api_key', { forwardRecoveryAttempted: true, forwardRecovered: false })]))
  ok('S4: forward recovery intentada pero fallida -> server_coordination_required', forwardAttemptedButFailed.gateState === 'server_coordination_required')
  ok(
    'S4 (Revisión 2, punto 5): un portal-gapssa-api ausente/ambiguo/no-type=api produce EXACTAMENTE esta misma forma (attempted=true, recovered=false) -> nunca key_restored_works=true "por defecto"',
    forwardAttemptedButFailed.componentStatuses.espocrm_api_key === 'server_mismatch',
  )

  const adminAndApiKeyBothMismatched = computeValid(evidenceOf('S4', [reversible('espocrm_admin_password', { applySucceeded: false, verifiedAfterApply: false }), irreversible('espocrm_api_key')]))
  ok('S4: admin sin coordinar Y api key sin recuperar -> server_coordination_required', adminAndApiKeyBothMismatched.gateState === 'server_coordination_required')
}

// ============================================================
// S5 — un único componente reversible (redis_password)
// ============================================================
{
  const recreatedOk = computeValid(evidenceOf('S5', [reversible('redis_password')]))
  ok('S5: recreación con éxito -> recovery_required', recreatedOk.gateState === 'recovery_required')

  const recreateFailed = computeValid(evidenceOf('S5', [reversible('redis_password', { applySucceeded: false, verifiedAfterApply: false })]))
  ok('S5: recreación fallida -> server_coordination_required', recreateFailed.gateState === 'server_coordination_required')
}

// ============================================================
// validateEvidence — validación estricta de forma (genérica)
// ============================================================
{
  ok('validateEvidence: evidencia válida (S2) pasa', validateEvidence(evidenceOf('S2', [reversible('postgres_password')])).ok === true)
  ok('validateEvidence: evidencia válida (S3, 3 componentes) pasa', validateEvidence(evidenceOf('S3', s3Components())).ok === true)
  ok('validateEvidence: no es un objeto', validateEvidence(null).ok === false)
  ok('validateEvidence: components vacío rechazado', validateEvidence(evidenceOf('S2', [])).ok === false)
  ok('validateEvidence: gate ausente rechazado', validateEvidence({ components: [reversible('postgres_password')] }).ok === false)
  ok('validateEvidence: clave de nivel superior inesperada rechazada', validateEvidence({ gate: 'S2', components: [reversible('postgres_password')], extra: true }).ok === false)

  const badComponent = { ...reversible('postgres_password') }
  delete badComponent.applySucceeded
  ok('validateEvidence: componente reversible sin applySucceeded rechazado', validateEvidence(evidenceOf('S2', [badComponent])).ok === false)

  const wrongShapeForIrreversible = { ...irreversible('espocrm_api_key'), applyAttempted: true, applySucceeded: true, verifiedAfterApply: true }
  ok('validateEvidence: componente irreversible con claves de reversible rechazado', validateEvidence(evidenceOf('S4', [wrongShapeForIrreversible])).ok === false)

  const badType = { name: 'postgres_password', reversible: 'yes', restoredValueWorks: false }
  ok('validateEvidence: reversible no booleano rechazado', validateEvidence(evidenceOf('S2', [badType])).ok === false)

  const corruptComponents = evidenceOf('S2', 'not-an-array')
  ok('validateEvidence: components no es array, rechazado', validateEvidence(corruptComponents).ok === false)
}

// ============================================================
// validateEvidence — inventario cerrado EXACTO por puerta (Revisión 2,
// punto 6)
// ============================================================
{
  ok('gate desconocido ("S1") rechazado', validateEvidence(evidenceOf('S1', [reversible('postgres_password')])).ok === false)
  ok('gate desconocido ("S10") rechazado', validateEvidence(evidenceOf('S10', [reversible('postgres_password')])).ok === false)
  ok('gate desconocido (cadena vacía ya cubierta por isNonEmptyString, pero "s2" minúscula) rechazado', validateEvidence(evidenceOf('s2', [reversible('postgres_password')])).ok === false)

  ok('S2: componente omitido (array vacío ya cubierto arriba; aquí un componente de OTRO nombre) rechazado', validateEvidence(evidenceOf('S2', [reversible('otro_nombre')])).ok === false)
  ok('S2: componente adicional junto al esperado rechazado', validateEvidence(evidenceOf('S2', [reversible('postgres_password'), reversible('componente_sobrante')])).ok === false)
  ok('S2: componente duplicado (mismo nombre dos veces) rechazado', validateEvidence(evidenceOf('S2', [reversible('postgres_password'), reversible('postgres_password')])).ok === false)

  ok('S3: falta espocrm_app_availability (solo 2 de 3 componentes) rechazado', validateEvidence(evidenceOf('S3', [reversible('mariadb_root'), reversible('mariadb_espocrm')])).ok === false)
  ok('S3: falta mariadb_espocrm rechazado', validateEvidence(evidenceOf('S3', [reversible('mariadb_root'), reversible('espocrm_app_availability')])).ok === false)
  ok('S3: componente adicional no perteneciente al inventario rechazado', validateEvidence(evidenceOf('S3', [...s3Components(), reversible('otro_extra')])).ok === false)
  ok('S3: mariadb_root duplicado rechazado', validateEvidence(evidenceOf('S3', [...s3Components(), reversible('mariadb_root')])).ok === false)

  ok('S4: falta espocrm_api_key rechazado', validateEvidence(evidenceOf('S4', [reversible('espocrm_admin_password')])).ok === false)
  ok('S4: componente adicional rechazado', validateEvidence(evidenceOf('S4', [reversible('espocrm_admin_password'), irreversible('espocrm_api_key'), reversible('otro_extra')])).ok === false)

  ok('S5: falta redis_password rechazado', validateEvidence(evidenceOf('S5', [])).ok === false)
  ok('S5: componente con nombre de OTRA puerta (postgres_password) rechazado', validateEvidence(evidenceOf('S5', [reversible('postgres_password')])).ok === false)

  // Clasificación reversible/irreversible incorrecta para un nombre CONOCIDO
  ok('S3: mariadb_root marcado irreversible (clasificación incorrecta) rechazado', validateEvidence(evidenceOf('S3', [irreversible('mariadb_root'), reversible('mariadb_espocrm'), reversible('espocrm_app_availability')])).ok === false)
  ok('S4: espocrm_admin_password marcado irreversible (clasificación incorrecta) rechazado', validateEvidence(evidenceOf('S4', [irreversible('espocrm_admin_password'), irreversible('espocrm_api_key')])).ok === false)
  ok('S4: espocrm_api_key marcado reversible (clasificación incorrecta) rechazado', validateEvidence(evidenceOf('S4', [reversible('espocrm_admin_password'), reversible('espocrm_api_key', { restoredValueWorks: true, applyAttempted: false, applySucceeded: false, verifiedAfterApply: false })])).ok === false)
}

// ============================================================
// validateEvidence — combinaciones semánticamente contradictorias
// (Revisión 2, punto 6)
// ============================================================
{
  ok(
    'verified=true sin succeeded=true rechazado',
    validateEvidence(evidenceOf('S2', [reversible('postgres_password', { applySucceeded: false, verifiedAfterApply: true })])).ok === false,
  )
  ok(
    'succeeded=true sin attempted=true rechazado',
    validateEvidence(evidenceOf('S2', [reversible('postgres_password', { applyAttempted: false, applySucceeded: true })])).ok === false,
  )
  ok(
    'succeeded=true sin attempted=true (con verified=true también) sigue rechazado',
    validateEvidence(evidenceOf('S2', [reversible('postgres_password', { applyAttempted: false, applySucceeded: true, verifiedAfterApply: true })])).ok === false,
  )
  ok(
    'restoredValueWorks=true incompatible con applyAttempted=true (resto de evidencia)',
    validateEvidence(evidenceOf('S2', [reversible('postgres_password', { restoredValueWorks: true, applyAttempted: true, applySucceeded: false, verifiedAfterApply: false })])).ok === false,
  )
  ok(
    'restoredValueWorks=true incompatible con applySucceeded/verifiedAfterApply=true',
    validateEvidence(evidenceOf('S2', [reversible('postgres_password', { restoredValueWorks: true, applyAttempted: true, applySucceeded: true, verifiedAfterApply: true })])).ok === false,
  )
  ok(
    'restoredValueWorks=true CON el resto todo false sigue siendo válido (caso normal)',
    validateEvidence(evidenceOf('S2', [reversible('postgres_password', { restoredValueWorks: true, applyAttempted: false, applySucceeded: false, verifiedAfterApply: false })])).ok === true,
  )

  ok(
    'forwardRecovered=true sin forwardRecoveryAttempted=true rechazado (componente irreversible)',
    validateEvidence(evidenceOf('S4', [reversible('espocrm_admin_password'), irreversible('espocrm_api_key', { forwardRecoveryAttempted: false, forwardRecovered: true })])).ok === false,
  )
  ok(
    'restoredValueWorks=true incompatible con forwardRecoveryAttempted=true (componente irreversible)',
    validateEvidence(evidenceOf('S4', [reversible('espocrm_admin_password'), irreversible('espocrm_api_key', { restoredValueWorks: true, forwardRecoveryAttempted: true, forwardRecovered: false })])).ok === false,
  )
  ok(
    'restoredValueWorks=true incompatible con forwardRecovered=true (componente irreversible)',
    validateEvidence(evidenceOf('S4', [reversible('espocrm_admin_password'), irreversible('espocrm_api_key', { restoredValueWorks: true, forwardRecoveryAttempted: true, forwardRecovered: true })])).ok === false,
  )
  ok(
    'forwardRecoveryAttempted=true y forwardRecovered=false es válido (intento fallido, caso normal)',
    validateEvidence(evidenceOf('S4', [reversible('espocrm_admin_password'), irreversible('espocrm_api_key', { forwardRecoveryAttempted: true, forwardRecovered: false })])).ok === true,
  )

  // "componente reversible" con forwardRecovered=true de vuelta: ya
  // cubierto arriba por el rechazo de "clave inesperada" (forwardRecovered
  // no pertenece a COMPONENT_KEYS_REVERSIBLE), pero se confirma
  // explícitamente aquí como caso nombrado por el encargo.
  const reversibleWithForwardRecoveredKey = { name: 'mariadb_root', reversible: true, restoredValueWorks: false, applyAttempted: true, applySucceeded: true, verifiedAfterApply: true, forwardRecovered: true }
  ok(
    'forwardRecovered=true en un componente REVERSIBLE rechazado (clave inesperada para su forma)',
    validateEvidence(evidenceOf('S3', [reversibleWithForwardRecoveredKey, reversible('mariadb_espocrm'), reversible('espocrm_app_availability')])).ok === false,
  )
}

summarizeAndExit()
