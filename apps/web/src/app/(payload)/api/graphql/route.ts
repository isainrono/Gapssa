/* Estructura oficial de Payload 3 para Next.js (plantilla "blank"). No modificar el patrón sin revisar la documentación oficial. */
import config from '@payload-config'
import { GRAPHQL_POST, REST_OPTIONS } from '@payloadcms/next/routes'

export const POST = GRAPHQL_POST(config)

export const OPTIONS = REST_OPTIONS(config)
