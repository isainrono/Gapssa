#!/usr/bin/env node
// Enumera temporales huérfanos de una restauración anterior interrumpida
// — sustituye un `for f in $glob` en bash, que rompe con espacios y
// caracteres especiales en nombres de fichero y no distingue de forma
// fiable un symlink de un fichero regular sin comandos aparte. Usa
// `readdirSync` (nunca expansión de shell) y `lstatSync` (NUNCA sigue un
// symlink) para cada candidato.
//
// Uso: node scanOrphanRestoreTmp.mjs <targetDir> <secretsFileBasename>
//   stdout: CAMPOS INDEPENDIENTES, cada uno terminado en byte NUL
//           (0x00), en grupos de SEIS por huérfano encontrado, en este
//           orden fijo: tipo, ruta, dev, ino, uid, modo-octal.
//
// Por qué NUL como único delimitador y por qué NUNCA un delimitador
// "empaquetado" dentro de un campo: en un componente de ruta POSIX los
// ÚNICOS bytes prohibidos son NUL y "/" — CUALQUIER otro byte (salto de
// línea, tabulador, comillas, separador de unidad ASCII \x1f, etc.) es
// válido dentro de un nombre de fichero real. Unir varios campos en una
// sola cadena con un delimitador "que se supone que nunca aparece en una
// ruta" es, por tanto, siempre falso en general — una ruta que
// contuviera ese byte se partiría en campos de más al desempaquetarla.
// La única forma correcta es que CADA campo (tipo/ruta/dev/ino/uid/modo)
// sea un elemento de flujo INDEPENDIENTE, terminado en el único byte que
// de verdad no puede aparecer en un nombre de fichero: NUL. `<tipo>` es
// "symlink", "regular" u "other" (fifo/socket/etc. — se reporta pero
// nunca se toca). Nunca imprime contenido de ningún fichero, solo
// metadatos de ruta.
//
// Patrón CERRADO (debe coincidir exactamente con el que usa
// lib.sh::gapssa_secrets_mktemp_secure_same_dir para crear estos
// temporales): ".<secretsFileBasename>.restore-XXXXXXXX" — XXXXXXXX es
// la parte aleatoria de `mktemp`, cualquier sufijo de caracteres
// "seguros" de nombre de fichero.

import { readdirSync, lstatSync } from 'node:fs'
import path from 'node:path'

const [, , targetDir, secretsFileBasename] = process.argv

if (!targetDir || !secretsFileBasename) {
  console.error('Uso: scanOrphanRestoreTmp.mjs <targetDir> <secretsFileBasename>')
  process.exit(1)
}

const prefix = `.${secretsFileBasename}.restore-`

function writeField(value) {
  process.stdout.write(value + '\0')
}

let entries
try {
  entries = readdirSync(targetDir)
} catch (err) {
  console.error(`ERROR al listar '${targetDir}': ${err.message}`)
  process.exit(1)
}

for (const name of entries) {
  if (!name.startsWith(prefix)) continue
  const fullPath = path.join(targetDir, name)
  let st
  try {
    st = lstatSync(fullPath)
  } catch {
    continue // desapareció entre el readdir y el lstat — nada que reportar
  }
  let type = 'other'
  if (st.isSymbolicLink()) type = 'symlink'
  else if (st.isFile()) type = 'regular'
  writeField(type)
  writeField(fullPath)
  writeField(String(st.dev))
  writeField(String(st.ino))
  writeField(String(st.uid))
  writeField((st.mode & 0o777).toString(8))
}
process.exit(0)
