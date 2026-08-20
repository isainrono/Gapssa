#!/usr/bin/env node
// Pruebas de lib/verifyEspoAclSnapshot.mjs — fusión de roles/equipos,
// matriz ACL de Portal GAPSSA API / Profesional Gapssa, validación
// estricta de forma, y cero PII/IDs en la salida.
import {
  FIELD_RANK,
  SCOPE_RANK,
  PORTAL_EXPECTED,
  PROFESSIONAL_EXPECTED,
  mostPermissiveField,
  mostPermissiveScope,
  setEqualsExpectedRole,
  computeEffectiveRoleIds,
  amplifiesPermissions,
  validateSnapshot,
  computeAclSnapshotResult,
} from './verifyEspoAclSnapshot.mjs'
import { ok, summarizeAndExit } from './testHarness.mjs'

const PORTAL_ROLE_ID = 'role-portal-000'
const PROFESSIONAL_ROLE_ID = 'role-professional-000'
const PORTAL_USER_ID = 'user-portal-000'

function portalRoleEntry(overrides = {}) {
  return {
    found: true,
    meetingScope: { create: PORTAL_EXPECTED.create, delete: PORTAL_EXPECTED.delete, ...overrides.meetingScope },
    meetingFieldData: {
      name: { ...PORTAL_EXPECTED.name },
      cBookingRequestId: { ...PORTAL_EXPECTED.cBookingRequestId },
      cMotivoResolucionReserva: { ...PORTAL_EXPECTED.cMotivoResolucionReserva },
      cExcluirGoogleCalendarSync: { ...PORTAL_EXPECTED.cExcluirGoogleCalendarSync },
      ...overrides.meetingFieldData,
    },
  }
}

function professionalRoleEntry(overrides = {}) {
  return {
    found: true,
    meetingScope: {},
    meetingFieldData: {
      cBookingRequestId: { ...PROFESSIONAL_EXPECTED.cBookingRequestId },
      cMotivoResolucionReserva: { ...PROFESSIONAL_EXPECTED.cMotivoResolucionReserva },
      cExcluirGoogleCalendarSync: { ...PROFESSIONAL_EXPECTED.cExcluirGoogleCalendarSync },
      ...overrides.meetingFieldData,
    },
  }
}

function portalUserFixture(overrides = {}) {
  const merged = { total: 1, found: true, id: PORTAL_USER_ID, type: 'api', isActive: true, teamsIds: [], rolesIds: [PORTAL_ROLE_ID], ...overrides }
  if (merged.found === false) return { total: merged.total, found: false }
  return merged
}

function roleSearchFixture(defaultId, overrides = {}) {
  const merged = { total: 1, found: true, id: defaultId, ...overrides }
  if (merged.found === false) return { total: merged.total, found: false }
  return merged
}

function baseSnapshot(overrides = {}) {
  return {
    portalUser: portalUserFixture(overrides.portalUser),
    portalRole: roleSearchFixture(PORTAL_ROLE_ID, overrides.portalRole),
    professionalRole: roleSearchFixture(PROFESSIONAL_ROLE_ID, overrides.professionalRole),
    professionalCandidates:
      overrides.professionalCandidates !== undefined
        ? overrides.professionalCandidates
        : [{ id: 'user-pro-000', type: 'regular', isActive: true, teamsIds: [], rolesIds: [PROFESSIONAL_ROLE_ID] }],
    teams: overrides.teams !== undefined ? overrides.teams : {},
    roles:
      overrides.roles !== undefined
        ? overrides.roles
        : {
            [PORTAL_ROLE_ID]: portalRoleEntry(),
            [PROFESSIONAL_ROLE_ID]: professionalRoleEntry(),
          },
    adminRuntimeCoreVerified: overrides.adminRuntimeCoreVerified !== undefined ? overrides.adminRuntimeCoreVerified : true,
  }
}

function computeValid(snapshot) {
  const { ok: valid, errors } = validateSnapshot(snapshot)
  if (!valid) throw new Error(`snapshot inválido en fixture de prueba: ${errors.join('; ')}`)
  return computeAclSnapshotResult(snapshot)
}

