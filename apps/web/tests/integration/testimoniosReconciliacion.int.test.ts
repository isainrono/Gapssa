import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, inject, it } from 'vitest'

import { api } from './client'

/**
 * Revisión 3 de Fase 2: reproduce, contra la base de datos efímera de esta
 * suite, el estado que dejó la primera versión del seed (un testimonio
 * ficticio de `TESTIMONIOS_SEED` publicado, visible y sin autorización —
 * `tests/integration/support/seedLegacyTestimonios.ts`), corre el seed
 * real (que ahora incluye `reconcileTestimoniosFicticios`,
 * `src/seed/reconcileTestimoniosFicticios.ts`) y demuestra por la API
 * pública real que deja de ser consultable. Incluye también un testimonio
 * real autorizado que comparte el mismo `autor` que el ficticio, para
 * probar que la huella (autor + texto exactos) no lo confunde con el
 * ficticio ni lo despublica.
 */

const appsWebDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')

function withDatabaseName(connectionString: string, databaseName: string): string {
  const url = new URL(connectionString)
  url.pathname = `/${databaseName}`
  return url.toString()
}

function runTsxScript(relativeScriptPath: string, databaseUrl: string): Promise<{ code: null | number; output: string }> {
  const require = createRequire(import.meta.url)
  const tsxCli = require.resolve('tsx/cli')

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCli, relativeScriptPath], {
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

function publicTestimoniosUrl(): string {
  return '/api/testimonios?where[and][0][_status][equals]=published&where[and][1][visible][equals]=true&where[and][2][autorizacionRegistrada][equals]=true'
}

describe('Reconciliación de testimonios ficticios — revisión 3 de Fase 2', () => {
  it(
    'un testimonio ficticio heredado (publicado, visible, sin autorización) deja de ser consultable públicamente tras el seed, sin afectar a un testimonio real que comparte el mismo autor',
    async () => {
      const databaseUrl = withDatabaseName(process.env.DATABASE_URL_CMS as string, inject('integrationTestDatabaseName'))

      const fixture = await runTsxScript('tests/integration/support/seedLegacyTestimonios.ts', databaseUrl)
      expect(fixture.code, `No se pudo preparar el estado histórico:\n${fixture.output}`).toBe(0)
      // Payload/drizzle-kit escriben sus propios logs (y un spinner) en
      // stdout antes de esto — la línea con el resultado se identifica por
      // su prefijo, no asumiendo que toda la salida es JSON.
      const resultLine = fixture.output.split('\n').find((line) => line.startsWith('RESULT_JSON:'))
      expect(resultLine, `No se encontró la línea RESULT_JSON en la salida:\n${fixture.output}`).toBeDefined()
      const { ficticioId, realId } = JSON.parse(resultLine!.slice('RESULT_JSON:'.length)) as {
        ficticioId: string
        realId: string
      }
      expect(ficticioId).toBeDefined()
      expect(realId).toBeDefined()
      expect(ficticioId).not.toBe(realId)

      // Confirma el estado histórico problemático ANTES de reconciliar. El
      // control de acceso genérico de la colección (`readPublishedOrStaff`,
      // `collections/access/content.ts`) solo exige `_status: published`
      // para una lectura anónima — `visible`/`autorizacionRegistrada` solo
      // los filtra la consulta específica de la portada
      // (`TESTIMONIOS_PUBLICOS_WHERE`, `lib/content/testimonios.ts`), que
      // el ficticio heredado YA no cumple (nace con
      // `autorizacionRegistrada: false`, igual que en la app real: eso no
      // depende de la reconciliación). El riesgo real que corrige la
      // reconciliación es que, al estar `_status: published`, el ficticio
      // es alcanzable directamente por `GET /api/testimonios/{id}` y
      // aparece en un listado genérico `/api/testimonios` para cualquier
      // visitante anónimo — antes de reconciliar, ninguna de las dos
      // debería devolver 404 ni excluirlo.
      const ficticioAntes = await api.get(`/api/testimonios/${ficticioId}`)
      expect(ficticioAntes.status).toBe(200)

      const listadoAntes = await api.get('/api/testimonios?limit=200')
      const idsListadoAntes = (listadoAntes.body.docs as { id: string }[]).map((doc) => doc.id)
      expect(idsListadoAntes).toContain(ficticioId)
      expect(idsListadoAntes).toContain(realId)

      const seed = await runTsxScript('src/seed/index.ts', databaseUrl)
      expect(seed.code, `El seed (con la reconciliación) falló:\n${seed.output}`).toBe(0)
      expect(seed.output).toMatch(/testimonios ficticios detectados/)

      // Después de reconciliar: el ficticio heredado vuelve a borrador, ya
      // no es alcanzable ni por lectura directa ni por el listado genérico
      // (ambos solo exigían `_status: published`, que ahora es `draft`).
      const ficticioDespues = await api.get(`/api/testimonios/${ficticioId}`)
      expect(ficticioDespues.status).toBe(404)

      const listadoDespues = await api.get('/api/testimonios?limit=200')
      const idsListadoDespues = (listadoDespues.body.docs as { id: string }[]).map((doc) => doc.id)
      expect(idsListadoDespues).not.toContain(ficticioId)

      // Nunca alcanzable por la consulta curada de la portada, ni antes ni
      // después: ya nacía con `autorizacionRegistrada: false`. Se
      // comprueba explícitamente para dejar constancia de que esta capa
      // también se mantiene coherente tras la reconciliación.
      const curadaDespues = await api.get(publicTestimoniosUrl())
      const idsCuradaDespues = (curadaDespues.body.docs as { id: string }[]).map((doc) => doc.id)
      expect(idsCuradaDespues).not.toContain(ficticioId)

      // El testimonio real autorizado, con el mismo autor que el
      // ficticio pero texto distinto, permanece intacto y público en las
      // tres consultas, sin verse afectado por la reconciliación.
      expect(idsListadoDespues).toContain(realId)
      expect(idsCuradaDespues).toContain(realId)
      const realDespues = await api.get(`/api/testimonios/${realId}`)
      expect(realDespues.status).toBe(200)
      expect(realDespues.body.visible).toBe(true)
      expect(realDespues.body.autorizacionRegistrada).toBe(true)
    },
    180_000,
  )
})
