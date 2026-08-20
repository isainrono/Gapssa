#!/usr/bin/env node
// Pruebas de lib/backupSchema.mjs — versiones de esquema de backup
// (active / legacy-pre-s7), etiqueta de versión, formato real del
// almacén (blancos, comentarios, CRLF, sin newline final), inventario
// cerrado + claves OBLIGATORIAS por versión.
import {
  parseTaggedPayload,
  parsePlainEnvEntries,
  validateEntriesAgainstSchema,
  inventoryForSchemaVersion,
  mandatoryKeysForSchemaVersion,
  BackupSchemaError,
  ACTIVE_SCHEMA_VERSION,
  LEGACY_PRE_S7_SCHEMA_VERSION,
  MANDATORY_KEYS_ACTIVE,
  MANDATORY_KEYS_LEGACY_PRE_S7,
} from './backupSchema.mjs'
import { ok, summarizeAndExit } from './testHarness.mjs'

function buf(text) {
  return Buffer.from(text, 'utf8')
}

function expectThrow(fn) {
  try {
    fn()
    return null
  } catch (err) {
    return err
  }
}

// Cuerpos COMPLETOS (todas las claves obligatorias, valores ficticios
// desechables) — construidos directamente a partir de
// MANDATORY_KEYS_ACTIVE/MANDATORY_KEYS_LEGACY_PRE_S7 para que nunca se
// desincronicen manualmente de la lista real si esta cambia.
function fullBodyFor(mandatoryKeys) {
  return mandatoryKeys.map((k) => `${k}=valor-ficticio-${k.toLowerCase()}`).join('\n') + '\n'
}
const FULL_ACTIVE_BODY = fullBodyFor(MANDATORY_KEYS_ACTIVE)
const FULL_LEGACY_BODY = fullBodyFor(MANDATORY_KEYS_LEGACY_PRE_S7)

// --- backup "active" válido y COMPLETO ---
{
  const parsed = parseTaggedPayload(buf(`__GAPSSA_BACKUP_SCHEMA_VERSION__=active\n${FULL_ACTIVE_BODY}`))
  ok('backup activo válido: versión detectada', parsed.schemaVersion === ACTIVE_SCHEMA_VERSION)
  ok('backup activo completo: pasa la validación de inventario + obligatorias', !expectThrow(() => validateEntriesAgainstSchema(parsed.schemaVersion, parsed.entries)))
}

// --- backup "legacy-pre-s7" válido y COMPLETO: nombres singulares de booking ---
{
  const parsed = parseTaggedPayload(buf(`__GAPSSA_BACKUP_SCHEMA_VERSION__=legacy-pre-s7\n${FULL_LEGACY_BODY}`))
  ok('backup legacy válido: versión detectada', parsed.schemaVersion === LEGACY_PRE_S7_SCHEMA_VERSION)
  ok('backup legacy completo: pasa la validación de su propio inventario + obligatorias', !expectThrow(() => validateEntriesAgainstSchema(parsed.schemaVersion, parsed.entries)))
}

// --- versión desconocida ---
{
  const err = expectThrow(() => parseTaggedPayload(buf('__GAPSSA_BACKUP_SCHEMA_VERSION__=bogus-version\nFOO=bar\n')))
  ok('versión de esquema desconocida: rechazada', err instanceof BackupSchemaError)
}

// --- metadata ausente ---
{
  const err = expectThrow(() => parseTaggedPayload(buf('POSTGRES_PASSWORD=valor-ficticio-000\n')))
  ok('metadata de versión ausente: rechazada', err instanceof BackupSchemaError)
}

// --- singular + plural simultáneos: el inventario "active" rechaza el singular, con mensaje específico de mezcla ---
{
  const parsed = parseTaggedPayload(buf(`__GAPSSA_BACKUP_SCHEMA_VERSION__=active\n${FULL_ACTIVE_BODY}BOOKING_EMAIL_LOOKUP_HMAC_SECRET=valor-ficticio-001\n`))
  const err = expectThrow(() => validateEntriesAgainstSchema(parsed.schemaVersion, parsed.entries))
  ok('esquema activo rechaza la variante singular (pre-S7)', err instanceof BackupSchemaError)
  ok('mensaje de rechazo identifica la mezcla legacy/active explícitamente', /mezcla de nombres legacy\/active/.test(err?.message ?? ''))
}
{
  const parsed = parseTaggedPayload(buf(`__GAPSSA_BACKUP_SCHEMA_VERSION__=legacy-pre-s7\n${FULL_LEGACY_BODY}BOOKING_EMAIL_LOOKUP_HMAC_SECRETS={"v1":"x"}\n`))
  const err = expectThrow(() => validateEntriesAgainstSchema(parsed.schemaVersion, parsed.entries))
  ok('esquema legacy-pre-s7 rechaza la variante plural/versionada', err instanceof BackupSchemaError)
  ok('mensaje de rechazo identifica la mezcla legacy/active explícitamente (2)', /mezcla de nombres legacy\/active/.test(err?.message ?? ''))
}

