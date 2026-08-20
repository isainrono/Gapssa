// Pruebas de lib/secretValueContract.mjs — contrato cerrado de valores
// secretos (Bloque 5, Revisión 2, punto 1).
import { validateSecretValue, validateGeneratedSecretValue, MAX_SECRET_VALUE_BYTES } from './secretValueContract.mjs'
import { ok, summarizeAndExit } from './testHarness.mjs'

function buf(text) {
  return Buffer.from(text, 'utf8')
}

// ============================================================
// validateSecretValue — contrato general (valores heredados con
// puntuación arbitraria DEBEN preservarse/aceptarse exactamente)
// ============================================================
{
  ok('espacios permitidos donde corresponda', validateSecretValue(buf('frase con varias palabras')).ok === true)
  ok('comilla simple', validateSecretValue(buf(`o'brien-secret-42`)).ok === true)
  ok('comilla doble', validateSecretValue(buf(`say "hola" 42`)).ok === true)
  ok('barra inversa', validateSecretValue(buf('valor\\con\\barras')).ok === true)
  ok('signo dólar', validateSecretValue(buf('p$w0rd$$')).ok === true)
  ok('backticks', validateSecretValue(buf('valor`con`backticks')).ok === true)
  ok('punto y coma', validateSecretValue(buf('valor;con;punto-y-coma')).ok === true)
  ok('ampersand', validateSecretValue(buf('valor&con&ampersand')).ok === true)
  ok('combinación adversarial completa (\'"\\$`;&)', validateSecretValue(buf(`adv-\${}'"\`;&\\pw`)).ok === true)
  ok('caracteres Unicode válidos (acentos, emoji, CJK)', validateSecretValue(buf('contraseña-日本語-🔒-42')).ok === true)
  ok('valor hex simple', validateSecretValue(buf('a1b2c3d4e5f6')).ok === true)
}

// ============================================================
// validateSecretValue — rechazos del contrato cerrado
// ============================================================
{
  ok('vacío rechazado', validateSecretValue(buf('')).ok === false)
  ok('CR rechazado', validateSecretValue(Buffer.concat([buf('valor'), Buffer.from([0x0d]), buf('resto')])).ok === false)
  ok('LF rechazado', validateSecretValue(Buffer.concat([buf('valor'), Buffer.from([0x0a]), buf('resto')])).ok === false)
  ok('NUL rechazado', validateSecretValue(Buffer.concat([buf('valor'), Buffer.from([0x00]), buf('resto')])).ok === false)
  ok('CRLF rechazado', validateSecretValue(buf('valor\r\nresto')).ok === false)
  ok('excede longitud máxima rechazado', validateSecretValue(Buffer.alloc(MAX_SECRET_VALUE_BYTES + 1, 0x61)).ok === false)
  ok('exactamente en el límite máximo aceptado', validateSecretValue(Buffer.alloc(MAX_SECRET_VALUE_BYTES, 0x61)).ok === true)
  ok('secuencia UTF-8 inválida (byte suelto 0xff) rechazada', validateSecretValue(Buffer.from([0x76, 0x61, 0x6c, 0xff, 0x6f])).ok === false)
  ok('par suplente UTF-16 solitario codificado como bytes inválidos rechazado', validateSecretValue(Buffer.from([0xed, 0xa0, 0x80])).ok === false)
}

// ============================================================
// validateGeneratedSecretValue — alfabeto cerrado para secretos MINADOS
// por este toolkit (hex CSPRNG o base64 estándar)
// ============================================================
{
  ok('hex CSPRNG (--format hex) aceptado', validateGeneratedSecretValue(buf('a1b2c3d4e5f60718293a4b5c6d7e8f9')).ok === true)
  ok('base64 URL-safe (guion/guion_bajo, no estándar) rechazado', validateGeneratedSecretValue(buf('SGVsbG8-V29ybGQh_x')).ok === false)
  ok('base64 estándar (--format base64) aceptado', validateGeneratedSecretValue(buf('SGVsbG8gV29ybGQh')).ok === true)
  ok('base64 con relleno "=" aceptado', validateGeneratedSecretValue(buf('YW55IGNhcm5hbCBwbGVhc3VyZS4=')).ok === true)
  ok('valor heredado con puntuación rechazado por validateGeneratedSecretValue (alfabeto no cerrado)', validateGeneratedSecretValue(buf(`adv-\${}'"pw`)).ok === false)
  ok('valor generado vacío sigue rechazado (contrato general primero)', validateGeneratedSecretValue(buf('')).ok === false)
  ok('valor generado con LF sigue rechazado (contrato general primero)', validateGeneratedSecretValue(buf('a1b2\nc3d4')).ok === false)
}

summarizeAndExit()
