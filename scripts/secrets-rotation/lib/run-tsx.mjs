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

import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'

import { buildChildEnv } from './loadSecretsEnv.mjs'

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
const env = buildChildEnv(secretsFile, {
  // Los scripts .mts desechables de S6/S7 importan módulos de
  // apps/web/src usando el mismo condition set que su propio dev server
  // (server/env.ts, etc.) — igual que la v2 ya hacía vía
  // NODE_OPTIONS=--conditions=react-server.
  NODE_OPTIONS: '--conditions=react-server',
})

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
