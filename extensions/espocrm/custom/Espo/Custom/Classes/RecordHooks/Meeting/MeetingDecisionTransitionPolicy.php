<?php

namespace Espo\Custom\Classes\RecordHooks\Meeting;

/**
 * Fase 4B, revisión 2, punto 5 — parte PURA (sin EspoCRM, sin base de
 * datos) de `GuardMeetingDecisionTransition`: qué transiciones de
 * `cEstadoReserva` representan "una decisión saliendo de
 * PendingCenterApproval" y necesitan, por tanto, la comprobación
 * condicional atómica del guard. Separada para poder probarse de forma
 * aislada (`extensions/espocrm/custom/tests/MeetingHooksPureLogicTest.php`)
 * sin bootstrap de EspoCRM.
 *
 * NO DESPLEGADO — mismo alcance que el resto de `extensions/espocrm/custom`.
 */
final class MeetingDecisionTransitionPolicy
{
    /** Único estado de origen que este guard protege — el resto de transiciones del ciclo de vida del Meeting no son el escenario de "dos decisiones concurrentes". */
    private const GUARDED_SOURCE = 'PendingCenterApproval';

    /**
     * Destinos que representan una decisión real: aprobar (Confirmed),
     * rechazar o expirar por barrido (ambos escriben Canceled — el
     * guard no distingue entre rechazo humano y expiración de sistema,
     * eso es responsabilidad de `decidedBy`/`note`, ajeno a esta
     * comprobación de concurrencia).
     */
    private const GUARDED_TARGETS = ['Confirmed', 'Canceled'];

    public static function guardedSourceState(): string
    {
        return self::GUARDED_SOURCE;
    }

    /** true si `$requestedEstadoReserva` es un destino que debe protegerse con el CAS atómico. */
    public static function isGuardedTransitionTarget(?string $requestedEstadoReserva): bool
    {
        if ($requestedEstadoReserva === null) {
            return false;
        }

        return in_array($requestedEstadoReserva, self::GUARDED_TARGETS, true);
    }
}