// ============================================================
// setEqualsExpectedRole — corrección explícita del bug de precedencia JS
// ============================================================
{
  ok('setEqualsExpectedRole: único rol correcto', setEqualsExpectedRole(new Set(['a']), 'a') === true)
  ok('setEqualsExpectedRole: único rol distinto', setEqualsExpectedRole(new Set(['b']), 'a') === false)
  ok('setEqualsExpectedRole: dos roles (uno de ellos el esperado)', setEqualsExpectedRole(new Set(['a', 'b']), 'a') === false)
  ok('setEqualsExpectedRole: conjunto vacío', setEqualsExpectedRole(new Set(), 'a') === false)
  ok('setEqualsExpectedRole: identificador falsy sintético "0"', setEqualsExpectedRole(new Set(['0']), '0') === true)
  ok('setEqualsExpectedRole: identificador falsy sintético "" ', setEqualsExpectedRole(new Set(['']), '') === true)
  ok('setEqualsExpectedRole: "0" no confunde con ausencia', setEqualsExpectedRole(new Set(['0']), 'a') === false)
  ok('setEqualsExpectedRole: no es un Set', setEqualsExpectedRole(['a'], 'a') === false)
}

// ============================================================
// mostPermissiveField / mostPermissiveScope — orden de entrada irrelevante
// ============================================================
{
  ok('mostPermissiveField: ["no","yes"] -> yes', mostPermissiveField(['no', 'yes']) === 'yes')
  ok('mostPermissiveField: ["yes","no"] -> yes (orden inverso, mismo resultado)', mostPermissiveField(['yes', 'no']) === 'yes')
  ok('mostPermissiveField: ["no","no"] -> no', mostPermissiveField(['no', 'no']) === 'no')
  ok('mostPermissiveField: array vacío -> null', mostPermissiveField([]) === null)
  ok('mostPermissiveScope: ["no","team","yes"] -> yes (yes es el más permisivo)', mostPermissiveScope(['no', 'team', 'yes']) === 'yes')
  ok('mostPermissiveScope: ["own","no"] -> own', mostPermissiveScope(['own', 'no']) === 'own')
  ok('mostPermissiveScope: ["no"] -> no', mostPermissiveScope(['no']) === 'no')
  ok('mostPermissiveScope: array vacío -> null', mostPermissiveScope([]) === null)
  ok('FIELD_RANK/SCOPE_RANK exportados y con el orden esperado', FIELD_RANK[0] === 'yes' && SCOPE_RANK[0] === 'yes' && SCOPE_RANK[SCOPE_RANK.length - 1] === 'no')
}

// ============================================================
// computeEffectiveRoleIds
// ============================================================
{
  const roles = { r1: { found: true }, r2: { found: true } }
  const teams = { t1: { found: true, rolesIds: ['r2'] } }
  const res = computeEffectiveRoleIds({ teamsIds: ['t1'], rolesIds: ['r1'] }, teams, roles)
  ok('computeEffectiveRoleIds: directo + equipo se fusionan sin distinguir origen', res.ok && res.ids.has('r1') && res.ids.has('r2') && res.ids.size === 2)

  const resMissingTeam = computeEffectiveRoleIds({ teamsIds: ['t-ausente'], rolesIds: ['r1'] }, teams, roles)
  ok('computeEffectiveRoleIds: equipo referenciado ausente -> ok:false', resMissingTeam.ok === false)

  const resMissingRole = computeEffectiveRoleIds({ teamsIds: [], rolesIds: ['r-ausente'] }, teams, roles)
  ok('computeEffectiveRoleIds: rol referenciado ausente -> ok:false', resMissingRole.ok === false)

  const resTeamWithNoRoles = computeEffectiveRoleIds({ teamsIds: ['t-vacio'], rolesIds: ['r1'] }, { 't-vacio': { found: true, rolesIds: [] } }, roles)
  ok('computeEffectiveRoleIds: equipo sin roles no aporta nada', resTeamWithNoRoles.ok && resTeamWithNoRoles.ids.size === 1 && resTeamWithNoRoles.ids.has('r1'))
}

