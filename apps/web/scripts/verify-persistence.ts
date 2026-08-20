/**
 * Script de verificación manual de Fase 1 — NO forma parte de la app.
 * Crea un documento de VerificacionContenido publicado en dos idiomas, lo
 * relee y lo borra, para demostrar persistencia real en Postgres +
 * localización + el mecanismo oficial de borradores/publicación de Payload.
 * Ejecutar con: npx tsx --env-file=../../.env scripts/verify-persistence.ts
 */
import config from '../src/payload.config'
import { getPayload } from 'payload'

async function main() {
  const payload = await getPayload({ config })

  const created = await payload.create({
    collection: 'verificacion-contenido',
    locale: 'es',
    data: { titulo: 'Verificación Fase 1', _status: 'published' },
  })

  await payload.update({
    collection: 'verificacion-contenido',
    id: created.id,
    locale: 'en',
    data: { titulo: 'Phase 1 verification' },
  })

  const readEs = await payload.findByID({
    collection: 'verificacion-contenido',
    id: created.id,
    locale: 'es',
  })
  const readEn = await payload.findByID({
    collection: 'verificacion-contenido',
    id: created.id,
    locale: 'en',
  })

  console.log('Creado id:', created.id)
  console.log('Título es:', readEs.titulo)
  console.log('Título en:', readEn.titulo)
  console.log('Estado:', readEs._status)

  await payload.delete({ collection: 'verificacion-contenido', id: created.id })
  console.log('Documento de verificación eliminado.')

  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
