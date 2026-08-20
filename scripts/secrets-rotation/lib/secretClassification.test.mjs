#!/usr/bin/env node
// Pruebas de la clasificación cerrada de SECRETS_FILE_KEY_INVENTORY
// (Bloque 6): SECRET_KEY_CLASSIFICATION debe cubrir EXACTAMENTE el mismo
// conjunto de claves que el inventario real de $SECRETS_FILE -- ni una
// clave del inventario sin clasificar, ni una clave clasificada que ya
// no exista en el inventario (drift silencioso en cualquiera de los dos
// sentidos). Verifica también que SECRET_VALUE_KEYS (la lista que
// realmente usa el escáner de fugas de S9) es exactamente lo que se
// derivaría hoy de esa clasificación -- una reclasificación futura sin
// revisión deliberada hace fallar esta prueba.
import {
  MIN_SECRET_VALUE_LENGTH,
  SECRET_CLASS,
  SECRET_KEY_CLASSIFICATION,
  SECRET_VALUE_KEYS,
  SECRETS_FILE_KEY_INVENTORY,
} from './loadSecretsEnv.mjs'
import { ok, summarizeAndExit } from './testHarness.mjs'

const VALID_CLASSES = new Set(Object.values(SECRET_CLASS))

// --- cobertura exacta: inventario <-> clasificación ---------------------

{
  const classifiedKeys = Object.keys(SECRET_KEY_CLASSIFICATION)
  const inventorySet = new Set(SECRETS_FILE_KEY_INVENTORY)
  const classifiedSet = new Set(classifiedKeys)

  const unclassified = SECRETS_FILE_KEY_INVENTORY.filter((k) => !classifiedSet.has(k))
  const orphanedInClassification = classifiedKeys.filter((k) => !inventorySet.has(k))

  ok(
    'toda clave de SECRETS_FILE_KEY_INVENTORY tiene una entrada en SECRET_KEY_CLASSIFICATION (nunca queda excluida en silencio)',
    unclassified.length === 0,
  )
  ok(
    'SECRET_KEY_CLASSIFICATION no contiene claves huérfanas ajenas a SECRETS_FILE_KEY_INVENTORY',
    orphanedInClassification.length === 0,
  )
  ok('SECRET_KEY_CLASSIFICATION cubre exactamente 80 claves (cambios exigen revisión explícita de este número)', classifiedKeys.length === 80)
}

// --- cada valor de clasificación es uno de los tres válidos --------------

{
  const invalid = Object.entries(SECRET_KEY_CLASSIFICATION).filter(([, cls]) => !VALID_CLASSES.has(cls))
  ok('cada clave está clasificada como secret / sensitive-connection-string / non-secret-configuration (ningún otro valor)', invalid.length === 0)
}

// --- SECRET_VALUE_KEYS es exactamente lo derivado de la clasificación ----

{
  const expected = new Set(
    Object.entries(SECRET_KEY_CLASSIFICATION)
      .filter(([, cls]) => cls === SECRET_CLASS.SECRET || cls === SECRET_CLASS.SENSITIVE_CONNECTION_STRING)
      .map(([key]) => key),
  )
  const same = expected.size === SECRET_VALUE_KEYS.size && [...expected].every((k) => SECRET_VALUE_KEYS.has(k))
  ok('SECRET_VALUE_KEYS coincide exactamente con las claves secret/sensitive-connection-string de la clasificación (una sola fuente de verdad)', same)
}

// --- inventario cerrado del material realmente secreto (Bloque 6) --------
// Lista estática explícita -- si una reclasificación futura cambia el
// conjunto de claves 'secret'/'sensitive-connection-string' sin revisar
// también esta prueba, falla aquí hasta que se confirme deliberadamente.

{
  const EXPECTED_SECRET_MATERIAL = [
    'ESPOCRM_ADMIN_PASSWORD',
    'ESPOCRM_DB_PASSWORD',
    'ESPOCRM_DB_ROOT_PASSWORD',
    'POSTGRES_PASSWORD',
    'REDIS_PASSWORD',
    'PAYLOAD_SECRET',
    'OTP_HMAC_SECRET',
    'AUTH_RATE_LIMIT_HMAC_SECRET',
    'SMTP_PASSWORD',
    'BOOKING_FIELD_ENCRYPTION_KEYS',
    'BOOKING_EMAIL_LOOKUP_HMAC_SECRETS',
    'BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS',
    'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS',
    'BOOKING_INTERNAL_API_SECRET',
    'ESPOCRM_API_KEY',
    'DATABASE_URL_CMS',
    'DATABASE_URL_AUTH',
    'DATABASE_URL_BOOKING',
    'REDIS_URL',
  ].sort()
  const actual = [...SECRET_VALUE_KEYS].sort()
  ok(
    'todas las contraseñas/API keys/HMAC/claves de cifrado/tokens/DSN/URLs con credenciales del inventario están cubiertas (lista cerrada explícita)',
    JSON.stringify(actual) === JSON.stringify(EXPECTED_SECRET_MATERIAL),
  )
}

// --- nunca clasificar por coincidencia parcial del nombre -----------------
// La propia estructura de datos (objeto literal estático, sin regex/
// substring en runtime) ya lo garantiza -- esta prueba deja constancia
// explícita: dos claves con subcadenas superpuestas ("ESPOCRM_API_KEY" /
// "ESPOCRM_API_BASE_URL" / "ESPOCRM_API_TIMEOUT_MS") deben poder tener
// clasificaciones DISTINTAS sin interferir entre sí.

{
  ok(
    'ESPOCRM_API_KEY es secret pese a compartir prefijo con ESPOCRM_API_BASE_URL/ESPOCRM_API_TIMEOUT_MS (no hay coincidencia parcial de nombre)',
    SECRET_KEY_CLASSIFICATION.ESPOCRM_API_KEY === SECRET_CLASS.SECRET &&
      SECRET_KEY_CLASSIFICATION.ESPOCRM_API_BASE_URL === SECRET_CLASS.NON_SECRET_CONFIGURATION &&
      SECRET_KEY_CLASSIFICATION.ESPOCRM_API_TIMEOUT_MS === SECRET_CLASS.NON_SECRET_CONFIGURATION,
  )
  ok(
    'BOOKING_INTERNAL_API_SECRET es secret pese a compartir prefijo con BOOKING_*_ACTIVE_KEY_VERSION (no hay coincidencia parcial de nombre)',
    SECRET_KEY_CLASSIFICATION.BOOKING_INTERNAL_API_SECRET === SECRET_CLASS.SECRET &&
      SECRET_KEY_CLASSIFICATION.BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION === SECRET_CLASS.NON_SECRET_CONFIGURATION,
  )
}

// --- longitud mínima razonable frente al contrato de generación ----------

{
  ok('MIN_SECRET_VALUE_LENGTH es un entero positivo y por debajo del suelo real de generación (24 bytes)', Number.isInteger(MIN_SECRET_VALUE_LENGTH) && MIN_SECRET_VALUE_LENGTH > 0 && MIN_SECRET_VALUE_LENGTH < 24)
}

summarizeAndExit()
