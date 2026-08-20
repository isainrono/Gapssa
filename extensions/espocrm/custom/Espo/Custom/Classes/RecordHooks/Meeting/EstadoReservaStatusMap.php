<?php

namespace Espo\Custom\Classes\RecordHooks\Meeting;

/**
 * Fase 4B, revisión 2, punto 5 — extraída de `SyncEstadoReservaToStatus`
 * (antes una constante `private` sin forma de probarse fuera de la propia
 * clase) para que la tabla de mapeo sea una unidad probable de forma
 * aislada, sin bootstrap de EspoCRM — ver
 * `extensions/espocrm/custom/tests/MeetingHooksPureLogicTest.php`. Sigue
 * siendo la MISMA tabla, copia literal de
 * `ESTADO_RESERVA_A_MEETING_STATUS` en
 * `packages/contracts/src/estado-reserva.ts` — cambiar una fila aquí sin
 * cambiar la otra rompe el contrato entre el BFF y EspoCRM.
 *
 * NO DESPLEGADO — mismo alcance que el resto de `extensions/espocrm/custom`
 * en esta fase (ver cabecera de `SyncEstadoReservaToStatus.php`).
 */
final class EstadoReservaStatusMap
{
    public const MAP = [
        'RequestReceived' => 'Planned',
        'PendingGuardianAuthorization' => 'Planned',
        'PendingAssessment' => 'Planned',
        'PendingCenterApproval' => 'Planned',
        'Confirmed' => 'Planned',
        'ClientArrived' => 'Planned',
        'InTreatment' => 'Planned',
        'Completed' => 'Held',
        'Canceled' => 'Not Held',
        'NoShow' => 'Not Held',
        'RescheduleRequested' => 'Planned',
        'ScheduleConflict' => 'Planned',
    ];

    /** Null si `$estadoReserva` no pertenece al enum conocido — nunca inventa un status. */
    public static function statusFor(?string $estadoReserva): ?string
    {
        if ($estadoReserva === null || $estadoReserva === '') {
            return null;
        }

        return self::MAP[$estadoReserva] ?? null;
    }
}
