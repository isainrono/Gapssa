import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import { errorResponse, jsonResponse, parseJsonBody } from '@/server/auth/httpHelpers'
import { getEspoBookingAdapter } from '@/server/booking/adapterSelector'
import { applyOrAdoptBookingDecision } from '@/server/booking/decisionRecovery'
import { isValidInternalApiSecret } from '@/server/booking/internalAuth'

export const dynamic = 'force-dynamic'

/**
 * Decisión humana de Gapssa sobre un Meeting en `PendingCenterApproval` —
 * encargo de Fase 4A, punto 6. En producción, la vía PREFERIDA es que el
 * usuario humano autenticado en EspoCRM decida desde la propia interfaz de
 * EspoCRM (acción "Aprobar reserva"/"Rechazar reserva", llamando
 * directamente a `PutDecide` con su propia sesión/ACL — conserva
 * `modifiedById` real, ver `docs/fase4b-decision-flow-final.md` §3). Este
 * endpoint interno, protegido por `X-Internal-Api-Secret`, es la vía
 * administrativa/de recuperación — nunca alcanzable desde el navegador ni
 * desde código cliente de `apps/web`.
 *
 * "Fase 4B — flujo de decisión final", punto 4 del encargo: `decision:
 * "rejected"` exige `note` no vacía y no compuesta únicamente por espacios
 * — el rechazo debe conservar un motivo operativo real, nunca uno ausente
 * ni en blanco disfrazado de presente.
 *
 * `idempotencyKey` (UUID, opcional en el body): si el cliente operativo la
 * aporta, se usa como candidata; si no, se genera aquí. En ambos casos,
 * `applyOrAdoptBookingDecision` la asegura y persiste en
 * `BookingRequestRecord.decisionOperationKey` ANTES de tocar el adaptador
 * (`repository.ts::ensureDecisionOperationKey`) — nunca una clave nueva por
 * reintento HTTP de este mismo endpoint para la misma solicitud.
 */

/**
 * Bloqueo hallado en el ensayo de puerta 4 con EspoCRM 10.0.3 desechable
 * real: `meetingId` exigía `z.uuid()` — válido para `sim_espo_meetings.id`
 * (adaptador simulado, UUID de Postgres) pero NUNCA para un id real de
 * EspoCRM (formato propio, p. ej. `6a7b819f0f33f97f2`, no UUID). Con
 * `ESPO_BOOKING_ADAPTER=http` esta ruta rechazaba con 400 `invalid_input`
 * CUALQUIER `meetingId` real antes de llegar siquiera a
 * `applyOrAdoptBookingDecision` — nunca ejercitado hasta este ensayo.
 * Mismo patrón que `treatmentId`/`professionalId`/`zoneId` en
 * `requests/route.ts` (opacos, de origen EspoCRM o simulado): id no vacío,
 * tope de longitud razonable, nunca se asume un formato concreto.
 */
const bodySchema = z.discriminatedUnion('decision', [
  z.object({
    meetingId: z.string().min(1).max(200),
    decision: z.literal('approved'),
    decidedBy: z.string().min(1).max(200),
    note: z.string().max(2000).optional(),
    idempotencyKey: z.uuid().optional(),
  }),
  z.object({
    meetingId: z.string().min(1).max(200),
    decision: z.literal('rejected'),
    decidedBy: z.string().min(1).max(200),
    note: z
      .string()
      .max(2000)
      .refine((value) => value.trim() !== '', 'note no puede estar vacía ni ser solo espacios.'),
    idempotencyKey: z.uuid().optional(),
  }),
])

export async function POST(request: Request) {
  if (!isValidInternalApiSecret(request)) {
    return errorResponse(401, 'unauthorized', 'Credencial interna inválida o ausente.')
  }

  const parsed = await parseJsonBody(request, bodySchema)
  if (!parsed.success) {
    return parsed.response
  }

  const adapter = getEspoBookingAdapter()
  const idempotencyKey = parsed.data.idempotencyKey ?? randomUUID()
  const result = await applyOrAdoptBookingDecision(
    adapter,
    parsed.data.decision === 'approved'
      ? { meetingId: parsed.data.meetingId, decision: 'approved', decidedBy: parsed.data.decidedBy, note: parsed.data.note, idempotencyKey }
      : { meetingId: parsed.data.meetingId, decision: 'rejected', decidedBy: parsed.data.decidedBy, note: parsed.data.note, idempotencyKey },
  )

  switch (result.outcome) {
    case 'not_found':
      return errorResponse(404, 'not_found', 'No existe ninguna solicitud de reserva para ese meetingId.')
    case 'conflict':
      // Nunca sobrescribe una decisión incompatible ya asentada (p. ej. el
      // Meeting expiró por el barrido, o alguien ya lo decidió al
      // contrario) — la discrepancia queda auditada para revisión humana
      // (`SystemReconciliation`).
      return jsonResponse(
        {
          error: {
            code: 'decision_conflict',
            message: 'El Meeting ya tiene una decisión incompatible registrada.',
            existingResolution: result.existingResolution,
            existingCEstadoReserva: result.existingCEstadoReserva,
          },
        },
        { status: 409 },
      )
    case 'inconsistent':
      // Corrección de puerta 4, bloqueo de concurrencia: el Meeting ni
      // confirma esta decisión ni presenta una decisión incompatible
      // reconocible (sigue PendingCenterApproval, o su combinación
      // cEstadoReserva/cMotivoResolucionReserva es incoherente) — nunca se
      // inventa un resultado; requiere revisión manual explícita, distinto
      // de "otra decisión ya ganó" (decision_conflict).
      return jsonResponse(
        {
          error: {
            code: 'decision_state_inconsistent',
            message: 'El estado actual del Meeting no permite confirmar ni descartar esta decisión — requiere revisión manual.',
            meetingId: result.meetingId,
            cEstadoReserva: result.cEstadoReserva,
            resolutionReason: result.resolutionReason,
          },
        },
        { status: 409 },
      )
    case 'applied':
    case 'already_applied_compatible':
      return jsonResponse({
        status: 'ok',
        applied: result.outcome === 'applied' ? 'now' : 'already',
        requestId: result.requestId,
        resolution: result.resolution,
        cEstadoReserva: result.cEstadoReserva,
      })
  }
}