// ============================================================
// Portal — configuración exacta válida (todos los invariantes cerrados)
// ============================================================
{
  const result = computeValid(baseSnapshot())
  ok('Portal: configuración válida completa -> aclClosed=true', result.aclClosed === true)
  ok('Portal: portalUserPresent', result.portalUserPresent === true)
  ok('Portal: portalUserActive', result.portalUserActive === true)
  ok('Portal: portalRoleSetValid', result.portalRoleSetValid === true)
  ok('Portal: create=yes', result.portalMeetingCreate === 'yes')
  ok('Portal: delete=no', result.portalMeetingDelete === 'no')
  ok('Portal: name read=no/edit=yes', result.portalMeetingNameRead === 'no' && result.portalMeetingNameEdit === 'yes')
  ok('Portal: cBookingRequestId read=yes/edit=yes', result.portalBookingRequestIdRead === 'yes' && result.portalBookingRequestIdEdit === 'yes')
  ok('Portal: cMotivoResolucionReserva read=yes/edit=yes', result.portalMotivoResolucionRead === 'yes' && result.portalMotivoResolucionEdit === 'yes')
  ok('Portal: cExcluirGoogleCalendarSync read=yes/edit=no', result.portalExcludeGcsRead === 'yes' && result.portalExcludeGcsEdit === 'no')
  ok('Portal: sin rol heredado inesperado', result.unexpectedPermissiveInheritedRole === false)
}

// --- portal ausente / duplicado / inactivo / type incorrecto ---
{
  const absent = computeValid(baseSnapshot({ portalUser: { total: 0, found: false, id: undefined, type: undefined, isActive: undefined, teamsIds: undefined, rolesIds: undefined } }))
  ok('Portal ausente: portalUserPresent=false', absent.portalUserPresent === false)
  ok('Portal ausente: aclClosed=false (nunca éxito por vacuidad)', absent.aclClosed === false)
  ok('Portal ausente: campos de permiso quedan "unknown", nunca un valor inventado', absent.portalMeetingCreate === 'unknown')

  const duplicate = computeValid(baseSnapshot({ portalUser: { total: 2 } }))
  ok('Portal duplicado (total=2): portalUserPresent=false', duplicate.portalUserPresent === false)
  ok('Portal duplicado: aclClosed=false', duplicate.aclClosed === false)

  const inactive = computeValid(baseSnapshot({ portalUser: { isActive: false } }))
  ok('Portal inactivo: portalUserActive=false', inactive.portalUserActive === false)
  ok('Portal inactivo: aclClosed=false', inactive.aclClosed === false)

  const wrongType = computeValid(baseSnapshot({ portalUser: { type: 'regular' } }))
  ok('Portal type != api: portalUserActive=false', wrongType.portalUserActive === false)
  ok('Portal type != api: aclClosed=false', wrongType.aclClosed === false)
}

// --- Role Portal ausente / duplicado ---
{
  const roleAbsent = computeValid(baseSnapshot({ portalRole: { total: 0, found: false, id: undefined } }))
  ok('Role Portal ausente: portalRoleSetValid=false', roleAbsent.portalRoleSetValid === false)
  ok('Role Portal ausente: aclClosed=false', roleAbsent.aclClosed === false)

  const roleDup = computeValid(baseSnapshot({ portalRole: { total: 2 } }))
  ok('Role Portal duplicado: portalRoleSetValid=false', roleDup.portalRoleSetValid === false)
  ok('Role Portal duplicado: aclClosed=false', roleDup.aclClosed === false)
}

