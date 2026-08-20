#!/usr/bin/env node
// Pruebas de lib/scanOrphanRestoreTmp.mjs + lib/removeOrphanTmp.mjs —
// enumeración sin `for f in $glob` (nombres de fichero arbitrarios
// incluidos: espacios, \x1f, saltos de línea, tabs, comillas,
// metacaracteres de shell) y retirada segura (nunca sigue symlinks,
// aborta ante sustitución).
//
// PROTOCOLO probado aquí: scanOrphanRestoreTmp.mjs emite campos
// INDEPENDIENTES terminados en NUL (0x00) — nunca varios campos unidos
// con otro delimitador — porque NUL es el único byte que NUNCA puede
// aparecer en un nombre de fichero POSIX (el otro byte prohibido, "/",
// no puede aparecer en un nombre de fichero por definición del propio
// sistema de directorios). Los 6 campos de cada huérfano llegan en
// grupos consecutivos: tipo, ruta, dev, ino, uid, modo.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, symlinkSync, unlinkSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ok, summarizeAndExit } from './testHarness.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCAN = path.join(HERE, 'scanOrphanRestoreTmp.mjs')
const REMOVE = path.join(HERE, 'removeOrphanTmp.mjs')

function scan(dir, basename) {
  const res = spawnSync(process.execPath, [SCAN, dir, basename], { encoding: 'buffer' })
  const fields = res.stdout.toString('utf8').split('\0')
  fields.pop() // el último elemento es siempre '' (tras el NUL final) — se descarta, no es un campo real
  if (fields.length % 6 !== 0) {
    throw new Error(`protocolo de prueba: número de campos no múltiplo de 6 (${fields.length}) — el propio escáner está mal, no el test`)
  }
  const records = []
  for (let i = 0; i < fields.length; i += 6) {
    const [type, p, dev, ino, uid, mode] = fields.slice(i, i + 6)
    records.push({ type, path: p, dev, ino, uid, mode })
  }
  return records
}

function remove(rec) {
  return spawnSync(process.execPath, [REMOVE, rec.path, rec.type, rec.dev, rec.ino], { encoding: 'utf8' })
}

const dir = mkdtempSync(path.join(tmpdir(), 'gapssa-orphan-test-'))
const basename = '.env.gapssa'
const prefix = `.${basename}.restore-`

// --- ruta CON ESPACIOS: el escaneo la enumera correctamente ---
{
  const p = path.join(dir, `${prefix}con espacios y más`)
  writeFileSync(p, 'contenido-ficticio', { mode: 0o600 })
  const records = scan(dir, basename)
  const found = records.find((r) => r.path === p)
  ok('ruta con espacios: detectada correctamente por el escaneo', Boolean(found) && found.type === 'regular')
  if (found) {
    const res = remove(found)
    ok('ruta con espacios: retirada con éxito', res.status === 0 && !existsSync(p))
  }
}

// --- rutas con caracteres "peligrosos": cada una se escanea, retira, y
// NUNCA deja un marcador de inyección ni toca nada fuera de su propio
// inodo. Cubre: byte \x1f, salto de línea, tab, comillas simples/dobles,
// $(), backticks, punto y coma, ampersand.
const dangerousNames = {
  'byte \\x1f': `${prefix}con\x1fseparador`,
  'salto de línea': `${prefix}con\nsalto`,
  tab: `${prefix}con\ttab`,
  "comilla simple (')": `${prefix}con'comilla`,
  'comilla doble (")': `${prefix}con"comilla`,
  '$() sustitución de comando': `${prefix}con$(marker)`,
  'backticks': `${prefix}con\`marker\``,
  'punto y coma (;)': `${prefix}con;marker`,
  'ampersand (&)': `${prefix}con&marker`,
}

for (const [label, name] of Object.entries(dangerousNames)) {
  const p = path.join(dir, name)
  const marker = path.join(dir, `INJECTION-MARKER-${Buffer.from(name).toString('hex').slice(0, 8)}`)
  try {
    writeFileSync(p, 'contenido-ficticio', { mode: 0o600 })
  } catch (err) {
    ok(`ruta con ${label}: el filesystem la acepta (creación previa a la prueba)`, false)
    console.error(`  (fallo al crear fixture: ${err.message})`)
    continue
  }
  const records = scan(dir, basename)
  const found = records.find((r) => r.path === p)
  ok(`ruta con ${label}: detectada como UN solo registro (nombre nunca partido en campos de más)`, Boolean(found) && found.type === 'regular')
  if (found) {
    const res = remove(found)
    ok(`ruta con ${label}: retirada con éxito`, res.status === 0 && !existsSync(p))
  }
  ok(`ruta con ${label}: nunca se creó ningún marcador de inyección`, !existsSync(marker))
}

// --- symlink con nombre que contiene \x1f ---
{
  const realTarget = path.join(dir, 'objetivo-real-x1f.txt')
  writeFileSync(realTarget, 'CONTENIDO-QUE-DEBE-SOBREVIVIR-X1F')
  const link = path.join(dir, `${prefix}symlink\x1fcon-separador`)
  symlinkSync(realTarget, link)
  const records = scan(dir, basename)
  const found = records.find((r) => r.path === link)
  ok('symlink con \\x1f en el nombre: tipo detectado correctamente', Boolean(found) && found.type === 'symlink')
  if (found) {
    const res = remove(found)
    ok('symlink con \\x1f en el nombre: retirado (solo el enlace)', res.status === 0 && !existsSync(link))
    ok('symlink con \\x1f en el nombre: el destino real sobrevive intacto', readFileSync(realTarget, 'utf8') === 'CONTENIDO-QUE-DEBE-SOBREVIVIR-X1F')
  }
}

