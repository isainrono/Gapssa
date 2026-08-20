#!/usr/bin/env node
// Extrae UNA variable del contenido de un almacén externo VIVO (formato
// KEY=value plano, sin etiqueta de esquema de backup — a diferencia de
// extractEnvValueFromStdin.mjs, que exige la etiqueta
// __GAPSSA_BACKUP_SCHEMA_VERSION__ propia de un backup descifrado y por
// tanto NO sirve contra ~/.gapssa-secrets/.env.gapssa en caliente).
// Sustituye la tubería `grep '^KEY=' | tail -n1 | cut -d= -f2-`, que
// aceptaba en silencio duplicados (quedándose con el último) y líneas mal
// formadas.
//
// Uso: node extractLiveEnvValueFromStdin.mjs <VAR_NAME>
//   stdin:  contenido completo del almacén externo vivo.
//   stdout: SOLO el valor de <VAR_NAME>, bytes exactos (sin recortar
//           nada salvo el salto de línea final de la propia línea), sin
//           ruido adicional.
//   stderr: descripción del error (número de línea, nunca contenido de
//           línea ni valor).
//
// Gramática aceptada por línea:
//   - línea vacía: se ignora.
//   - línea que empieza por '#': comentario, se ignora (nunca se imprime).
//   - en cualquier otro caso: ^[A-Za-z_][A-Za-z0-9_]*=.*$ estricto — el
//     valor es todo lo que sigue al primer '=', literal, sin comillas ni
//     interpolación. Cualquier línea que no case con esta forma es un
//     fichero mal formado (fichero truncado a mitad de una clave, sin
//     '=', etc.).
//   - claves "legacy" no relacionadas con VAR_NAME son válidas y se
//     ignoran (nunca se imprimen, ni su nombre ni su valor).
//
// Códigos de salida:
//   0 = valor encontrado e impreso
//   1 = error de uso (argv ausente/inválido)
//   2 = error de parseo (NUL, CR/LF, línea mal formada, clave duplicada,
//       valor vacío)
//   3 = la variable solicitada no está presente en la entrada
//
// El llamador (bash) DEBE hacer `unset`/limpiar el valor capturado justo
// después de usarlo — este script no puede imponer eso desde fuera de su
// propio proceso.

const varName = process.argv[2]

if (!varName || !/^[A-Z_][A-Z0-9_]*$/.test(varName)) {
  console.error('Uso: extractLiveEnvValueFromStdin.mjs <VAR_NAME> (VAR_NAME debe ser MAYUSCULA_CON_GUIONES_BAJOS)')
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

const buf = Buffer.concat(chunks)

if (buf.includes(0x00)) {
  console.error('ERROR: la entrada contiene un byte NUL — almacén corrupto.')
  process.exit(2)
}

if (buf.includes(0x0d)) {
  console.error('ERROR: la entrada contiene CR (CRLF) — formato no admitido para el almacén vivo.')
  process.exit(2)
}

const text = buf.toString('utf8')
// Un fichero vacío no tiene ninguna línea que analizar; se trata como
// "sin líneas", no como línea única vacía.
const rawLines = text.length === 0 ? [] : text.split('\n')
// split('\n') deja un último elemento '' cuando el fichero termina en
// salto de línea — no es una línea "de más", es el final normal del
// fichero. Solo lo descartamos si está realmente vacío.
if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
  rawLines.pop()
}

const LINE_RE = /^[A-Za-z_][A-Za-z0-9_]*=.*$/
const entries = new Map()

for (let i = 0; i < rawLines.length; i += 1) {
  const line = rawLines[i]
  const lineNo = i + 1
  if (line === '') continue
  if (line.startsWith('#')) continue
  if (!LINE_RE.test(line)) {
    console.error(`ERROR: línea ${lineNo} del almacén no tiene forma KEY=value válida.`)
    process.exit(2)
  }
  const eq = line.indexOf('=')
  const key = line.slice(0, eq)
  const value = line.slice(eq + 1)
  if (entries.has(key)) {
    console.error(`ERROR: clave "${key}" aparece más de una vez en el almacén — entrada ambigua.`)
    process.exit(2)
  }
  entries.set(key, value)
}

if (!entries.has(varName)) {
  console.error(`Variable "${varName}" no encontrada en la entrada.`)
  process.exit(3)
}

const value = entries.get(varName)
if (value === '') {
  console.error(`ERROR: "${varName}" está presente pero con valor vacío.`)
  process.exit(2)
}

process.stdout.write(value)
process.exit(0)
