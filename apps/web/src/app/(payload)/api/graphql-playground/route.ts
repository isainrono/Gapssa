/* Estructura oficial de Payload 3 para Next.js (plantilla "blank"). No modificar el patrón sin revisar la documentación oficial. */
import config from '@payload-config'
import '@payloadcms/next/css'
import { GRAPHQL_PLAYGROUND_GET } from '@payloadcms/next/routes'

export const GET = GRAPHQL_PLAYGROUND_GET(config)
