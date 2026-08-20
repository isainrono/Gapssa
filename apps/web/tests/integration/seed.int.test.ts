import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, inject, it } from 'vitest'

import { api } from './client'

/**
 * Ejecuta `src/seed/index.ts` de verdad, como proceso hijo, contra la
 * misma base de datos Postgres efímera que usa el resto de la suite de
 * integración (nunca `gapssa_cms`) — no una simulación de la lógica de
 * idempotencia, sino el script real que se ejecutaría en desarrollo,
 * comprobado dos veces seguidas. `run()` en `seed/index.ts` termina con
 * `process.exit(0)`: por eso se lanza como proceso hijo separado y nunca
 * se importa/llama directamente desde este proceso de test.
 */

const appsWebDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')

function withDatabaseName(connectionString: string, databaseName: string): string {
  const url = new URL(connectionString)
  url.pathname = `/${databaseName}`
  return url.toString()
}

async function runSeedOnce(databaseUrl: string): Promise<{ code: null | number; output: string }> {
  const require = createRequire(import.meta.url)
  const tsxCli = require.resolve('tsx/cli')

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCli, 'src/seed/index.ts'], {
      cwd: appsWebDir,
      env: { ...process.env, DATABASE_URL_CMS: databaseUrl, NODE_ENV: 'test' },
      stdio: 'pipe',
    })

    let output = ''
    child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.on('error', reject)
    child.on('exit', (code) => resolve({ code, output }))
  })
}

describe('Seed de Fase 2 — idempotencia real', () => {
  it(
    'ejecutado dos veces seguidas, la segunda no crea documentos adicionales',
    async () => {
      const databaseUrl = withDatabaseName(process.env.DATABASE_URL_CMS as string, inject('integrationTestDatabaseName'))

      const first = await runSeedOnce(databaseUrl)
      expect(first.code, `Primera ejecución del seed falló:\n${first.output}`).toBe(0)

      const afterFirst = await api.get('/api/tratamientos?limit=200')
      const countAfterFirst = (afterFirst.body.docs as unknown[]).length
      expect(countAfterFirst).toBeGreaterThan(0)

      const second = await runSeedOnce(databaseUrl)
      expect(second.code, `Segunda ejecución del seed falló:\n${second.output}`).toBe(0)
      expect(second.output).toContain('ya existían')

      const afterSecond = await api.get('/api/tratamientos?limit=200')
      const countAfterSecond = (afterSecond.body.docs as unknown[]).length
      expect(countAfterSecond).toBe(countAfterFirst)

      // Al menos las 6 familias del seed — no un número exacto: otros
      // bloques de esta suite de integración pueden haber creado alguna
      // familia adicional de prueba en la misma base efímera compartida.
      const familias = await api.get('/api/familias-tratamiento?limit=100')
      expect((familias.body.docs as unknown[]).length).toBeGreaterThanOrEqual(6)

      // La colección de Instagram se deja vacía a propósito (InstagramPosts.ts).
      const instagram = await api.get('/api/instagram-posts')
      expect((instagram.body.docs as unknown[]).length).toBe(0)
    },
    120_000,
  )

  /**
   * Revisión 2 de Fase 2: el catálogo debe responder en los 6 idiomas por
   * la API pública real, no solo en la estructura de datos del seed
   * (`src/seed/data/tratamientos.test.ts` ya cubre eso). `masaje-
   * descontracturante` es deliberadamente un tratamiento NO destacado —
   * antes de esta revisión, solo los 5 destacados tenían traducción más
   * allá de español, así que un no-destacado es el caso representativo
   * para demostrar que el fallback a español ya no es la respuesta.
   */
  it(
    'una ficha no destacada ("masaje-descontracturante") responde con contenido propio en catalán e inglés, sin caer al fallback de español',
    async () => {
      const es = await api.get('/api/tratamientos?where[slug][equals]=masaje-descontracturante&locale=es')
      const ca = await api.get('/api/tratamientos?where[slug][equals]=masaje-descontracturante&locale=ca')
      const en = await api.get('/api/tratamientos?where[slug][equals]=masaje-descontracturante&locale=en')

      const esDoc = (es.body.docs as { destacado: boolean; titulo: string; descripcion: string }[])[0]!
      const caDoc = (ca.body.docs as { titulo: string; descripcion: string }[])[0]!
      const enDoc = (en.body.docs as { titulo: string; descripcion: string }[])[0]!

      expect(esDoc, 'seed debería haber creado masaje-descontracturante').toBeDefined()
      expect(esDoc.destacado).toBe(false)

      expect(caDoc.titulo).toBe('Massatge descontracturant')
      expect(caDoc.descripcion).not.toBe(esDoc.descripcion)
      expect(caDoc.titulo).not.toBe(esDoc.titulo)

      expect(enDoc.titulo).toBe('Deep tissue massage')
      expect(enDoc.descripcion).not.toBe(esDoc.descripcion)
      expect(enDoc.titulo).not.toBe(esDoc.titulo)
    },
    30_000,
  )

  /**
   * Cobertura completa: los 57 tratamientos del seed responden con
   * `titulo`/`descripcion` propios (no vacíos, no iguales al español) en
   * cada uno de los 6 idiomas — a través de la API pública real, no de la
   * estructura de datos en memoria.
   */
  it(
    'los 57 tratamientos del seed responden con título y descripción propios en los 6 idiomas',
    async () => {
      const porLocale: Record<string, Map<string, { titulo: string; descripcion: string }>> = {}

      for (const locale of ['es', 'ca', 'en', 'it', 'fr', 'pt']) {
        const response = await api.get(`/api/tratamientos?limit=200&locale=${locale}`)
        const docs = response.body.docs as { slug: string; titulo: string; descripcion: string }[]
        const bySlug = new Map(docs.filter((doc) => doc.slug.length > 0).map((doc) => [doc.slug, { titulo: doc.titulo, descripcion: doc.descripcion }]))
        porLocale[locale] = bySlug
      }

      const esPorSlug = porLocale.es!
      expect(esPorSlug.size).toBeGreaterThanOrEqual(57)

      const problemas: string[] = []
      for (const [slug, esContenido] of esPorSlug) {
        for (const locale of ['ca', 'en', 'it', 'fr', 'pt']) {
          const contenido = porLocale[locale]!.get(slug)
          if (!contenido) {
            problemas.push(`${slug}: falta el documento en "${locale}"`)
            continue
          }
          if (!contenido.titulo || !contenido.descripcion) {
            problemas.push(`${slug}: título o descripción vacíos en "${locale}"`)
          }
          if (contenido.titulo === esContenido.titulo && contenido.descripcion === esContenido.descripcion) {
            problemas.push(`${slug}: "${locale}" es idéntico a español (posible fallback sin traducir)`)
          }
        }
      }

      expect(problemas, problemas.join('\n')).toEqual([])
    },
    30_000,
  )
})
