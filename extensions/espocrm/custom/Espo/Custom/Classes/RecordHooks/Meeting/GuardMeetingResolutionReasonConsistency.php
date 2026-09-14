<?php

namespace Espo\Custom\Classes\RecordHooks\Meeting;

use Espo\Core\Exceptions\Conflict;
use Espo\Core\Record\Hook\SaveHook;
use Espo\Modules\Crm\Entities\Meeting;
use Espo\ORM\Entity;

/**
 * "Fase 4B — flujo de decisión final", hueco 3 del encargo: defensa en
 * profundidad para `Meeting.cMotivoResolucionReserva` (campo NUEVO, no
 * creado en la instancia real — ver `docs/fase4b-decision-flow-final.md`
 * §6). `PutDecide` ya valida `resultReason` contra `decision`
 * (`MeetingResolutionPolicy::isCompatible`) antes de escribir, y escribe
 * `cEstadoReserva`/`cMotivoResolucionReserva` en la MISMA llamada — así que
 * en el camino normal esta guarda nunca debería rechazar nada que
 * `PutDecide` haya producido. Existe para el camino QUE NO pasa por
 * `PutDecide`: un `PUT /api/v1/Meeting/{id}` genérico (o una creación
 * directa, `POST /api/v1/Meeting`) que intente escribir
 * `cMotivoResolucionReserva` sin pasar por la acción atómica —
 * `GuardMeetingDecisionTransition` NO cubre este caso porque solo se activa
 * cuando `cEstadoReserva` cambia; un PUT que toque ÚNICAMENTE
 * `cMotivoResolucionReserva` (dejando `cEstadoReserva` intacto) pasaría de
 * largo sin esta guarda.
 *
 * A diferencia de `GuardMeetingDecisionTransition` (que exige la capacidad
 * `AtomicDecisionContext` para CUALQUIER transición hacia
 * Confirmed/Canceled), esta guarda no necesita esa capacidad: no protege
 * una transición contra una carrera, protege la COHERENCIA interna del par
 * `cEstadoReserva`/`cMotivoResolucionReserva` en el estado final que se va a
 * persistir — una comprobación pura, sin necesidad de lock ni de conocer el
 * estado "antes". Por eso se aplica también en creación (`isNew()`, a
 * diferencia de `GuardMeetingDecisionTransition`, que la omite): un Meeting
 * creado directamente con una combinación incoherente (p. ej.
 * `cEstadoReserva` ausente + `cMotivoResolucionReserva = Approved`) es
 * exactamente el "motivo inventado para otro estado" que el encargo prohíbe
 * — no hay ningún motivo legítimo para permitirlo en creación tampoco.
 *
 * Solo actúa cuando `cMotivoResolucionReserva` lleva un valor no nulo Y
 * (`cEstadoReserva` o `cMotivoResolucionReserva` cambiaron, o la entidad es
 * nueva) — un guardado que no toca ninguno de los dos campos (p. ej. editar
 * `description` de un Meeting ya `Confirmed`) nunca se revalida, para no
 * bloquear la edición de un registro heredado por un campo ajeno al que se
 * está editando.
 *
 * @implements SaveHook<Meeting>
 */
class GuardMeetingResolutionReasonConsistency implements SaveHook
{
    public function process(Entity $entity): void
    {
        if (
            !$entity->isNew()
            && !$entity->isAttributeChanged('cMotivoResolucionReserva')
            && !$entity->isAttributeChanged('cEstadoReserva')
        ) {
            return;
        }

        $reason = $entity->get('cMotivoResolucionReserva');
        $cEstadoReserva = $entity->get('cEstadoReserva');

        if ($cEstadoReserva === null || $cEstadoReserva === '') {
            // Cita normal/manual del calendario fuera del flujo de reservas web.
            // Limpia cualquier motivo enviado por la UI y permite guardar sin conflicto.
            if ($reason !== null && $reason !== '') {
                $entity->set('cMotivoResolucionReserva', null);
            }
            return;
        }

        if ($cEstadoReserva === 'Confirmed') {
            // En Confirmed, si se envió un motivo ajeno a Approved, auto-normalizar a Approved.
            if ($reason !== null && $reason !== '' && $reason !== MeetingResolutionReason::APPROVED) {
                $entity->set('cMotivoResolucionReserva', MeetingResolutionReason::APPROVED);
            }
            return;
        }

        if ($cEstadoReserva === 'Canceled') {
            // En Canceled, si se envió un motivo no compatible, auto-normalizar a RejectedByStaff.
            if (
                $reason !== null
                && $reason !== ''
                && !in_array($reason, [MeetingResolutionReason::REJECTED_BY_STAFF, MeetingResolutionReason::APPROVAL_EXPIRED], true)
            ) {
                $entity->set('cMotivoResolucionReserva', MeetingResolutionReason::REJECTED_BY_STAFF);
            }
            return;
        }

        // Para cualquier otro estado (Completed, ClientArrived, InTreatment, NoShow, RequestReceived, etc.):
        // El motivo de resolución web no aplica -> auto-limpiar a null.
        if ($reason !== null && $reason !== '') {
            $entity->set('cMotivoResolucionReserva', null);
        }
    }
}
