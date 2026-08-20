#!/usr/bin/env node
// Valida el $SECRETS_FILE PLANO (sin etiqueta de esquema) contra el
// inventario cerrado + claves obligatorias de una versión de esquema
// EXPLÍCITA — se invoca ANTES de cifrar cualquier backup nuevo, para que
// la versión que se le va a grabar como etiqueta sea coherente con el
// contenido real, nunca una etiqueta "active" puesta a ciegas sobre un
// archivo que en realidad todavía tiene forma legacy-pre-s7 (o
// viceversa). Nunca imprime contenido/valores, solo mensajes de error
// con número de línea/nombre de clave.
//
// Uso: node validateSecretsFileForBackup.mjs <secretsFilePath> <schemaVersion>
//   exit 0 = el contenido es válido para esa versión de esquema
//   exit 1 = uso incorrecto
//   exit 2 = contenido inválido para esa versión (mensaje en stderr)

import { readFileSync } from 'node:fs'
import { parsePlainEnvEntries, validateEntriesAgainstSchema, BackupSchemaError, KNOWN_SCHEMA_VERSIONS } from './backupSchema.mjs'

const [, , secretsFilePath, schemaVersion] = process.argv

if (!secretsFilePath || !schemaVersion) {
  console.error('Uso: validateSecretsFileForBackup.mjs <secretsFilePath> <schemaVersion>')
  process.exit(1)
}
if (!KNOWN_SCHEMA_VERSIONS.includes(schemaVersion)) {
  console.error(`Versión de esquema desconocida: "${schemaVersion}".`)
  process.exit(1)
}

try {
  const buffer = readFileSync(secretsFilePath)
  const entries = parsePlainEnvEntries(buffer)
  validateEntriesAgainstSchema(schemaVersion, entries)
} catch (err) {
  if (err instanceof BackupSchemaError) {
    console.error(err.message)
    process.exit(2)
  }
  console.error(`ERROR al validar el archivo externo: ${err.message}`)
  process.exit(2)
}

process.exit(0)
