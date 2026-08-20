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

        if ($reason === null || $reason === '') {
            // Sin motivo -> nada que validar. Cualquier otro estado
            // (RequestReceived, PendingCenterApproval, etc.) debe llegar
            // aquí siempre así — nunca se inventa un motivo para ellos.
            return;
        }

        $cEstadoReserva = $entity->get('cEstadoReserva');

        if (!is_string($cEstadoReserva) || !MeetingResolutionPolicy::isCompatible($cEstadoReserva, (string) $reason)) {
            throw Conflict::createWithBody(
                'cMotivoResolucionReserva incompatible con cEstadoReserva — combinación rechazada. '
                    . 'Este par de campos solo puede escribirse mediante la acción atómica GapssaMeetingDecision.',
                'meeting_resolution_reason_incompatible',
            );
        }
    }
}