// --- rol Portal directo válido / heredado por equipo válido (no amplía) ---
{
  const restrictiveExtraRoleId = 'role-portal-extra-restrictive'
  const snap = baseSnapshot({
    portalUser: { teamsIds: ['team-1'], rolesIds: [PORTAL_ROLE_ID] },
    teams: { 'team-1': { found: true, rolesIds: [restrictiveExtraRoleId] } },
    roles: {
      [PORTAL_ROLE_ID]: portalRoleEntry(),
      [PROFESSIONAL_ROLE_ID]: professionalRoleEntry(),
      [restrictiveExtraRoleId]: { found: true, meetingScope: { create: 'no', delete: 'no' }, meetingFieldData: { cExcluirGoogleCalendarSync: { read: 'no', edit: 'no' } } },
    },
  })
  const result = computeValid(snap)
  ok('Portal: rol heredado por equipo estrictamente restrictivo no amplía', result.unexpectedPermissiveInheritedRole === false)
  ok('Portal: rol heredado restrictivo -> aclClosed sigue true (create sigue yes por fusión "más permisivo gana")', result.aclClosed === true)
}

// --- rol Portal adicional que amplía permisos, campo por campo ---
{
  function withExtraRole(extraRoleId, extraRole) {
    return baseSnapshot({
      portalUser: { rolesIds: [PORTAL_ROLE_ID, extraRoleId] },
      roles: {
        [PORTAL_ROLE_ID]: portalRoleEntry(),
        [PROFESSIONAL_ROLE_ID]: professionalRoleEntry(),
        [extraRoleId]: extraRole,
      },
    })
  }
  const ampDelete = computeValid(withExtraRole('extra-delete-yes', { found: true, meetingScope: { delete: 'yes' }, meetingFieldData: {} }))
  ok('Portal: rol adicional con delete=yes amplía -> unexpectedPermissiveInheritedRole=true', ampDelete.unexpectedPermissiveInheritedRole === true)
  ok('Portal: amplía delete -> portalMeetingDelete refleja el valor efectivo real (yes)', ampDelete.portalMeetingDelete === 'yes')
  ok('Portal: amplía delete -> aclClosed=false', ampDelete.aclClosed === false)

  const ampNameRead = computeValid(withExtraRole('extra-name-read-yes', { found: true, meetingScope: {}, meetingFieldData: { name: { read: 'yes' } } }))
  ok('Portal: rol adicional con name.read=yes amplía', ampNameRead.unexpectedPermissiveInheritedRole === true)

  const ampGcsEdit = computeValid(withExtraRole('extra-gcs-edit-yes', { found: true, meetingScope: {}, meetingFieldData: { cExcluirGoogleCalendarSync: { edit: 'yes' } } }))
  ok('Portal: rol adicional con cExcluirGoogleCalendarSync.edit=yes amplía', ampGcsEdit.unexpectedPermissiveInheritedRole === true)
  ok('Portal: amplía GCS edit -> aclClosed=false', ampGcsEdit.aclClosed === false)
}

// --- Team/Role referenciado que no puede leerse (Portal) ---
{
  const missingTeam = computeValid(
    baseSnapshot({
      portalUser: { teamsIds: ['team-ausente'] },
      teams: {},
    }),
  )
  ok('Portal: team referenciado ausente -> portalRoleSetValid=false', missingTeam.portalRoleSetValid === false)
  ok('Portal: team referenciado ausente -> unexpectedPermissiveInheritedRole=true (fail-closed)', missingTeam.unexpectedPermissiveInheritedRole === true)
  ok('Portal: team referenciado ausente -> aclClosed=false', missingTeam.aclClosed === false)
}

// ============================================================
// Profesionales — casos del encargo
// ============================================================

// --- profesional solo con rol correcto ---
{
  const result = computeValid(baseSnapshot())
  ok('Profesional solo con rol correcto: professionalUsersVerified=true', result.professionalUsersVerified === true)
  ok('Profesional solo con rol correcto: professionalEffectiveAclClosed=true', result.professionalEffectiveAclClosed === true)
  ok('Profesional solo con rol correcto: los tres campos protegidos en no/no', result.professionalBookingRequestIdRead === 'no' && result.professionalBookingRequestIdEdit === 'no' && result.professionalMotivoResolucionRead === 'no' && result.professionalMotivoResolucionEdit === 'no' && result.professionalExcludeGcsRead === 'no' && result.professionalExcludeGcsEdit === 'no')
}

