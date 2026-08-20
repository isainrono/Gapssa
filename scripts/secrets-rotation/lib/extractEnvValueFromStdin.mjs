#!/usr/bin/env node
// Extrae UNA variable del contenido descifrado (por stdin) de un backup
// de scripts/secrets-rotation/ — sustituye la tubería previa
// `openssl ... | grep "^${var}=" | tail -n1 | cut -d= -f2-`, que no
// detectaba claves duplicadas ni líneas mal formadas.
//
// Uso: node extractEnvValueFromStdin.mjs <VAR_NAME>
//   stdin:  contenido descifrado completo de un backup (con su etiqueta
//           de versión de esquema como primera línea — ver
//           lib/backupSchema.mjs).
//   stdout: SOLO el valor de <VAR_NAME>, sin ruido adicional.
//   stderr: descripción del error (número de línea / nombre de clave),
//           NUNCA un valor.
//
// Códigos de salida:
//   0 = valor encontrado e impreso
//   1 = error de uso (argv ausente/inválido)
//   2 = error de parseo (línea mal formada, clave duplicada, CRLF, NUL,
//       etiqueta de esquema ausente/desconocida)
//   3 = la variable solicitada no está presente en el backup
//
// El llamador (bash) DEBE hacer `unset` del valor capturado justo
// después de usarlo — este script no puede imponer eso desde fuera de su
// propio proceso, es un requisito del lado del llamador.

import { parseTaggedPayload, BackupSchemaError } from './backupSchema.mjs'

const varName = process.argv[2]

if (!varName || !/^[A-Z_][A-Z0-9_]*$/.test(varName)) {
  console.error('Uso: extractEnvValueFromStdin.mjs <VAR_NAME> (VAR_NAME debe ser MAYUSCULA_CON_GUIONES_BAJOS)')
  process.exit(1)
}

const chunks = []
try {
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
} catch (err) {
  console.error(`ERROR al leer stdin: ${err.message}`)
  process.exit(2)
}

let parsed
try {
  parsed = parseTaggedPayload(Buffer.concat(chunks))
} catch (err) {
  if (err instanceof BackupSchemaError) {
    console.error(err.message)
    process.exit(2)
  }
  console.error(`ERROR inesperado al parsear la entrada: ${err.message}`)
  process.exit(2)
}

if (!parsed.entries.has(varName)) {
  console.error(`Variable "${varName}" no encontrada en la entrada.`)
  process.exit(3)
}

process.stdout.write(parsed.entries.get(varName))
process.exit(0)
