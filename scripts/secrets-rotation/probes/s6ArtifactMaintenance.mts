// scripts/secrets-rotation/probes/s6ArtifactMaintenance.mts
//
// Envoltorio CLI fino sobre inspectArtifact/removeArtifactStrict
// (probes/shared/secureArtifact.mts). No implementa lógica propia más
// allá de validar sus argumentos y traducir a un contrato JSON cerrado
// — ver lib/validateProbeJson.mjs, schemas "s6-artifact-inspect" y
// "s6-artifact-remove".
//
// Uso: s6ArtifactMaintenance.mts <inspect|remove> <artifactPath> <allowedArtifactDir>
//
// "remove" es la ÚNICA operación de este sistema autorizada a retirar el
// artefacto de S6, y solo se invoca desde
// rotate-all-interactive.sh::run_s6_dynamic_verification() tras una
// verificación dinámica COMPLETADA (nunca desde gate_s6(), nunca ante un
// artefacto que no se acaba de terminar de verificar).

import { inspectArtifact, removeArtifactStrict } from './shared/secureArtifact.mts'

const ARTIFACT_SCHEMA_VERSION = 1
const ARTIFACT_KEYS = ['subjectRef', 'code', 'payloadJwt'] as const

async function main() {
  const mode = process.argv[2]
  const artifactPath = process.argv[3]
  const allowedDir = process.argv[4]

  if (mode !== 'inspect' && mode !== 'remove') {
    throw new Error('CONFIG_ERROR: modo desconocido (esperado "inspect" o "remove").')
  }
  if (!artifactPath || !allowedDir) {
    throw new Error('CONFIG_ERROR: faltan argumentos (artifactPath, allowedArtifactDir).')
  }

  if (mode === 'inspect') {
    const status = inspectArtifact(artifactPath, allowedDir, ARTIFACT_SCHEMA_VERSION, ARTIFACT_KEYS)
    console.log(JSON.stringify({ status }))
    return
  }

  const removed = removeArtifactStrict(artifactPath, allowedDir, ARTIFACT_SCHEMA_VERSION, ARTIFACT_KEYS)
  console.log(JSON.stringify({ removed }))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