function professionalWithExtraDirectRole(extraRole) {
  return baseSnapshot({
    professionalCandidates: [{ id: 'user-pro-000', type: 'regular', isActive: true, teamsIds: [], rolesIds: [PROFESSIONAL_ROLE_ID, 'extra-pro-role'] }],
    roles: {
      [PORTAL_ROLE_ID]: portalRoleEntry(),
      [PROFESSIONAL_ROLE_ID]: professionalRoleEntry(),
      'extra-pro-role': extraRole,
    },
  })
}

// --- profesional + rol directo no/no, yes/no, no/yes, yes/yes ---
{
  const noNo = computeValid(professionalWithExtraDirectRole({ found: true, meetingScope: {}, meetingFieldData: { cBookingRequestId: { read: 'no', edit: 'no' } } }))
  ok('Profesional + rol directo no/no: no amplía', noNo.unexpectedProfessionalPermissiveRole === false)
  ok('Profesional + rol directo no/no: aclClosed sigue true', noNo.aclClosed === true)

  const yesNo = computeValid(professionalWithExtraDirectRole({ found: true, meetingScope: {}, meetingFieldData: { cBookingRequestId: { read: 'yes', edit: 'no' } } }))
  ok('Profesional + rol directo yes/no (read concedido): amplía', yesNo.unexpectedProfessionalPermissiveRole === true)
  ok('Profesional + rol directo yes/no: professionalBookingRequestIdRead=yes (efectivo real)', yesNo.professionalBookingRequestIdRead === 'yes')
  ok('Profesional + rol directo yes/no: aclClosed=false', yesNo.aclClosed === false)

  const noYes = computeValid(professionalWithExtraDirectRole({ found: true, meetingScope: {}, meetingFieldData: { cMotivoResolucionReserva: { read: 'no', edit: 'yes' } } }))
  ok('Profesional + rol directo no/yes (edit concedido): amplía', noYes.unexpectedProfessionalPermissiveRole === true)
  ok('Profesional + rol directo no/yes: aclClosed=false', noYes.aclClosed === false)

  const yesYes = computeValid(professionalWithExtraDirectRole({ found: true, meetingScope: {}, meetingFieldData: { cExcluirGoogleCalendarSync: { read: 'yes', edit: 'yes' } } }))
  ok('Profesional + rol directo yes/yes: amplía', yesYes.unexpectedProfessionalPermissiveRole === true)
  ok('Profesional + rol directo yes/yes: aclClosed=false', yesYes.aclClosed === false)
}

// --- mismos 4 casos por herencia de equipo ---
function professionalWithExtraTeamRole(extraRole) {
  return baseSnapshot({
    professionalCandidates: [{ id: 'user-pro-000', type: 'regular', isActive: true, teamsIds: ['team-pro'], rolesIds: [PROFESSIONAL_ROLE_ID] }],
    teams: { 'team-pro': { found: true, rolesIds: ['extra-pro-role-team'] } },
    roles: {
      [PORTAL_ROLE_ID]: portalRoleEntry(),
      [PROFESSIONAL_ROLE_ID]: professionalRoleEntry(),
      'extra-pro-role-team': extraRole,
    },
  })
}
{
  const noNo = computeValid(professionalWithExtraTeamRole({ found: true, meetingScope: {}, meetingFieldData: { cBookingRequestId: { read: 'no', edit: 'no' } } }))
  ok('Profesional + rol de equipo no/no: no amplía', noNo.unexpectedProfessionalPermissiveRole === false && noNo.aclClosed === true)

  const yesNo = computeValid(professionalWithExtraTeamRole({ found: true, meetingScope: {}, meetingFieldData: { cBookingRequestId: { read: 'yes', edit: 'no' } } }))
  ok('Profesional + rol de equipo yes/no: amplía', yesNo.unexpectedProfessionalPermissiveRole === true && yesNo.aclClosed === false)

  const noYes = computeValid(professionalWithExtraTeamRole({ found: true, meetingScope: {}, meetingFieldData: { cMotivoResolucionReserva: { read: 'no', edit: 'yes' } } }))
  ok('Profesional + rol de equipo no/yes: amplía', noYes.unexpectedProfessionalPermissiveRole === true && noYes.aclClosed === false)

  const yesYes = computeValid(professionalWithExtraTeamRole({ found: true, meetingScope: {}, meetingFieldData: { cExcluirGoogleCalendarSync: { read: 'yes', edit: 'yes' } } }))
  ok('Profesional + rol de equipo yes/yes: amplía', yesYes.unexpectedProfessionalPermissiveRole === true && yesYes.aclClosed === false)
}

