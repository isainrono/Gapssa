<?php

namespace Espo\Custom\Classes\Api\GapssaMeetingDecision;

/**
 * Fase 4B, revisión OCC 3 — corrige el hueco de autorización interna de la
 * revisión 2 (`docs/fase4b-occ-revision-2.md`): el `static bool $active`
 * original solo señalaba "hay una decisión en curso en esta petición PHP",
 * sin decir CUÁL. Mientras `PutDecide` ejecuta `Service::update()` sobre el
 * Meeting autorizado, cualquier escritura anidada disparada por otro hook
 * (p. ej. un `afterUpdate` que tocara un Meeting distinto) vería
 * `isActive() === true` y quedaría autorizada igual, aunque no fuera ni el
 * Meeting ni la transición que `PutDecide` había validado bajo el lock de
 * fila. Este fichero sustituye el booleano por una capacidad nominal
 * cerrada, ligada exactamente al recurso y a la transición autorizados —
 * nunca a "toda la petición".
 *
 * NO se pasa por `Entity`/`$options` (mismo motivo que la revisión 2, ver
 * cabecera de `GuardMeetingDecisionTransition`) ni por el contenedor de
 * inyección de dependencias de EspoCRM (mismo motivo: no verificado que dos
 * resoluciones independientes de una clase concreta sin *binding* devuelvan
 * la MISMA instancia). El `static` sigue siendo seguro en este despliegue
 * exactamente por lo ya documentado en la revisión 2: Apache+PHP clásico
 * (`espocrm/espocrm:10.0.3-apache-trixie`), un proceso/intérprete nuevo por
 * petición HTTP, sin estado compartido entre peticiones. Si esta imagen
 * cambiara de modelo de ejecución (p. ej. Swoole/RoadRunner), este supuesto
 * tendría que revalidarse explícitamente.
 */
final class AtomicDecisionContext
{
    private static ?self $current = null;

    private function __construct(
        private readonly string $meetingId,
        private readonly string $sourceState,
        private readonly string $targetState,
        private readonly ?string $operationKey,
    ) {}

    /**
     * Ejecuta `$callback` con una capacidad autorizada activa, cerrada al
     * `$meetingId`/`$sourceState`/`$targetState` exactos — únicamente
     * `PutDecide` debe llamar a esto, y únicamente alrededor de la porción
     * exacta de código que ya sostiene el lock de fila del Meeting dentro
     * de la transacción abierta por ella misma. `finally` garantiza que el
     * contexto se limpia incluso si `$callback` lanza una excepción (CAS
     * perdido, fallo inyectado durante las pruebas, o cualquier otro).
     *
     * `$operationKey` es opcional y puramente informativo — nunca forma
     * parte de la comprobación de `authorizes()`, nunca se expone en
     * excepciones/logs/auditoría, y no se lee en ningún otro sitio de esta
     * clase.
     *
     * @template T
     * @param callable(): T $callback
     * @return T
     */
    public static function runAuthorized(
        string $meetingId,
        string $sourceState,
        string $targetState,
        callable $callback,
        ?string $operationKey = null,
    ) {
        if (self::$current !== null) {
            // Nunca debería anidarse — si ocurriera, es una señal de un
            // error de programación (una llamada recursiva a PutDecide),
            // no un escenario legítimo. Fallar alto en vez de continuar
            // con un estado de confianza ambiguo, y sin permitir que la
            // capacidad exterior quede sustituida temporalmente por la
            // interior.
            throw new \LogicException('AtomicDecisionContext ya estaba activo — anidamiento no soportado.');
        }

        self::$current = new self($meetingId, $sourceState, $targetState, $operationKey);

        try {
            return $callback();
        } finally {
            self::$current = null;
        }
    }

    /**
     * Comprobación cerrada: ¿autoriza el contexto activo (si lo hay)
     * exactamente esta transición de exactamente este Meeting? No hay
     * forma de interpretar un resultado `true` como "autorización
     * universal" — a diferencia del antiguo `isActive()` genérico, este
     * método no existe sin atar el resultado a los tres valores exactos
     * que `PutDecide` autorizó.
     */
    public static function authorizes(string $meetingId, string $sourceState, string $targetState): bool
    {
        $context = self::$current;

        if ($context === null) {
            return false;
        }

        return $context->meetingId === $meetingId
            && $context->sourceState === $sourceState
            && $context->targetState === $targetState;
    }
}
