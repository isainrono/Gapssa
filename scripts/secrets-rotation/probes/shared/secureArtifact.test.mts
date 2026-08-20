// scripts/secrets-rotation/probes/shared/secureArtifact.test.mts
//
// Pruebas de secureArtifact.mts: límites de ruta (realpath + boundary
// check correcto, nunca startsWith ingenuo) y protocolo de
// escritura-exclusiva / lectura-estricta / inspección / retirada-estricta.
//
// Ejecutar: node --import tsx scripts/secrets-rotation/probes/shared/secureArtifact.test.mts
//
// Construye un árbol de repositorio FALSO bajo un directorio temporal
// (nunca toca el repositorio real) con la misma forma que
// assertArtifactPathAllowed asume (cwd = <repoRoot>/apps/web, ya que
// run-tsx.mjs siempre fija ese cwd) — se hace chdir() a esa carpeta
// falsa durante la prueba y se restaura al terminar, en un `finally`.

import { mkdtempSync, mkdirSync, symlinkSync, rmSync, realpathSync, statSync, existsSync, chmodSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { assertArtifactPathAllowed, writeArtifactExclusive, readArtifactStrict, inspectArtifact, removeArtifactStrict } from './secureArtifact.mts'
import { ok, summarizeAndExit } from '../../lib/testHarness.mjs'

function expectThrow(fn: () => unknown): unknown {
  try {
    fn()
    return null
  } catch (err) {
    return err
  }
}

const SCHEMA_VERSION = 1
const KEYS = ['subjectRef', 'code', 'payloadJwt'] as const

const workDir = realpathSync(mkdtempSync(path.join(realpathSync(tmpdir()), 'gapssa-secureartifact-test-')))
const fakeRepoRoot = path.join(workDir, 'repo')
const fakeAppsWeb = path.join(fakeRepoRoot, 'apps', 'web')
const fakeScripts = path.join(fakeRepoRoot, 'scripts')
const fakeDocs = path.join(fakeRepoRoot, 'docs')
mkdirSync(fakeAppsWeb, { recursive: true })
mkdirSync(fakeScripts, { recursive: true })
mkdirSync(fakeDocs, { recursive: true })

const externalAllowedDir = path.join(workDir, 'external-secrets', 'tmp')
mkdirSync(externalAllowedDir, { recursive: true })

// Directorio con prefijo parecido al repo pero genuinamente HERMANO (no
// descendiente) — nunca debe confundirse con "dentro" por una
// comparación de prefijo ingenua.
const prefixSimilarDir = `${fakeRepoRoot}-backup`
mkdirSync(prefixSimilarDir, { recursive: true })

// Symlink que vive FUERA del árbol del repo pero cuyo DESTINO resuelve
// DENTRO (apps/web) — debe rechazarse aunque la ruta "aparente" esté
// fuera.
const externalSymlinkParent = path.join(workDir, 'external-symlink-parent')
mkdirSync(externalSymlinkParent, { recursive: true })
const symlinkIntoRepo = path.join(externalSymlinkParent, 'points-into-repo')
symlinkSync(fakeAppsWeb, symlinkIntoRepo)

const originalCwd = process.cwd()
process.chdir(fakeAppsWeb)

try {
  // --- 3.1: límites de ruta ---

  {
    const err = expectThrow(() => assertArtifactPathAllowed(path.join(fakeAppsWeb, 'x.json'), fakeAppsWeb))
    ok('apps/web como directorio de artefactos: rechazado', err instanceof Error && /repositorio/.test(err.message))
  }
  {
    const err = expectThrow(() => assertArtifactPathAllowed(path.join(fakeScripts, 'x.json'), fakeScripts))
    ok('scripts/ como directorio de artefactos: rechazado', err instanceof Error && /repositorio/.test(err.message))
  }
  {
    const err = expectThrow(() => assertArtifactPathAllowed(path.join(fakeDocs, 'x.json'), fakeDocs))
    ok('docs/ como directorio de artefactos: rechazado', err instanceof Error && /repositorio/.test(err.message))
  }
  {
    const err = expectThrow(() => assertArtifactPathAllowed(path.join(fakeRepoRoot, 'x.json'), fakeRepoRoot))
    ok('raíz exacta del repositorio como directorio de artefactos: rechazada', err instanceof Error && /repositorio/.test(err.message))
  }
  {
    const err = expectThrow(() => assertArtifactPathAllowed(path.join(prefixSimilarDir, 'x.json'), prefixSimilarDir))
    ok('directorio con prefijo similar al repo pero genuinamente externo: ACEPTADO (sin falso positivo)', err === null)
  }
  {
    const err = expectThrow(() => assertArtifactPathAllowed(path.join(symlinkIntoRepo, 'x.json'), symlinkIntoRepo))
    ok('symlink externo cuyo destino real cae dentro del repo: rechazado', err instanceof Error && /repositorio/.test(err.message))
  }
  {
    const err = expectThrow(() => assertArtifactPathAllowed(path.join(externalAllowedDir, 'x.json'), externalAllowedDir))
    ok('ruta legítima dentro de un SECRETS_DIR temporal externo: ACEPTADA', err === null)
  }
  {
    // allowedDir externo, pero la ruta del artefacto en sí cae dentro del repo -> rechazada igualmente.
    const err = expectThrow(() => assertArtifactPathAllowed(path.join(fakeAppsWeb, 'x.json'), externalAllowedDir))
    ok('ruta de artefacto dentro del repo aunque allowedDir sea externo: rechazada', err instanceof Error)
  }
  {
    // allowedDir externo, pero la ruta del artefacto vive en OTRO directorio externo distinto -> rechazada (allowlist positiva exacta).
    const otherExternalDir = path.join(workDir, 'otro-externo')
    mkdirSync(otherExternalDir, { recursive: true })
    const err = expectThrow(() => assertArtifactPathAllowed(path.join(otherExternalDir, 'x.json'), externalAllowedDir))
    ok('ruta fuera del repo pero en un directorio externo DISTINTO del permitido: rechazada', err instanceof Error && /directorio de artefactos permitido/.test(err.message))
  }

  // --- writeArtifactExclusive / readArtifactStrict ---

  const artifactPath = path.join(externalAllowedDir, 's6-otp-probe.json')
  const sampleData = { subjectRef: 's6-test:abc', code: '123456', payloadJwt: 'h.b.s' }

  writeArtifactExclusive(artifactPath, externalAllowedDir, SCHEMA_VERSION, sampleData)
  ok('writeArtifactExclusive crea el fichero', existsSync(artifactPath))
  ok('writeArtifactExclusive: modo 600', (statSync(artifactPath).mode & 0o777) === 0o600)

  {
    const err = expectThrow(() => writeArtifactExclusive(artifactPath, externalAllowedDir, SCHEMA_VERSION, sampleData))
    ok('writeArtifactExclusive NUNCA sobrescribe un artefacto existente', err instanceof Error)
  }

  {
    const read = readArtifactStrict(artifactPath, externalAllowedDir, SCHEMA_VERSION, KEYS)
    ok('readArtifactStrict recupera los mismos valores escritos', read.subjectRef === sampleData.subjectRef && read.code === sampleData.code && read.payloadJwt === sampleData.payloadJwt)
  }
  {
    const err = expectThrow(() => readArtifactStrict(artifactPath, externalAllowedDir, 2, KEYS))
    ok('readArtifactStrict rechaza una versión de esquema distinta', err instanceof Error)
  }
  {
    const err = expectThrow(() => readArtifactStrict(artifactPath, externalAllowedDir, SCHEMA_VERSION, [...KEYS, 'extraField']))
    ok('readArtifactStrict rechaza un conjunto de claves esperado distinto del real', err instanceof Error)
  }

  // --- inspectArtifact ---

  ok('inspectArtifact: ausente -> "absent"', inspectArtifact(path.join(externalAllowedDir, 'no-existe.json'), externalAllowedDir, SCHEMA_VERSION, KEYS) === 'absent')
  ok('inspectArtifact: artefacto recién escrito -> "valid"', inspectArtifact(artifactPath, externalAllowedDir, SCHEMA_VERSION, KEYS) === 'valid')

  {
    const badModePath = path.join(externalAllowedDir, 's6-bad-mode.json')
    writeFileSync(badModePath, JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...sampleData }))
    chmodSync(badModePath, 0o644)
    ok('inspectArtifact: modo distinto de 600 -> "invalid"', inspectArtifact(badModePath, externalAllowedDir, SCHEMA_VERSION, KEYS) === 'invalid')
  }
  {
    const extraFieldPath = path.join(externalAllowedDir, 's6-extra-field.json')
    writeFileSync(extraFieldPath, JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...sampleData, extra: 'x' }))
    chmodSync(extraFieldPath, 0o600)
    ok('inspectArtifact: campo adicional en el esquema -> "invalid"', inspectArtifact(extraFieldPath, externalAllowedDir, SCHEMA_VERSION, KEYS) === 'invalid')
  }
  {
    const wrongVersionPath = path.join(externalAllowedDir, 's6-wrong-version.json')
    writeFileSync(wrongVersionPath, JSON.stringify({ schemaVersion: 99, ...sampleData }))
    chmodSync(wrongVersionPath, 0o600)
    ok('inspectArtifact: versión de esquema desconocida -> "invalid"', inspectArtifact(wrongVersionPath, externalAllowedDir, SCHEMA_VERSION, KEYS) === 'invalid')
  }
  {
    const symlinkTargetPath = path.join(externalAllowedDir, 's6-symlink-target.json')
    writeFileSync(symlinkTargetPath, JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...sampleData }))
    chmodSync(symlinkTargetPath, 0o600)
    const symlinkArtifactPath = path.join(externalAllowedDir, 's6-symlink-artifact.json')
    symlinkSync(symlinkTargetPath, symlinkArtifactPath)
    ok('inspectArtifact: la ruta del artefacto es un symlink -> "invalid" (nunca se sigue)', inspectArtifact(symlinkArtifactPath, externalAllowedDir, SCHEMA_VERSION, KEYS) === 'invalid')

    const err = expectThrow(() => removeArtifactStrict(symlinkArtifactPath, externalAllowedDir, SCHEMA_VERSION, KEYS))
    ok('removeArtifactStrict: symlink -> aborta sin tocar nada (lanza, no retorna false)', err instanceof Error)
    ok('removeArtifactStrict sobre un symlink NUNCA sigue ni borra el destino real', existsSync(symlinkTargetPath))
    ok('removeArtifactStrict sobre un symlink NUNCA borra el symlink en sí tampoco', existsSync(symlinkArtifactPath))
  }

  // --- removeArtifactStrict ---

  ok('removeArtifactStrict: ruta ausente -> false (nada que retirar, no lanza)', removeArtifactStrict(path.join(externalAllowedDir, 'no-existe-2.json'), externalAllowedDir, SCHEMA_VERSION, KEYS) === false)

  {
    const removed = removeArtifactStrict(artifactPath, externalAllowedDir, SCHEMA_VERSION, KEYS)
    ok('removeArtifactStrict: artefacto válido -> true', removed === true)
    ok('removeArtifactStrict: el fichero ya no existe tras retirarlo', !existsSync(artifactPath))
  }

  // --- contenido nunca impreso ---
  {
    const originalLog = console.log
    const originalError = console.error
    const seen: string[] = []
    console.log = (...args: unknown[]) => seen.push(args.map(String).join(' '))
    console.error = (...args: unknown[]) => seen.push(args.map(String).join(' '))
    try {
      const p = path.join(externalAllowedDir, 's6-print-check.json')
      const secretish = { subjectRef: 's6-print-check:zzz', code: '000999', payloadJwt: 'nunca.debe.imprimirse' }
      writeArtifactExclusive(p, externalAllowedDir, SCHEMA_VERSION, secretish)
      readArtifactStrict(p, externalAllowedDir, SCHEMA_VERSION, KEYS)
      inspectArtifact(p, externalAllowedDir, SCHEMA_VERSION, KEYS)
      removeArtifactStrict(p, externalAllowedDir, SCHEMA_VERSION, KEYS)
    } finally {
      console.log = originalLog
      console.error = originalError
    }
    ok('ninguna operación de secureArtifact.mts escribe nunca a console.log/error', seen.length === 0)
  }
} finally {
  process.chdir(originalCwd)
  rmSync(workDir, { recursive: true, force: true })
}

summarizeAndExit()
