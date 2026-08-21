#!/usr/bin/env node
// Lanzador de sondas `tsx` PERMANENTES (scripts/secrets-rotation/probes/,
// S6/S7) SIN `npx` — resuelve el binario local YA INSTALADO en la raíz
// del monorepo (node_modules/tsx/dist/cli.mjs, hoisted por npm
// workspaces — NO existe una copia separada en apps/web/node_modules) y
// lo ejecuta con `process.execPath` (el propio Node ya en uso), nunca
// con una shell ni con resolución/descarga de paquetes. Si el binario no
// existe, falla cerrado — nunca cae a `npx`.
//
// Estas sondas ya NO se generan en tiempo de ejecución (Bloque 3) — son
// ficheros permanentes y revisables bajo probes/, fuera de apps/web/,
// referenciados siempre por ruta absoluta resuelta desde $SCRIPT_DIR por
// quien llama a este lanzador.
//
// Uso: node lib/run-tsx.mjs <repoRoot> <secretsFile> <script.mts> [args...]
//
// El entorno del script hijo se construye con loadSecretsEnv.mjs — nunca
// `...process.env` heredado sin filtrar, nunca un secreto en argv.
//
// `GAPSSA_ROTATION_ENV_PROJECTION` (variable del propio lanzador, NUNCA
// reenviada al hijo) selecciona la proyección MÍNIMA de S6 (Bloque 8) en
// vez de `buildChildEnv` — ambas toleran `$SECRETS_FILE` en esquema
// "active" O "legacy-pre-s7" (S6 corre siempre ANTES que S7, nunca puede
// exigir que S7 ya haya migrado nada), pero difieren en qué le pasan al
// hijo:
//   - "s6-artifact" -> `buildS6ArtifactProbeEnv` (s6ArtifactMaintenance.mts,
//     inspect/remove): no necesita NINGÚN secreto (no importa
//     `server/env.ts`) — solo valida el archivo, no exige ni copia nada
//     de su contenido.
//   - "s6-crypto"   -> `buildS6CryptoProbeEnv` (s6PreRotationProbe.mts/
//     s6PostRotationVerification.mts): sí importa `serverEnv`
//     transitivamente — recibe PAYLOAD_SECRET/OTP_HMAC_SECRET/
//     AUTH_RATE_LIMIT_HMAC_SECRET reales más placeholders opacos para los
//     campos de booking que Zod exige pero esta sonda nunca lee — nunca
//     el valor legacy real.
// Ausente/cualquier otro valor -> `buildChildEnv` de siempre, sin cambios
// (S7/S9).
//
// Construir el `env` puede lanzar (`SecretsFileParseError` si
// `$SECRETS_FILE` tiene una clave desconocida, mezcla legacy/active,
// etc.) — se captura aquí explícitamente para imprimir SOLO un mensaje de
// una línea (nunca la traza de Node, que citaría rutas/números de línea
// del propio código fuente de este lanzador, no del archivo externo) y
// salir con el mismo código 1 de siempre, nunca uno distinto.

import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'

import { buildChildEnv, buildS6ArtifactProbeEnv, buildS6CryptoProbeEnv } from './loadSecretsEnv.mjs'

const [, , repoRoot, secretsFile, scriptPath, ...scriptArgs] = process.argv

if (!repoRoot || !secretsFile || !scriptPath) {
  console.error('Uso: run-tsx.mjs <repoRoot> <secretsFile> <script.mts> [args...]')
  process.exit(1)
}

const tsxCliPath = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')

if (!existsSync(tsxCliPath)) {
  console.error(`ERROR: no existe ${tsxCliPath} — tsx debe estar instalado localmente (node_modules en la raíz del monorepo). Fallo cerrado: nunca se intenta "npx tsx".`)
  process.exit(1)
}

const appsWebDir = path.join(repoRoot, 'apps', 'web')
const extraVars = {
  // Los scripts .mts desechables de S6/S7 importan módulos de
  // apps/web/src usando el mismo condition set que su propio dev server
  // (server/env.ts, etc.) — igual que la v2 ya hacía vía
  // NODE_OPTIONS=--conditions=react-server.
  NODE_OPTIONS: '--conditions=react-server',
}
// Bloque 10 (validación dedicada de S7) — reenvío EXPLÍCITO Y CERRADO de
// 4 variables de pausa de prueba a la sonda hija (probes/s7MigrateAndAudit.mts),
// que las vuelve a validar por sí misma con la misma guarda de contexto
// desechable antes de usarlas — buildChildEnv/buildS6*ProbeEnv nunca
// reenvían `process.env` sin filtrar (BASE_ENV_ALLOWLIST es una lista
// cerrada y deliberadamente NO incluye esto), así que sin este reenvío
// explícito la sonda nunca las vería. Ausentes en cualquier ejecución
// real — cero efecto.
for (const testVar of ['GAPSSA_ROTATION_TEST_MIGRATION_PAUSE', 'GAPSSA_ROTATION_TEST_MIGRATION_PAUSE_MS', 'GAPSSA_ROTATION_TEST_MIGRATION_CRASH', 'GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL']) {
  if (process.env[testVar] !== undefined) {
    extraVars[testVar] = process.env[testVar]
  }
}

const PROJECTION_BUILDERS = {
  's6-artifact': buildS6ArtifactProbeEnv,
  's6-crypto': buildS6CryptoProbeEnv,
}
const buildEnv = PROJECTION_BUILDERS[process.env.GAPSSA_ROTATION_ENV_PROJECTION] ?? buildChildEnv

let env
try {
  env = buildEnv(secretsFile, extraVars)
} catch (err) {
  console.error(`ERROR al construir el entorno del proceso hijo: ${err instanceof Error ? err.message : 'error desconocido'}`)
  process.exit(1)
}

const child = spawn(process.execPath, [tsxCliPath, scriptPath, ...scriptArgs], {
  cwd: appsWebDir,
  env,
  stdio: 'inherit',
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(1)
  }
  process.exit(code ?? 1)
})
child.on('error', (err) => {
  console.error(`ERROR al lanzar tsx: ${err.message}`)
  process.exit(1)
})
