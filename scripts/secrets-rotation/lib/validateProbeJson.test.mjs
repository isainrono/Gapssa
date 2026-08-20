#!/usr/bin/env node
// Pruebas de lib/validateProbeJson.mjs — contrato JSON cerrado de las
// sondas permanentes de S6/S7: documento único, conjunto exacto de
// claves, tipos exactos, nunca imprime valores en sus mensajes de error.
import { validateProbeJsonText, SCHEMAS } from './validateProbeJson.mjs'
import { ok, summarizeAndExit } from './testHarness.mjs'

// --- éxito: un documento válido por cada una de las 6 schemas ---
{
  const r = validateProbeJsonText('s6-pre', '{"prepared":true,"artifactCreated":true,"artifactSchemaVersion":1}\n')
  ok('s6-pre válido: ok=true', r.ok === true)
  ok('s6-pre válido: valor reproducido tal cual', r.ok && r.value.artifactSchemaVersion === 1)
}
{
  const r = validateProbeJsonText(
    's6-post',
    '{"otpOldInvalidated":true,"otpNewWorks":true,"rateLimitFreshCounterOk":true,"payloadOldInvalidated":true,"payloadNewWorks":true}',
  )
  ok('s6-post válido (sin salto de línea final): ok=true', r.ok === true)
}
{
  const r = validateProbeJsonText('s6-artifact-inspect', '{"status":"valid"}\n')
  ok('s6-artifact-inspect con valor de enum válido: ok=true', r.ok === true)
}
{
  const r = validateProbeJsonText('s6-artifact-remove', '{"removed":false}\n')
  ok('s6-artifact-remove válido: ok=true', r.ok === true)
}
{
  const r = validateProbeJsonText(
    's7-migrate',
    JSON.stringify({
      allowlistOk: true,
      allowlistUnlisted: [],
      allowlistMissing: [],
      aesRemainingV1: 0,
      aesRemainingV2: 0,
      aesDecryptOk: true,
      emailLookupRemainingV1: 0,
      fingerprintRemaining: 0,
      accessTokenRemaining: 0,
    }) + '\n',
  )
  ok('s7-migrate válido (incluye string[] vacíos): ok=true', r.ok === true)
}
{
  const r = validateProbeJsonText('s7-internal-check', '{"newAccepted":true,"oldRejected":true,"absentRejected":true}\n')
  ok('s7-internal-check válido: ok=true', r.ok === true)
}

// --- fallo cerrado: schema desconocida ---
{
  const r = validateProbeJsonText('no-existe', '{}\n')
  ok('schema desconocida: rechazada', r.ok === false)
}
{
  const r = validateProbeJsonText(undefined, '{}\n')
  ok('schema ausente: rechazada', r.ok === false)
}

// --- fallo cerrado: campo ausente ---
{
  const r = validateProbeJsonText('s6-pre', '{"prepared":true,"artifactCreated":true}\n')
  ok('campo ausente ("artifactSchemaVersion"): rechazado', r.ok === false && /falta el campo/.test(r.error))
}

// --- fallo cerrado: campo adicional no permitido ---
{
  const r = validateProbeJsonText('s6-pre', '{"prepared":true,"artifactCreated":true,"artifactSchemaVersion":1,"extra":"x"}\n')
  ok('campo adicional no permitido: rechazado', r.ok === false && /campo inesperado/.test(r.error))
  ok('mensaje de campo adicional no incluye el valor del campo', !/["\047]x["\047]/.test(r.error))
}

// --- fallo cerrado: tipo incorrecto ---
{
  const r = validateProbeJsonText('s6-pre', '{"prepared":"true","artifactCreated":true,"artifactSchemaVersion":1}\n')
  ok('tipo incorrecto (string en vez de boolean): rechazado', r.ok === false)
}
{
  const r = validateProbeJsonText('s6-artifact-inspect', '{"status":"unknown-value"}\n')
  ok('valor de enum no permitido: rechazado', r.ok === false)
}

// --- fallo cerrado: JSON inválido / vacío ---
{
  const r = validateProbeJsonText('s6-pre', '')
  ok('stdin vacío: rechazado', r.ok === false)
}
{
  const r = validateProbeJsonText('s6-pre', 'no es json\n')
  ok('JSON malformado: rechazado', r.ok === false)
}
{
  const r = validateProbeJsonText('s6-pre', '[1,2,3]\n')
  ok('un array en vez de un objeto: rechazado', r.ok === false)
}
{
  const r = validateProbeJsonText('s6-pre', 'null\n')
  ok('null en vez de un objeto: rechazado', r.ok === false)
}

// --- fallo cerrado: bytes antes/después, varias líneas, logs mezclados ---
{
  const r = validateProbeJsonText('s6-artifact-remove', 'algo de log\n{"removed":true}\n')
  ok('línea de log ANTES del JSON: rechazado (varias líneas)', r.ok === false)
}
{
  const r = validateProbeJsonText('s6-artifact-remove', '{"removed":true}\nalgo de log\n')
  ok('línea de log DESPUÉS del JSON: rechazado (varias líneas)', r.ok === false)
}
{
  const r = validateProbeJsonText('s6-artifact-remove', ' {"removed":true}\n')
  ok('espacio en blanco ANTES del JSON: rechazado', r.ok === false)
}
{
  const r = validateProbeJsonText('s6-artifact-remove', '{"removed":true} \n')
  ok('espacio en blanco DESPUÉS del JSON (antes del salto final): rechazado', r.ok === false)
}
{
  const r = validateProbeJsonText('s6-artifact-remove', '{"removed":true}\n\n')
  ok('doble salto de línea final: rechazado (más de un salto admitido)', r.ok === false)
}
{
  const r = validateProbeJsonText('s6-artifact-remove', '{"removed":true}{"removed":false}\n')
  ok('dos documentos JSON pegados en la misma línea: rechazado', r.ok === false)
}

// --- las 6 schemas están efectivamente cerradas (documentación viva) ---
{
  ok('exactamente 6 schemas registradas', Object.keys(SCHEMAS).length === 6)
}

summarizeAndExit()