// --- backup vacío (solo la etiqueta, sin ninguna línea más) rechazado ---
{
  const parsed = parseTaggedPayload(buf('__GAPSSA_BACKUP_SCHEMA_VERSION__=active\n'))
  ok('backup con solo la etiqueta: 0 entradas tokenizadas', parsed.entries.size === 0)
  const err = expectThrow(() => validateEntriesAgainstSchema(parsed.schemaVersion, parsed.entries))
  ok('backup vacío (solo etiqueta): rechazado por falta de obligatorias', err instanceof BackupSchemaError && /obligatoria/.test(err.message))
}

// --- backup incompleto: falta UNA clave obligatoria ---
{
  const incompleteKeys = MANDATORY_KEYS_ACTIVE.slice(1) // omite la primera obligatoria
  const body = incompleteKeys.map((k) => `${k}=x`).join('\n') + '\n'
  const parsed = parseTaggedPayload(buf(`__GAPSSA_BACKUP_SCHEMA_VERSION__=active\n${body}`))
  const err = expectThrow(() => validateEntriesAgainstSchema(parsed.schemaVersion, parsed.entries))
  ok('backup incompleto (falta 1 clave obligatoria): rechazado', err instanceof BackupSchemaError && err.message.includes(MANDATORY_KEYS_ACTIVE[0]))
}

// --- clave obligatoria presente pero vacía: rechazada ---
{
  const body = MANDATORY_KEYS_ACTIVE.map((k, i) => (i === 0 ? `${k}=` : `${k}=x`)).join('\n') + '\n'
  const parsed = parseTaggedPayload(buf(`__GAPSSA_BACKUP_SCHEMA_VERSION__=active\n${body}`))
  const err = expectThrow(() => validateEntriesAgainstSchema(parsed.schemaVersion, parsed.entries))
  ok('clave obligatoria con valor vacío: rechazada', err instanceof BackupSchemaError && /vacía/.test(err.message))
}

// --- variable opcional puede faltar/estar vacía sin que el backup se rechace por eso ---
{
  const body = FULL_ACTIVE_BODY + 'NEXT_PUBLIC_UMAMI_SRC=\n' // opcional, closed-inventory, valor vacío permitido
  const parsed = parseTaggedPayload(buf(`__GAPSSA_BACKUP_SCHEMA_VERSION__=active\n${body}`))
  ok('una clave OPCIONAL con valor vacío no hace fallar la validación', !expectThrow(() => validateEntriesAgainstSchema(parsed.schemaVersion, parsed.entries)))
}

// --- restaurable en distintas fases: S2 (genérico) restaurable tanto en formato legacy como activo, con cuerpos COMPLETOS ---
{
  const activeParsed = parseTaggedPayload(buf(`__GAPSSA_BACKUP_SCHEMA_VERSION__=active\n${FULL_ACTIVE_BODY}`))
  const legacyParsed = parseTaggedPayload(buf(`__GAPSSA_BACKUP_SCHEMA_VERSION__=legacy-pre-s7\n${FULL_LEGACY_BODY}`))
  ok('POSTGRES_PASSWORD (S2) restaurable en formato activo', activeParsed.entries.has('POSTGRES_PASSWORD') && !expectThrow(() => validateEntriesAgainstSchema(activeParsed.schemaVersion, activeParsed.entries)))
  ok('POSTGRES_PASSWORD (S2) restaurable en formato legacy-pre-s7 (backup anterior a S7)', legacyParsed.entries.has('POSTGRES_PASSWORD') && !expectThrow(() => validateEntriesAgainstSchema(legacyParsed.schemaVersion, legacyParsed.entries)))
}

// --- inventoryForSchemaVersion / mandatoryKeysForSchemaVersion rechazan versión desconocida directamente ---
{
  const err = expectThrow(() => inventoryForSchemaVersion('no-existe'))
  ok('inventoryForSchemaVersion rechaza una versión no declarada', err instanceof BackupSchemaError)
}
{
  const err = expectThrow(() => mandatoryKeysForSchemaVersion('no-existe'))
  ok('mandatoryKeysForSchemaVersion rechaza una versión no declarada', err instanceof BackupSchemaError)
}

