// scripts/secrets-rotation/probes/shared/secureArtifact.mts
//
// E/S segura del artefacto reanudable de S6 (packages/contracts-free —
// solo Node built-ins). Sustituye el patrón anterior de
// `printf > file; chmod 600` desde bash: el contenido del artefacto
// (código OTP, JWT firmado con el PAYLOAD_SECRET anterior) nunca pasa
// por la captura `$(...)` de bash ni por ninguna variable de bash — se
// escribe/lee directamente desde este módulo Node.
//
// Todas las operaciones exigen:
//   - `targetPath` resuelto dentro de EXACTAMENTE `allowedDir` (nunca
//     "en cualquier sitio fuera de apps/web") — comprobado con
//     `realpath` + `path.relative`, nunca `startsWith` sobre cadenas
//     crudas (vulnerable a prefijos parecidos, p.ej.
//     "/Users/x/Gapssa-backup" frente a "/Users/x/Gapssa");
//   - `allowedDir` en sí mismo, ya resuelto, fuera de todo REPO_ROOT
//     (nunca se confía en él solo porque el llamador lo pasó);
//   - nunca seguir un symlink (`O_NOFOLLOW` en cada apertura, `lstat`
//     antes de `open` cuando aplica);
//   - nunca sobrescribir/adoptar/borrar un fichero cuya identidad no se
//     pudo confirmar completa.
//
// Nunca imprime el contenido del artefacto — solo códigos de estado
// cerrados (`'absent' | 'valid' | 'invalid'`, `boolean`) suben hasta las
// sondas que envuelven este módulo.

import {
  realpathSync,
  openSync,
  closeSync,
  fstatSync,
  lstatSync,
  readSync,
  writeSync,
  fsyncSync,
  unlinkSync,
  constants as fsConstants,
  type Stats,
} from 'node:fs'
import path from 'node:path'

const MAX_ARTIFACT_BYTES = 4096

export class ArtifactConfigError extends Error {}
export class ArtifactDataError extends Error {}

function isInsideOrEqual(candidateReal: string, rootReal: string): boolean {
  if (candidateReal === rootReal) return true
  const rel = path.relative(rootReal, candidateReal)
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)
}

// Contrato fijo: run-tsx.mjs SIEMPRE fija cwd=apps/web al lanzar estas
// sondas — repoRoot se deriva de ahí, nunca de una variable nueva.
function resolveRepoRootReal(): string {
  return realpathSync(path.resolve(process.cwd(), '..', '..'))
}

/**
 * Verifica que `targetPath` resuelva exactamente dentro de `allowedDir`
 * (ya resuelto y confirmado externo al repositorio) — nunca "en algún
 * sitio fuera de apps/web". Lanza `ArtifactConfigError` (nunca continúa
 * con una duda) ante cualquier discrepancia. Devuelve el directorio
 * padre real ya validado.
 */
export function assertArtifactPathAllowed(targetPath: string, allowedDir: string): string {
  const repoRootReal = resolveRepoRootReal()

  let allowedDirReal: string
  try {
    allowedDirReal = realpathSync(allowedDir)
  } catch {
    throw new ArtifactConfigError('CONFIG_ERROR: el directorio de artefactos configurado no existe.')
  }
  if (isInsideOrEqual(allowedDirReal, repoRootReal)) {
    throw new ArtifactConfigError('CONFIG_ERROR: el directorio de artefactos configurado está dentro del repositorio.')
  }

  const parentDir = path.dirname(path.resolve(targetPath))
  let realParentDir: string
  try {
    realParentDir = realpathSync(parentDir)
  } catch {
    throw new ArtifactConfigError('CONFIG_ERROR: el directorio padre del artefacto no existe.')
  }
  if (isInsideOrEqual(realParentDir, repoRootReal)) {
    throw new ArtifactConfigError('CONFIG_ERROR: la ruta del artefacto cae dentro del repositorio.')
  }
  if (realParentDir !== allowedDirReal) {
    throw new ArtifactConfigError('CONFIG_ERROR: la ruta del artefacto no está dentro del directorio de artefactos permitido.')
  }
  return realParentDir
}