// --- dos roles adicionales restrictivos: no debe marcar la bandera ---
{
  const snap = baseSnapshot({
    professionalCandidates: [{ id: 'user-pro-000', type: 'regular', isActive: true, teamsIds: [], rolesIds: [PROFESSIONAL_ROLE_ID, 'extra-a', 'extra-b'] }],
    roles: {
      [PORTAL_ROLE_ID]: portalRoleEntry(),
      [PROFESSIONAL_ROLE_ID]: professionalRoleEntry(),
      'extra-a': { found: true, meetingScope: {}, meetingFieldData: { cBookingRequestId: { read: 'no', edit: 'no' } } },
      'extra-b': { found: true, meetingScope: {}, meetingFieldData: { cMotivoResolucionReserva: { read: 'no', edit: 'no' } } },
    },
  })
  const result = computeValid(snap)
  ok('Profesional + dos roles adicionales restrictivos: no amplía', result.unexpectedProfessionalPermissiveRole === false)
  ok('Profesional + dos roles adicionales restrictivos: aclClosed=true', result.aclClosed === true)
}

// --- Team o Role referenciado ausente (profesional) ---
{
  const snap = baseSnapshot({
    professionalCandidates: [{ id: 'user-pro-000', type: 'regular', isActive: true, teamsIds: ['team-ausente'], rolesIds: [PROFESSIONAL_ROLE_ID] }],
    teams: {},
  })
  const result = computeValid(snap)
  ok('Profesional con Team referenciado ausente: unexpectedProfessionalPermissiveRole=true (fail-closed)', result.unexpectedProfessionalPermissiveRole === true)
  ok('Profesional con Team referenciado ausente: professionalUsersVerified=false', result.professionalUsersVerified === false)
  ok('Profesional con Team referenciado ausente: aclClosed=false', result.aclClosed === false)
}

// --- equipo sin roles ---
{
  const snap = baseSnapshot({
    professionalCandidates: [{ id: 'user-pro-000', type: 'regular', isActive: true, teamsIds: ['team-vacio'], rolesIds: [PROFESSIONAL_ROLE_ID] }],
    teams: { 'team-vacio': { found: true, rolesIds: [] } },
  })
  const result = computeValid(snap)
  ok('Profesional en equipo sin roles: sigue verificado y cerrado', result.professionalUsersVerified === true && result.aclClosed === true)
}

// --- dos profesionales correctos ---
{
  const snap = baseSnapshot({
    professionalCandidates: [
      { id: 'user-pro-1', type: 'regular', isActive: true, teamsIds: [], rolesIds: [PROFESSIONAL_ROLE_ID] },
      { id: 'user-pro-2', type: 'regular', isActive: true, teamsIds: [], rolesIds: [PROFESSIONAL_ROLE_ID] },
    ],
  })
  const result = computeValid(snap)
  ok('Dos profesionales correctos: professionalUserCount=2', result.professionalUserCount === 2)
  ok('Dos profesionales correctos: aclClosed=true', result.aclClosed === true)
}

// --- cero profesionales (nunca éxito por vacuidad) ---
{
  const result = computeValid(baseSnapshot({ professionalCandidates: [] }))
  ok('Cero profesionales: professionalUserCount=0', result.professionalUserCount === 0)
  ok('Cero profesionales: professionalUsersVerified=false', result.professionalUsersVerified === false)
  ok('Cero profesionales: aclClosed=false', result.aclClosed === false)
}

