import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { FamiliasTratamiento } from './collections/FamiliasTratamiento'
import { Galeria } from './collections/Galeria'
import { InstagramPosts } from './collections/InstagramPosts'
import { Media } from './collections/Media'
import { PaginasLegales } from './collections/PaginasLegales'
import { Testimonios } from './collections/Testimonios'
import { Tratamientos } from './collections/Tratamientos'
import { Users } from './collections/Users'
import { VerificacionContenido } from './collections/VerificacionContenido'
import { AjustesGlobales } from './globals/AjustesGlobales'
import { ContenidoInicio } from './globals/ContenidoInicio'
import { ContenidoSobreGapssa } from './globals/ContenidoSobreGapssa'
import { getPayloadEnv } from './payload.env'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

// Falla rápido con un mensaje claro si falta PAYLOAD_SECRET o
// DATABASE_URL_CMS — nunca un fallback silencioso a `''` (que arrancaría
// Payload con un secreto vacío o una cadena de conexión vacía en vez de
// negarse a arrancar).
const payloadEnv = getPayloadEnv()

/**
 * Español como idioma principal (PROJECT_CONTEXT.md); catalán, inglés,
 * italiano, francés y portugués para completar los 6 idiomas de la V1
 * (PLAN_DESARROLLO_WEB_PORTAL.md §3.1). `fallback: true` evita campos
 * vacíos en un idioma todavía sin traducir.
 */
export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    // No indexar /admin (y el resto de vistas del panel, que cuelgan de
    // este layout raíz): PLAN_DESARROLLO_WEB_PORTAL.md §16 exige no
    // indexar rutas privadas. `admin.meta` acepta el mismo `Metadata` de
    // Next.js (verificado: `MetaConfig` extiende `Metadata` en
    // node_modules/payload/dist/config/types.d.ts).
    meta: {
      robots: 'noindex, nofollow',
    },
  },
  collections: [
    Users,
    Media,
    FamiliasTratamiento,
    Tratamientos,
    Testimonios,
    Galeria,
    InstagramPosts,
    PaginasLegales,
    VerificacionContenido,
  ],
  globals: [AjustesGlobales, ContenidoInicio, ContenidoSobreGapssa],
  editor: lexicalEditor(),
  // Requerido explícitamente por Payload para generar `imageSizes` en la
  // colección `media` (Media.ts) — tenerlo en node_modules no basta, hay
  // que inyectarlo en la config (verificado: sin esto, Payload avisa "sharp
  // not installed" aunque el paquete esté presente).
  sharp,
  secret: payloadEnv.PAYLOAD_SECRET,
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      connectionString: payloadEnv.DATABASE_URL_CMS,
    },
  }),
  localization: {
    locales: ['es', 'ca', 'en', 'it', 'fr', 'pt'],
    defaultLocale: 'es',
    fallback: true,
  },
  // Ambos ya son el valor por defecto de Payload
  // (node_modules/payload/dist/config/types.d.ts: `disableIntrospectionInProduction`
  // y `disablePlaygroundInProduction` son `true` por defecto) — se dejan
  // explícitos a propósito para no depender de un valor por defecto sin
  // documentarlo. GraphQL en sí NO se deshabilita por completo
  // (`disable` se deja sin fijar): la Local API y el panel de Payload lo
  // dan por hecho disponible, y una futura integración podría necesitarlo;
  // sí queda cerrado en producción lo que expone información de esquema o
  // permite explorarlo interactivamente.
  graphQL: {
    disableIntrospectionInProduction: true,
    disablePlaygroundInProduction: true,
  },
})