function validateSchema(parsed: unknown, expectedSchemaVersion: number, expectedKeys: readonly string[]): asserts parsed is Record<string, unknown> {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ArtifactDataError('DATA_ERROR: el contenido del artefacto no es un objeto JSON.')
  }
  const record = parsed as Record<string, unknown>
  if (record.schemaVersion !== expectedSchemaVersion) {
    throw new ArtifactDataError('DATA_ERROR: versión de esquema del artefacto inesperada.')
  }
  const actualKeys = new Set(Object.keys(record))
  const wantedKeys = new Set([...expectedKeys, 'schemaVersion'])
  if (actualKeys.size !== wantedKeys.size || [...wantedKeys].some((k) => !actualKeys.has(k))) {
    throw new ArtifactDataError('DATA_ERROR: el conjunto de claves del artefacto no coincide con el esperado.')
  }
}

/**
 * Escribe el artefacto en exclusiva — nunca sobrescribe uno existente.
 * `O_EXCL` + `O_NOFOLLOW`, modo 0o600, `fstat` de fichero regular antes
 * de escribir, `fsync` antes de cerrar.
 */
export function writeArtifactExclusive(targetPath: string, allowedDir: string, schemaVersion: number, data: Record<string, unknown>): void {
  assertArtifactPathAllowed(targetPath, allowedDir)
  const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW
  let fd: number
  try {
    fd = openSync(targetPath, flags, 0o600)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? 'error'
    throw new ArtifactDataError(`DATA_ERROR: no se pudo crear el artefacto en exclusiva (${code}).`)
  }
  try {
    const st = fstatSync(fd)
    if (!st.isFile()) {
      throw new ArtifactDataError('DATA_ERROR: el descriptor recién creado no es un fichero regular.')
    }
    const payload = Buffer.from(JSON.stringify({ schemaVersion, ...data }), 'utf8')
    let offset = 0
    while (offset < payload.length) {
      offset += writeSync(fd, payload, offset, payload.length - offset)
    }
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/**
 * Lee y valida el artefacto para su consumo real (los valores nunca se
 * exponen por stdout de quien llama a esta función — solo se usan
 * internamente para la lógica de verificación).
 */
export function readArtifactStrict(
  targetPath: string,
  allowedDir: string,
  expectedSchemaVersion: number,
  expectedKeys: readonly string[],
): Record<string, unknown> {
  assertArtifactPathAllowed(targetPath, allowedDir)
  const flags = fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
  let fd: number
  try {
    fd = openSync(targetPath, flags)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? 'error'
    throw new ArtifactDataError(`DATA_ERROR: no se pudo abrir el artefacto (${code}).`)
  }
  try {
    const st = fstatSync(fd)
    if (!st.isFile()) throw new ArtifactDataError('DATA_ERROR: el artefacto no es un fichero regular.')
    if ((st.mode & 0o777) !== 0o600) throw new ArtifactDataError('DATA_ERROR: el artefacto no tiene el modo esperado.')
    if (st.size <= 0 || st.size > MAX_ARTIFACT_BYTES) throw new ArtifactDataError('DATA_ERROR: el artefacto tiene un tamaño inesperado.')
    const buf = Buffer.alloc(st.size)
    readSync(fd, buf, 0, st.size, 0)
    let parsed: unknown
    try {
      parsed = JSON.parse(buf.toString('utf8'))
    } catch {
      throw new ArtifactDataError('DATA_ERROR: el artefacto no contiene JSON válido.')
    }
    validateSchema(parsed, expectedSchemaVersion, expectedKeys)
    return parsed
  } finally {
    closeSync(fd)
  }
}

export type ArtifactStatus = 'absent' | 'valid' | 'invalid'

function lstatOrNull(p: string): Stats | null {
  try {
    return lstatSync(p)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new ArtifactDataError('DATA_ERROR: no se pudo inspeccionar la ruta del artefacto.')
  }
}

/**
 * Inspecciona el artefacto sin tocarlo — nunca escribe, nunca borra.
 * `'absent'` si no existe; `'invalid'` ante cualquier discrepancia de
 * identidad/tipo/modo/propietario/tamaño/esquema (nunca se retira aquí);
 * `'valid'` solo si todas las comprobaciones pasan.
 */
export function inspectArtifact(
  targetPath: string,
  allowedDir: string,
  expectedSchemaVersion: number,
  expectedKeys: readonly string[],
): ArtifactStatus {
  assertArtifactPathAllowed(targetPath, allowedDir)
  const lst = lstatOrNull(targetPath)
  if (lst === null) return 'absent'
  if (lst.isSymbolicLink()) return 'invalid'
  if (!lst.isFile()) return 'invalid'

  let fd: number
  try {
    fd = openSync(targetPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
  } catch {
    return 'invalid'
  }
  try {
    const fst = fstatSync(fd)
    if (fst.dev !== lst.dev || fst.ino !== lst.ino) return 'invalid'
    if ((fst.mode & 0o777) !== 0o600) return 'invalid'
    if (typeof process.getuid === 'function' && fst.uid !== process.getuid()) return 'invalid'
    if (fst.size <= 0 || fst.size > MAX_ARTIFACT_BYTES) return 'invalid'
    const buf = Buffer.alloc(fst.size)
    readSync(fd, buf, 0, fst.size, 0)
    let parsed: unknown
    try {
      parsed = JSON.parse(buf.toString('utf8'))
    } catch {
      return 'invalid'
    }
    try {
      validateSchema(parsed, expectedSchemaVersion, expectedKeys)
    } catch {
      return 'invalid'
    }
    return 'valid'
  } finally {
    closeSync(fd)
  }
}

/**
 * Retira el artefacto — SOLO si su identidad completa se confirma dos
 * veces (antes de leer y justo antes de `unlink`). Nunca sobrescribe,
 * nunca adopta, nunca sigue un symlink. Lanza `ArtifactDataError` (sin
 * tocar el fichero) ante cualquier discrepancia — el llamador debe
 * tratar eso como "la retirada no se completó", nunca como éxito.
 * Devuelve `true` si retiró un fichero válido, `false` si la ruta ya
 * estaba ausente (nada que retirar).
 */
export function removeArtifactStrict(
  targetPath: string,
  allowedDir: string,
  expectedSchemaVersion: number,
  expectedKeys: readonly string[],
): boolean {
  assertArtifactPathAllowed(targetPath, allowedDir)
  const lst = lstatOrNull(targetPath)
  if (lst === null) return false
  if (lst.isSymbolicLink() || !lst.isFile()) {
    throw new ArtifactDataError('DATA_ERROR: la ruta no es un fichero regular válido — retirada abortada, no se toca.')
  }

  let fd: number
  try {
    fd = openSync(targetPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
  } catch {
    throw new ArtifactDataError('DATA_ERROR: no se pudo abrir para verificar antes de retirar — retirada abortada.')
  }
  try {
    const fst = fstatSync(fd)
    if (fst.dev !== lst.dev || fst.ino !== lst.ino) {
      throw new ArtifactDataError('DATA_ERROR: identidad cambió entre lstat y open — retirada abortada, no se toca.')
    }
    if ((fst.mode & 0o777) !== 0o600) {
      throw new ArtifactDataError('DATA_ERROR: modo inesperado — retirada abortada, no se toca.')
    }
    if (typeof process.getuid === 'function' && fst.uid !== process.getuid()) {
      throw new ArtifactDataError('DATA_ERROR: propietario inesperado — retirada abortada, no se toca.')
    }
    if (fst.size <= 0 || fst.size > MAX_ARTIFACT_BYTES) {
      throw new ArtifactDataError('DATA_ERROR: tamaño inesperado — retirada abortada, no se toca.')
    }
    const buf = Buffer.alloc(fst.size)
    readSync(fd, buf, 0, fst.size, 0)
    let parsed: unknown
    try {
      parsed = JSON.parse(buf.toString('utf8'))
    } catch {
      throw new ArtifactDataError('DATA_ERROR: JSON inválido — retirada abortada, no se toca.')
    }
    validateSchema(parsed, expectedSchemaVersion, expectedKeys)
  } finally {
    closeSync(fd)
  }

  // Re-lstat justo antes de unlink — confirma que nada sustituyó la ruta
  // entre la verificación completa de arriba y este instante.
  const lst2 = lstatOrNull(targetPath)
  if (lst2 === null || lst2.isSymbolicLink() || !lst2.isFile() || lst2.dev !== lst.dev || lst2.ino !== lst.ino) {
    throw new ArtifactDataError('DATA_ERROR: identidad cambió justo antes de la retirada — abortada, no se toca.')
  }
  unlinkSync(targetPath)
  return true
}
