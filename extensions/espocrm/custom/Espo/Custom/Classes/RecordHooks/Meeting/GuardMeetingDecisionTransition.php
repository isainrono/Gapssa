<?php

namespace Espo\Custom\Classes\RecordHooks\Meeting;

use Espo\Core\Exceptions\Conflict;
use Espo\Core\Record\Hook\SaveHook;
use Espo\Custom\Classes\Api\GapssaMeetingDecision\AtomicDecisionContext;
use Espo\Modules\Crm\Entities\Meeting;
use Espo\ORM\Entity;

/**
 * Fase 4B, revisión OCC 3 — corrige el hueco de autorización interna
 * encontrado en la revisión 2 (`docs/fase4b-occ-revision-2.md`): la versión
 * anterior de este hook confiaba en `AtomicDecisionContext::isActive()`, un
 * booleano genérico que solo decía "hay una decisión de PutDecide en curso
 * en esta petición", sin atarlo al Meeting ni a la transición concretos.
 * Una escritura anidada disparada por otro hook mientras `PutDecide`
 * ejecutaba `Service::update()` sobre SU Meeting (p. ej. un `afterUpdate`
 * que tocara un Meeting distinto) habría visto `isActive() === true` y
 * habría quedado autorizada igual. Este hook ahora exige que
 * `AtomicDecisionContext::authorizes()` confirme, cerradamente, que la
 * entidad, el estado de origen y el destino solicitados son EXACTAMENTE
 * los que `PutDecide` autorizó — nunca solo "hay una autorización viva en
 * algún sitio de esta petición".
 *
 * Historia previa (sin cambios respecto a la revisión 2, contexto
 * necesario): la versión original de este hook (anterior a la revisión 2)
 * hacía su propio `UPDATE ... WHERE cEstadoReserva = 'PendingCenterApproval'`
 * atómico, pero esa escritura se confirmaba en MariaDB de forma
 * INDEPENDIENTE del resto del guardado — corría durante
 * `Espo\Core\Record\Service::processBeforeUpdate()`, una fase que ocurre
 * ANTES y FUERA de `entityManager->saveEntity()` (verificado línea por
 * línea contra `application/Espo/Core/Record/Service.php` del contenedor
 * real: `processBeforeUpdate()` en la línea 767, `saveEntity()` en la 772 —
 * secuenciales, nunca anidadas). Ningún valor de `transactionalSave` puede
 * arreglar eso: solo envuelve `RDBRepository::saveInternal()`, que corre
 * DESPUÉS de que este hook ya haya terminado. La corrección NO fue hacer el
 * CAS "mejor" aquí — fue dejar de escribir desde este hook por completo. La
 * frontera transaccional atómica real vive en
 * `Espo\Custom\Classes\Api\GapssaMeetingDecision\PutDecide` (acción API
 * dedicada, dueña de su propia transacción de principio a fin, incluyendo
 * el lock de fila del Meeting, la comprobación de estado y el guardado
 * completo — ver ese fichero para el mecanismo completo). Este hook sigue
 * siendo EXCLUSIVAMENTE una guarda de la máquina de estados, sin escritura
 * propia:
 *
 * - Si la transición es "una decisión saliendo de `PendingCenterApproval`"
 *   (`MeetingDecisionTransitionPolicy::isGuardedTransitionTarget`) **y**
 *   `AtomicDecisionContext::authorizes($entity->getId(), $original,
 *   $requested)` confirma que el Meeting, el estado de origen real
 *   (`getFetched()`, el valor cargado de BD antes de este `set()` —
 *   verificado contra `application/Espo/ORM/BaseEntity.php` del contenedor
 *   real que `getFetched()` conserva el valor previo a la escritura
 *   pendiente) y el destino solicitado coinciden EXACTAMENTE con lo que
 *   `PutDecide` autorizó bajo el lock de fila de su propia transacción:
 *   deja pasar, sin repetir la comprobación de estado (ya se hizo bajo el
 *   lock, en la MISMA transacción que este guardado).
 * - En cualquier otro caso — sin contexto activo, contexto activo pero para
 *   otro Meeting (escritura anidada sobre una entidad distinta a la
 *   autorizada), estado de origen real distinto del autorizado, o destino
 *   solicitado distinto del autorizado — RECHAZA SIEMPRE con `409
 *   Conflict`, incondicionalmente. Decisión deliberada, no una limitación:
 *   el encargo exige que "ninguna ruta alternativa debe permitir saltarse
 *   la máquina de estados" NI que una autorización viva para un Meeting
 *   pueda filtrarse a otro, y la única forma de garantizar ambas cosas sin
 *   volver a introducir una escritura no atómica en este hook es no dejar
 *   pasar nada que no case exactamente. Si en el futuro Gapssa necesita un
 *   camino manual legítimo de decisión desde la interfaz de EspoCRM, ese
 *   camino necesitaría su propio mecanismo igual de atómico — no una
 *   relajación de esta guarda.
 *
 * ## Compatibilidad con Google Calendar Sync
 *
 * Sin cambios de riesgo respecto al hook anterior: sigue siendo un hook
 * `before` — un `Conflict` lanzado aquí impide que el guardado llegue a
 * persistirse, así que `GcsPush` (`AfterSave`) nunca ve una escritura a
 * medias ni una decisión rechazada.
 *
 * @implements SaveHook<Meeting>
 */
class GuardMeetingDecisionTransition implements SaveHook
{
    public function process(Entity $entity): void
    {
        if ($entity->isNew() || !$entity->isAttributeChanged('cEstadoReserva')) {
            return;
        }

        $requested = $entity->get('cEstadoReserva');

        if (!MeetingDecisionTransitionPolicy::isGuardedTransitionTarget($requested)) {
            // Cualquier transición que no sea "una decisión saliendo de
            // PendingCenterApproval" no es el escenario que esta guarda
            // protege — se deja pasar sin más comprobación, igual que
            // antes.
            return;
        }

        // Valor previo a este `set()`, cargado desde BD al construir la
        // entidad — no el valor ya mutado en memoria (`$entity->get(...)`
        // devolvería el mismo `$requested` para este atributo).
        $original = $entity->getFetched('cEstadoReserva');

        if ($original !== MeetingDecisionTransitionPolicy::guardedSourceState()) {
            // Si el estado de origen no es PendingCenterApproval, no es la transición
            // de decisión web que esta guarda protege — se permite la edición libre.
            return;
        }

        if (
            is_string($original)
            && AtomicDecisionContext::authorizes((string) $entity->getId(), $original, $requested)
        ) {
            // La capacidad activa autoriza EXACTAMENTE este Meeting, este
            // origen y este destino — PutDecide ya lo validó bajo el lock
            // de fila de su propia transacción. Una autorización activa
            // para otro Meeting, otro origen o otro destino no pasa este
            // `authorizes()` y cae al rechazo de abajo.
            return;
        }

        // Cualquier otro caso (sin contexto activo, contexto activo para
        // otro Meeting/otra transición, edición manual desde la interfaz
        // de EspoCRM, o cualquier PUT directo a /api/v1/Meeting que intente
        // moverse fuera de PendingCenterApproval sin pasar por PutDecide):
        // rechazado siempre, sin excepción — la única puerta de salida de
        // PendingCenterApproval es PutDecide, y solo para el Meeting exacto
        // que autorizó.
        throw Conflict::createWithBody(
            'Las decisiones sobre Meeting.cEstadoReserva deben pasar por la acción atómica '
                . 'GapssaMeetingDecision — edición directa no permitida para esta transición.',
            'meeting_decision_requires_atomic_action',
        );
    }
}