// --- fichero regular con salto de línea en el nombre ---
{
  const p = path.join(dir, `${prefix}regular\ncon-salto-de-linea`)
  writeFileSync(p, 'contenido-ficticio-newline', { mode: 0o600 })
  const records = scan(dir, basename)
  const found = records.find((r) => r.path === p)
  ok('fichero regular con salto de línea en el nombre: detectado como UN registro', Boolean(found) && found.type === 'regular')
  if (found) {
    const res = remove(found)
    ok('fichero regular con salto de línea: retirado con éxito', res.status === 0 && !existsSync(p))
  }
}

// --- argumento vacío no aplica aquí (una ruta nunca es la cadena vacía),
// pero un símbolo con TODOS los campos numéricos en cero es un caso
// límite legítimo — se comprueba que el formato se acepta igualmente.
{
  const p = path.join(dir, `${prefix}caso-limite`)
  writeFileSync(p, 'x', { mode: 0o600 })
  const records = scan(dir, basename)
  const found = records.find((r) => r.path === p)
  ok('caso límite: dev/ino/uid/modo son cadenas numéricas no vacías', Boolean(found) && found.dev !== '' && found.ino !== '' && found.uid !== '' && found.mode !== '')
  if (found) remove(found)
}

// --- huérfano symlink: tipo correcto, retirada solo del enlace ---
{
  const realTarget = path.join(dir, 'objetivo-real.txt')
  writeFileSync(realTarget, 'CONTENIDO-QUE-DEBE-SOBREVIVIR')
  const link = path.join(dir, `${prefix}symlink-AAAA`)
  symlinkSync(realTarget, link)
  const records = scan(dir, basename)
  const found = records.find((r) => r.path === link)
  ok('huérfano symlink: tipo detectado correctamente', Boolean(found) && found.type === 'symlink')
  if (found) {
    const res = remove(found)
    ok('huérfano symlink: retirado (solo el enlace)', res.status === 0 && !existsSync(link))
    ok('huérfano symlink: el destino real sobrevive intacto', readFileSync(realTarget, 'utf8') === 'CONTENIDO-QUE-DEBE-SOBREVIVIR')
  }
}

// --- huérfano SUSTITUIDO por un symlink ENTRE el escaneo y la retirada ---
{
  const p = path.join(dir, `${prefix}sera-sustituido`)
  writeFileSync(p, 'contenido-original', { mode: 0o600 })
  const records = scan(dir, basename)
  const found = records.find((r) => r.path === p)
  ok('pre-condición: escaneado como regular', Boolean(found) && found.type === 'regular')
  // Sustitución: se borra y se reemplaza por un symlink hacia otro sitio
  // ANTES de que remove() se ejecute — simula una carrera real.
  const decoy = path.join(dir, 'decoy-target.txt')
  writeFileSync(decoy, 'CONTENIDO-DECOY-NUNCA-DEBE-TOCARSE')
  unlinkSync(p)
  symlinkSync(decoy, p)
  const res = remove(found) // found.type sigue siendo "regular" (el pin del escaneo)
  ok('fichero sustituido por symlink antes de retirar: ABORTADO (exit 2)', res.status === 2)
  ok('fichero sustituido: el decoy nunca se toca', readFileSync(decoy, 'utf8') === 'CONTENIDO-DECOY-NUNCA-DEBE-TOCARSE')
  ok('fichero sustituido: el symlink de sustitución sigue ahí intacto (no se borró nada)', existsSync(p))
}

// --- huérfano SUSTITUIDO por otro fichero regular (inodo distinto) ---
{
  const p = path.join(dir, `${prefix}cambio-de-inodo`)
  writeFileSync(p, 'contenido-original-2', { mode: 0o600 })
  const records = scan(dir, basename)
  const found = records.find((r) => r.path === p)
  unlinkSync(p)
  writeFileSync(p, 'CONTENIDO-NUEVO-QUE-NO-DEBE-SOBRESCRIBIRSE', { mode: 0o600 })
  const res = remove(found)
  ok('cambio de inodo bajo la misma ruta: ABORTADO (exit 2)', res.status === 2)
  ok('cambio de inodo: el contenido nuevo sobrevive sin tocar', readFileSync(p, 'utf8') === 'CONTENIDO-NUEVO-QUE-NO-DEBE-SOBRESCRIBIRSE')
}

// --- escaneo ignora ficheros que no siguen el patrón cerrado ---
{
  writeFileSync(path.join(dir, 'no-deberia-aparecer.txt'), 'x')
  const records = scan(dir, basename)
  ok('el escaneo nunca reporta ficheros fuera del patrón cerrado', !records.some((r) => r.path.endsWith('no-deberia-aparecer.txt')))
}

// --- remove rechaza tipo/argv inválido ---
{
  const res = spawnSync(process.execPath, [REMOVE, path.join(dir, 'x'), 'other', '1', '1'], { encoding: 'utf8' })
  ok('tipo "other" (ni symlink ni regular): rechazado por argv (exit 1)', res.status === 1)
}

rmSync(dir, { recursive: true, force: true })
summarizeAndExit()
