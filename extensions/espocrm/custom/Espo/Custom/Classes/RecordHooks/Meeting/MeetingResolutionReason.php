<?php

namespace Espo\Custom\Classes\RecordHooks\Meeting;

/**
 * "Fase 4B — flujo de decisión final", hueco 3: `Meeting.cEstadoReserva`
 * por sí solo no distingue un rechazo manual de una caducidad de sistema
 * (ambos terminan en `Canceled`) y `modifiedById`/`decidedBy` no es un
 * marcador de negocio durable — identifica al usuario/proceso TÉCNICO que
 * ejecutó la escritura (el API User `portal-gapssa-api` en ambos casos, o
 * un administrador humano si decide desde la propia interfaz de EspoCRM),
 * no el motivo. Esta clase pura (sin ningún `Espo\...` en sus imports,
 * mismo patrón que `EstadoReservaStatusMap`/`MeetingDecisionTransitionPolicy`
 * para poder probarla sin bootstrap de EspoCRM) es la única fuente de los
 * tres valores válidos del campo custom NUEVO `Meeting.cMotivoResolucionReserva`
 * — **no creado en la instancia real**, ver
 * `docs/fase4b-decision-flow-final.md` §6.
 *
 * Copia exacta de `MEETING_RESOLUTION_REASONS`/`APPROVAL_EXPIRED_TECHNICAL_NOTE`
 * (`packages/contracts/src/booking.ts`) — no cambiar un lado sin el otro.
 */
final class MeetingResolutionReason
{
    public const APPROVED = 'Approved';
    public const REJECTED_BY_STAFF = 'RejectedByStaff';
    public const APPROVAL_EXPIRED = 'ApprovalExpired';

    private const ALL = [self::APPROVED, self::REJECTED_BY_STAFF, self::APPROVAL_EXPIRED];

    /**
     * Nota técnica fija y única admitida junto a una caducidad de sistema
     * (`ApprovalExpired`) — nunca texto libre. Un rechazo manual
     * (`RejectedByStaff`) exige, al contrario, una nota humana no vacía;
     * ver `MeetingResolutionPolicy::isNoteAcceptable()`.
     */
    public const EXPIRY_TECHNICAL_NOTE =
        'Caducado automáticamente: el plazo de aprobación del centro venció sin respuesta.';

    public static function isValid(?string $reason): bool
    {
        return $reason !== null && in_array($reason, self::ALL, true);
    }

    /**
     * @return list<string>
     */
    public static function all(): array
    {
        return self::ALL;
    }
}
