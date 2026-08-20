# Puerta 4 — cierre

Cambio **exclusivamente documental**. No se ejecuta, ni se re-verifica por
sí mismo, nada contra EspoCRM real desde este documento — registra el
resultado final que tú confirmas explícitamente como ya ejecutado y
verificado, para que sirva de línea base declarada a la Puerta 5.

## Procedencia de esta información

Ninguna sesión de Claude Code ha ejecutado, ni tiene evidencia de primera
mano (hashes recalculados, capturas, salidas de comandos propias) de las
escrituras reales descritas aquí. `docs/fase4b-puerta4-propuesta-v4.md`
—el último registro con evidencia propia (ensayo desechable, arnés de
pruebas puro, manifiesto de hashes)— cierra dejando la Puerta 4 "a la
espera de... una nueva autorización explícita... para la primera fase
real". Este documento registra que, con posterioridad a ese cierre, la
Puerta 4 se ejecutó y verificó contra `gapssa-espocrm-1` real, por tu
confirmación explícita.

Esa confirmación se toma como el estado de partida declarado — **no**
como un hecho re-verificado por esta sesión. El mecanismo que sí
re-verifica esto de forma independiente, de solo lectura, antes de
cualquier escritura nueva, es el Paso A de
`docs/fase4b-puerta5-propuesta-v2.md` §2. Cualquier discrepancia que
aparezca ahí prevalece sobre lo registrado en este documento.

## Estado final confirmado

| Elemento | Estado final |
|---|---|
| Fases 1–9 del orden de activación (`fase4b-puerta4-propuesta-v3.md` §4) | Ejecutadas y verificadas |
| `maintenanceMode` | **`NULL`** — no `false`. Ausente de `data/config.php` en vez de escrito explícitamente en `false`. Comportamiento en tiempo de ejecución equivalente a "apagado" (EspoCRM trata la clave ausente igual que `false`), pero el valor literal en disco es `NULL` — distinción relevante para cualquier comprobación futura que compare por igualdad estricta o que asuma `false` sin comprobarlo |
| `gapssaBookingDecisionEnabled` | `false` — booleano explícito (fase 7 del orden de v3 §4 / v4 §5: la Puerta 4 lo deja siempre escrito, nunca ausente) |
| `gapssa_meeting_decision_operation` | Tabla desplegada (`install.sql`), **0 filas** |
| `Meeting.cMotivoResolucionReserva` | Campo desplegado (metadata + columna física) |
| ACL de campo `cMotivoResolucionReserva` | Desplegado — `Profesional Gapssa` en `{read:no, edit:no}`, `Portal GAPSSA API` en `{read:yes, edit:yes}` (v3 §3) |
| Hooks (`GuardMeetingDecisionTransition`, `SyncEstadoReservaToStatus`, `GuardMeetingResolutionReasonConsistency`, y las clases puras que consumen: `MeetingDecisionTransitionPolicy`, `MeetingResolutionReason`, `MeetingResolutionPolicy`, `EstadoReservaStatusMap`, `AtomicDecisionContext`) | Desplegados |
| API (`PutDecide`, `DecisionIdempotencyStore`, `MeetingDecisionAuthorizationPolicy`, `DecisionFeatureFlag`) + `routes.json` | Desplegados — ruta `PUT /api/v1/GapssaMeetingDecision/{id}` publicada |
| Cliente (`client/custom/src/views/meeting/record/detail.js`, modal de motivo de rechazo, `i18n`) | Desplegado |
| `gapssaBookingDecisionAuthorizedApiUserIds` / `gapssaBookingDecisionAuthorizedUserIds` | Desplegadas (allowlists activas en `data/config.php`) — **contenido exacto no repetido aquí**, se reconfirma por lectura directa en la Puerta 5 (v2 §2, punto 11/12) |
| `Meeting` reales (`deleted=0`) | **10** |
| `gcs_event_link` | **4** |
| `cMotivoResolucionReserva` de los 10 `Meeting` reales | `NULL` en los 10 |
| Llamadas a `PutDecide` ejecutadas durante la Puerta 4 | **0** |
| Commits | **0** |

## Nota sobre docblocks desactualizados

Algunos ficheros del repositorio (p. ej. `SyncEstadoReservaToStatus.php`,
cabecera de clase) todavía dicen literalmente "NO DESPLEGADO TODAVÍA" —
texto escrito antes de la ejecución real que este documento registra. No
se corrige aquí (sería un cambio de código fuera del alcance
"exclusivamente documental" pedido); queda anotado como limpieza
documental menor pendiente, sin urgencia ni relación con la seguridad o
corrección de la Puerta 5.

---

Este documento sustituye, a efectos de "estado actual de la Puerta 4",
cualquier lectura literal de `fase4b-puerta4-propuesta-v2.md`/`-v3.md`/
`-v4.md` que sugiera que la ejecución real seguía pendiente — esos tres
documentos conservan intacto su valor como manifiesto de archivos,
análisis de ACL/flag y evidencia del ensayo desechable; solo su frase de
cierre ("a la espera de autorización para la fase real") queda superada
por la confirmación registrada aquí.