// --- usuario inactivo excluido del conteo de profesionales ---
{
  const result = computeValid(baseSnapshot({ professionalCandidates: [{ id: 'user-pro-000', type: 'regular', isActive: false, teamsIds: [], rolesIds: [PROFESSIONAL_ROLE_ID] }] }))
  ok('Candidato inactivo: no cuenta como profesional', result.professionalUserCount === 0)
  ok('Candidato inactivo: aclClosed=false', result.aclClosed === false)
}

// --- API User con rol Profesional no cuenta como profesional humano ---
{
  const result = computeValid(baseSnapshot({ professionalCandidates: [{ id: 'user-api-weird', type: 'api', isActive: true, teamsIds: [], rolesIds: [PROFESSIONAL_ROLE_ID] }] }))
  ok('Candidato type=api con rol Profesional: no cuenta como profesional humano', result.professionalUserCount === 0)
  ok('Candidato type=api con rol Profesional: aclClosed=false (cero profesionales humanos)', result.aclClosed === false)
}

// --- Role Profesional ausente/duplicado ---
{
  const absent = computeValid(baseSnapshot({ professionalRole: { total: 0, found: false, id: undefined } }))
  ok('Role Profesional ausente: professionalRolePresent=false', absent.professionalRolePresent === false)
  ok('Role Profesional ausente: aclClosed=false', absent.aclClosed === false)

  const dup = computeValid(baseSnapshot({ professionalRole: { total: 2 } }))
  ok('Role Profesional duplicado: professionalRolePresent=false', dup.professionalRolePresent === false)
  ok('Role Profesional duplicado: aclClosed=false', dup.aclClosed === false)
}

// --- fieldData ausente -> default yes/yes (acceso completo), peligroso para exclusión ---
{
  const snap = baseSnapshot({
    roles: {
      [PORTAL_ROLE_ID]: { found: true, meetingScope: { create: 'yes', delete: 'no' }, meetingFieldData: { name: { ...PORTAL_EXPECTED.name }, cBookingRequestId: { ...PORTAL_EXPECTED.cBookingRequestId }, cMotivoResolucionReserva: { ...PORTAL_EXPECTED.cMotivoResolucionReserva } } }, // cExcluirGoogleCalendarSync ausente
      [PROFESSIONAL_ROLE_ID]: professionalRoleEntry(),
    },
  })
  const result = computeValid(snap)
  ok('fieldData ausente para cExcluirGoogleCalendarSync: default yes/yes (acceso completo)', result.portalExcludeGcsRead === 'yes' && result.portalExcludeGcsEdit === 'yes')
  ok('fieldData ausente: edit=yes inesperado -> aclClosed=false', result.aclClosed === false)
}

// --- adminRuntimeCoreVerified ---
{
  const notVerified = computeValid(baseSnapshot({ adminRuntimeCoreVerified: false }))
  ok('adminRuntimeCoreVerified=false: aclClosed=false', notVerified.aclClosed === false)
  ok('adminRuntimeCoreVerified=false: se refleja tal cual en la salida', notVerified.adminRuntimeCoreVerified === false)

  const verified = computeValid(baseSnapshot({ adminRuntimeCoreVerified: true }))
  ok('adminRuntimeCoreVerified=true + resto válido: aclClosed=true', verified.aclClosed === true)
}

