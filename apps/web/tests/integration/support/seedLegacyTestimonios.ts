import config from '@payload-config'
import { getPayload } from 'payload'

import { TESTIMONIOS_SEED } from '@/seed/data/testimonios'

/**
 * Script de apoyo SOLO para
 * `tests/integration/testimoniosReconciliacion.int.test.ts`: reproduce,
 * contra la base de datos efímera de esa suite, el estado histórico que
 * dejó la primera versión del seed de Fase 2 (un testimonio ficticio de
 * `TESTIMONIOS_SEED` publicado y visible, sin autorización) y, aparte, un
 * testimonio real autorizado que casualmente comparte el mismo `autor` que
 * el ficticio — para poder probar que la huella de la reconciliación
 * (autor + texto exactos, `reconcileTestimoniosFicticios.ts`) no confunde
 * a uno con el otro.
 *
 * El testimonio ficticio se fuerza al estado ilegal con
 * `payload.db.updateOne` (nivel de adaptador, sin hooks de colección):
 * `requireAutorizacionParaPublicar`
 * (`collections/hooks/testimonioAuthorization.ts`) ya no permite crear esa
 * combinación por ninguna vía normal de la aplicación (API REST o Local
 * API con hooks) — precisamente por eso solo puede existir como dato
 * heredado de antes de que el hook existiera, y esta es la única forma
 * fiel de reproducirlo en una prueba contra el código actual. Se ejecuta
 * como proceso hijo separado (mismo motivo que `runSeedOnce` en
 * `seed.int.test.ts`): necesita `DATABASE_URL_CMS` apuntando a la base
 * efímera de esta ejecución de la suite, no a la de desarrollo.
 */
async function main() {
  const payload = await getPayload({ config })

  const ficticio = TESTIMONIOS_SEED[0]
  if (!ficticio) {
    throw new Error('TESTIMONIOS_SEED está vacío: nada que reproducir.')
  }

  const ficticioCreado = await payload.create({
    collection: 'testimonios',
    overrideAccess: true,
    locale: 'es',
    draft: true,
    data: {
      texto: ficticio.textoPorLocale.es,
      autor: ficticio.autorPorLocale.es,
      visible: false,
      orden: ficticio.orden,
      autorizacionRegistrada: false,
      _status: 'draft',
    },
  })

  await payload.db.updateOne({
    collection: 'testimonios',
    id: ficticioCreado.id,
    data: { visible: true, _status: 'published' },
  })

  const realAutorizado = await payload.create({
    collection: 'testimonios',
    overrideAccess: true,
    locale: 'es',
    draft: false,
    data: {
      texto: 'Reseña real, distinta de la del seed, de una clienta que también se llama así.',
      autor: ficticio.autorPorLocale.es,
      visible: true,
      orden: 99,
      autorizacionRegistrada: true,
      _status: 'published',
    },
  })

  // Prefijo distintivo: Payload/drizzle-kit escriben sus propios logs INFO
  // y un spinner de "Pulling schema from database..." en stdout antes de
  // esto (al crear la base de datos efímera y sincronizar el esquema en
  // modo dev) — el proceso que lee esta salida busca esta línea exacta en
  // vez de asumir que la salida entera es JSON.
  process.stdout.write(`\nRESULT_JSON:${JSON.stringify({ ficticioId: ficticioCreado.id, realId: realAutorizado.id })}\n`)
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