// --- ESPOCRM_API_KEY es condicional en la app real (env.ts) -> nunca obligatoria aquí ---
{
  ok('ESPOCRM_API_KEY no está en las obligatorias de "active" (es condicional en apps/web)', !MANDATORY_KEYS_ACTIVE.includes('ESPOCRM_API_KEY'))
  ok('ESPOCRM_API_KEY no está en las obligatorias de "legacy-pre-s7"', !MANDATORY_KEYS_LEGACY_PRE_S7.includes('ESPOCRM_API_KEY'))
}

// --- formato real del almacén: líneas vacías y comentarios se ignoran ---
{
  const parsed = parseTaggedPayload(buf('__GAPSSA_BACKUP_SCHEMA_VERSION__=active\n\n# comentario\nPOSTGRES_PASSWORD=valor-ficticio-000\n\n'))
  ok('líneas vacías y comentarios (#) se ignoran', parsed.entries.size === 1 && parsed.entries.get('POSTGRES_PASSWORD') === 'valor-ficticio-000')
}

// --- comentario/# después de un '=' en la misma línea: valor literal, sin recortar ---
{
  const parsed = parseTaggedPayload(buf('__GAPSSA_BACKUP_SCHEMA_VERSION__=active\nPOSTGRES_PASSWORD=valor#no-es-un-comentario\n'))
  ok('un "#" después de "=" es parte literal del valor, nunca se interpreta como comentario', parsed.entries.get('POSTGRES_PASSWORD') === 'valor#no-es-un-comentario')
}

// --- CRLF rechazado explícitamente, nunca normalizado en silencio ---
{
  const err = expectThrow(() => parseTaggedPayload(buf('__GAPSSA_BACKUP_SCHEMA_VERSION__=active\r\nPOSTGRES_PASSWORD=x\n')))
  ok('CRLF en la línea de etiqueta: rechazado con error claro', err instanceof BackupSchemaError)
}
{
  const err = expectThrow(() => parseTaggedPayload(buf('__GAPSSA_BACKUP_SCHEMA_VERSION__=active\nPOSTGRES_PASSWORD=x\r\n')))
  ok('CRLF en una línea del cuerpo: rechazado con error claro', err instanceof BackupSchemaError)
}

// --- última línea sin salto final: aceptada ---
{
  const parsed = parseTaggedPayload(buf('__GAPSSA_BACKUP_SCHEMA_VERSION__=active\nPOSTGRES_PASSWORD=valor-sin-newline-final'))
  ok('línea final sin newline: aceptada y con el valor correcto', parsed.entries.get('POSTGRES_PASSWORD') === 'valor-sin-newline-final')
}

// --- clave duplicada global (aunque no sea la buscada) ---
{
  const err = expectThrow(() =>
    parseTaggedPayload(buf('__GAPSSA_BACKUP_SCHEMA_VERSION__=active\nFOO=uno\nFOO=dos\nPOSTGRES_PASSWORD=x\n')),
  )
  ok('clave duplicada en cualquier parte del cuerpo: todo el backup se rechaza', err instanceof BackupSchemaError)
}

// --- byte NUL rechazado ---
{
  const err = expectThrow(() => parseTaggedPayload(Buffer.concat([buf('__GAPSSA_BACKUP_SCHEMA_VERSION__=active\nFOO='), Buffer.from([0]), buf('\n')])))
  ok('byte NUL: rechazado', err instanceof BackupSchemaError)
}

// --- claves obligatorias/repetidas de la propia etiqueta ---
{
  const err = expectThrow(() =>
    parseTaggedPayload(buf('__GAPSSA_BACKUP_SCHEMA_VERSION__=active\n__GAPSSA_BACKUP_SCHEMA_VERSION__=active\nFOO=bar\n')),
  )
  ok('la etiqueta de esquema repetida en el cuerpo se trata como clave reservada/duplicada', err instanceof BackupSchemaError)
}

// --- parsePlainEnvEntries: mismo formato pero SIN etiqueta (para validar $SECRETS_FILE antes de cifrar) ---
{
  const entries = parsePlainEnvEntries(buf(FULL_ACTIVE_BODY))
  ok('parsePlainEnvEntries tokeniza un fichero llano completo', entries.size === MANDATORY_KEYS_ACTIVE.length)
  ok('parsePlainEnvEntries + validateEntriesAgainstSchema: fichero llano completo pasa "active"', !expectThrow(() => validateEntriesAgainstSchema(ACTIVE_SCHEMA_VERSION, entries)))
}
{
  const err = expectThrow(() => parsePlainEnvEntries(buf('esto no es KEY=VALUE\n')))
  ok('parsePlainEnvEntries rechaza una línea mal formada igual que parseTaggedPayload', err instanceof BackupSchemaError)
}

summarizeAndExit()
