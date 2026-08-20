<?php

namespace Espo\Custom\Classes\RecordHooks\Meeting;

use Espo\Core\Record\Hook\SaveHook;
use Espo\Modules\Crm\Entities\Meeting;
use Espo\ORM\Entity;

/**
 * Sincroniza el campo custom `cEstadoReserva` (12 estados de negocio del
 * portal, `docs/espocrm-modelo-inicial.md`) con el `status` nativo de
 * `Meeting` (`Planned`/`Held`/`Not Held`), para que la sincronización
 * funcione también cuando Gapssa cambia `cEstadoReserva` directamente
 * desde la interfaz de EspoCRM, no solo cuando lo hace el portal.
 *
 * NO DESPLEGADO TODAVÍA — preparado en Fase 4B, punto 8, pendiente de
 * autorización explícita antes de copiarlo a la instancia real (requiere
 * `bin/command rebuild` tras copiarlo). Este fichero vive en el árbol de
 * `extensions/espocrm/custom`, que hoy es solo de EXPORTACIÓN
 * (`make espocrm-export` copia DESDE el contenedor HACIA aquí, nunca al
 * revés — ver Makefile) — copiarlo a la instancia real es una acción
 * manual y deliberada, no algo que ocurra por tener este fichero en el
 * repositorio.
 *
 * Se implementa como `SaveHook` "before" (registrado en
 * `beforeCreateHookClassNameList`/`beforeUpdateHookClassNameList` de
 * `Resources/metadata/recordDefs/Meeting.json`), no como el hook clásico
 * `BeforeSave` mencionado originalmente en `docs/contratos-portal-v1.md`
 * §6 — ese documento se escribió antes de que existiera ningún hook real
 * en esta instancia. El propio directorio ya usa el patrón moderno
 * `Classes/RecordHooks/Meeting/*` para `SendInvitationsAfterCreate`/
 * `SendInvitationsAfterUpdate` (afterCreate/afterUpdate) — este hook sigue
 * el mismo patrón, en la variante "before". Discrepancia documentada, no
 * silenciosa.
 *
 * Garantías:
 * - Dirección única: `cEstadoReserva` -> `status`. Un cambio manual de
 *   `status` (nativo) NUNCA inventa ni modifica `cEstadoReserva` — este
 *   hook nunca lee `status` para decidir nada, solo lo escribe.
 * - `cEstadoReserva` ausente/null (reuniones internas o importadas de
 *   Google, `docs/espocrm-modelo-inicial.md`) -> el hook no toca `status`
 *   en absoluto, deja que EspoCRM/GCS/el usuario lo gobiernen como hoy.
 * - Solo actúa cuando `cEstadoReserva` es nuevo o cambió respecto al valor
 *   guardado (`isAttributeChanged`) — evita escrituras redundantes en
 *   cada guardado que no lo toque.
 * - Sin bucles: al ser un hook "before", muta el propio `$entity` ANTES de
 *   que se persista — no dispara un nuevo ciclo de guardado (a diferencia
 *   de un `afterSave` que llamara a `save()` otra vez).
 * - Compatible con Google Calendar Sync: `GcsPush` (extensión GCS) es un
 *   hook `AfterSave` clásico — corre DESPUÉS de que este hook `before` ya
 *   dejó `status` sincronizado y DESPUÉS de que la fila se persista, así
 *   que siempre ve el `status` final correcto, nunca uno a medio
 *   sincronizar.
 *
 * Revisión 2 de Fase 4B, punto 5: la tabla de mapeo vive ahora en
 * `EstadoReservaStatusMap` (clase pura, probada de forma aislada en
 * `extensions/espocrm/custom/tests/MeetingHooksPureLogicTest.php`) — antes
 * era una constante `private` de esta clase, sin forma de probarse sin
 * arrancar EspoCRM. Mismo comportamiento exacto, sin cambios funcionales.
 *
 * @implements SaveHook<Meeting>
 */
class SyncEstadoReservaToStatus implements SaveHook
{
    public function process(Entity $entity): void
    {
        if (!$entity->isNew() && !$entity->isAttributeChanged('cEstadoReserva')) {
            return;
        }

        $status = EstadoReservaStatusMap::statusFor($entity->get('cEstadoReserva'));

        if ($status === null) {
            // Reunión fuera del flujo de reservas del portal (null/vacío),
            // o un valor fuera del enum conocido (no debería ser
            // alcanzable — campo `enum` cerrado en el propio EspoCRM, pero
            // se comprueba explícitamente en vez de asumirlo) — nunca se
            // inventa un status, se deja como esté (nativo, GCS, manual).
            return;
        }

        $entity->set('status', $status);
    }
}