// ============================================================
// validateSnapshot — validación estricta de forma
// ============================================================
{
  const { ok: valid } = validateSnapshot(baseSnapshot())
  ok('validateSnapshot: snapshot base válido pasa', valid === true)

  ok('validateSnapshot: no es un objeto', validateSnapshot(null).ok === false)
  ok('validateSnapshot: array en vez de objeto', validateSnapshot([]).ok === false)

  const extraKey = { ...baseSnapshot(), campoInesperado: true }
  ok('validateSnapshot: clave de nivel superior inesperada rechazada', validateSnapshot(extraKey).ok === false)

  const missingKey = baseSnapshot()
  delete missingKey.teams
  ok('validateSnapshot: clave de nivel superior ausente rechazada', validateSnapshot(missingKey).ok === false)

  const badLevel = baseSnapshot()
  badLevel.roles[PORTAL_ROLE_ID].meetingFieldData.name.read = 'maybe'
  ok('validateSnapshot: valor ACL desconocido rechazado', validateSnapshot(badLevel).ok === false)

  const badScopeLevel = baseSnapshot()
  badScopeLevel.roles[PORTAL_ROLE_ID].meetingScope.create = 'sometimes'
  ok('validateSnapshot: valor de scope desconocido rechazado', validateSnapshot(badScopeLevel).ok === false)

  const corruptArray = baseSnapshot()
  corruptArray.roles[PORTAL_ROLE_ID].meetingFieldData = ['no-deberia-ser-array']
  ok('validateSnapshot: meetingFieldData como array (corrupto) rechazado', validateSnapshot(corruptArray).ok === false)

  const corruptObject = baseSnapshot()
  corruptObject.portalUser.teamsIds = { no: 'array' }
  ok('validateSnapshot: teamsIds como objeto (corrupto) rechazado', validateSnapshot(corruptObject).ok === false)

  const unexpectedFieldName = baseSnapshot()
  unexpectedFieldName.roles[PORTAL_ROLE_ID].meetingFieldData.someOtherField = { read: 'yes', edit: 'yes' }
  ok('validateSnapshot: campo Meeting no auditado en meetingFieldData rechazado', validateSnapshot(unexpectedFieldName).ok === false)

  const messages = validateSnapshot(badLevel).errors
  ok('validateSnapshot: mensaje de error cita el campo, nunca el valor', messages.some((m) => m.includes('name.read')) && !messages.some((m) => m.includes('maybe')))
}

// --- paginación: candidatos profesionales de varias páginas se combinan sin problema ---
{
  const manyCandidates = Array.from({ length: 3 }, (_, i) => ({ id: `user-pro-${i}`, type: 'regular', isActive: true, teamsIds: [], rolesIds: [PROFESSIONAL_ROLE_ID] }))
  const result = computeValid(baseSnapshot({ professionalCandidates: manyCandidates }))
  ok('Candidatos de varias páginas (simulado por un array combinado): professionalUserCount=3', result.professionalUserCount === 3)
  ok('Candidatos de varias páginas: aclClosed=true', result.aclClosed === true)
}

// ============================================================
// Cero PII / IDs en la salida
// ============================================================
{
  const secretIds = [PORTAL_USER_ID, PORTAL_ROLE_ID, PROFESSIONAL_ROLE_ID, 'user-pro-000']
  const result = computeValid(baseSnapshot())
  const serialized = JSON.stringify(result)
  const leaked = secretIds.filter((id) => serialized.includes(id))
  ok('Salida del helper: ningún ID de entrada aparece como substring', leaked.length === 0)
  const allValuesAreClosed = Object.entries(result).every(([, v]) => typeof v === 'boolean' || typeof v === 'number' || ['yes', 'no', 'unknown'].includes(v))
  ok('Salida del helper: todos los valores son booleanos, enteros, o el enum cerrado yes/no/unknown', allValuesAreClosed)
}

// --- amplifiesPermissions: utilidad directa ---
{
  const base = { create: 'yes', delete: 'no', name: { read: 'no', edit: 'yes' }, cBookingRequestId: { read: 'yes', edit: 'yes' }, cMotivoResolucionReserva: { read: 'yes', edit: 'yes' }, cExcluirGoogleCalendarSync: { read: 'yes', edit: 'no' } }
  const same = { ...base, cExcluirGoogleCalendarSync: { ...base.cExcluirGoogleCalendarSync } }
  ok('amplifiesPermissions: mismo valor -> false', amplifiesPermissions(same, base) === false)
  const morePermissive = { ...base, cExcluirGoogleCalendarSync: { read: 'yes', edit: 'yes' } }
  ok('amplifiesPermissions: edit más permisivo -> true', amplifiesPermissions(morePermissive, base) === true)
  const lessPermissive = { ...base, delete: 'yes', cExcluirGoogleCalendarSync: { ...base.cExcluirGoogleCalendarSync, edit: 'no' } }
  ok('amplifiesPermissions: delete yes vs no (más permisivo) -> true', amplifiesPermissions(lessPermissive, base) === true)
}

summarizeAndExit()
