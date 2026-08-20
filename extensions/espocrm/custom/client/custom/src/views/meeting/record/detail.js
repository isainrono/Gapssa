define(['views/record/detail'], (Dep) => {

    /**
     * "Fase 4B — flujo de decisión final", punto 5 del encargo: acciones
     * "Aprobar reserva"/"Rechazar reserva" en la vista de detalle de
     * Meeting, visibles únicamente cuando `cEstadoReserva ===
     * PendingCenterApproval`, llamando EXCLUSIVAMENTE a la acción atómica
     * `PUT /api/v1/GapssaMeetingDecision/{id}` (`PutDecide.php`) — nunca al
     * guardado genérico del propio registro (que `GuardMeetingDecisionTransition`
     * rechazaría de todos modos).
     *
     * Esta es la vía PREFERIDA para decidir (punto 5 del encargo,
     * justificación completa en `docs/fase4b-decision-flow-final.md` §3):
     * usa la sesión/API del propio usuario humano autenticado en EspoCRM
     * (`Espo.Ajax`, cookies de sesión + CSRF ya gestionados por el núcleo
     * de EspoCRM — nunca una API Key propia de este módulo, y NUNCA la API
     * Key del BFF, que no tiene ningún motivo para existir en código
     * cliente), así que `modifiedById` queda con el id real de la persona
     * que decide — a diferencia del endpoint interno del BFF
     * (`/internal/decisions`), que solo puede escribir con la identidad
     * del API User técnico.
     *
     * API de EspoCRM verificada de forma exhaustiva contra el bundle real
     * de la instancia (`client/lib/espo-main.js`, 10.0.3, solo lectura —
     * nunca contra documentación genérica no confirmada en este proyecto),
     * y contra el precedente real ya en producción en este mismo
     * repositorio (`extensions/espocrm-google-calendar-sync/files/client/custom/modules/google-calendar-sync/src/views/gcs-account/record/detail.js`):
     * `dropdownItemList.push({name, label})` + método `action{Name}()`,
     * `hideActionItem`/`showActionItem`/`disableActionItem`/`enableActionItem`
     * (comprueban tanto `buttonList` como `dropdownItemList`),
     * `Espo.Ajax.putRequest(url, data)` (devuelve una promesa; en fallo
     * rechaza con el propio `XMLHttpRequest`, `xhr.status`/`xhr.responseText`
     * disponibles), `Espo.Ui.success/warning/error/notifyWait`,
     * `this.confirm(message, callback)`, `this.createView(key, path,
     * options)` (promesa, `.then(view => { view.render(); ... })`),
     * `this.getAcl().checkScope(scope, action)`.
     *
     * El identificador de módulo AMD exacto para archivos bajo
     * `client/custom/src/...` (`"custom:views/..."` frente a un posible
     * `"views/..."` sin prefijo) no pudo confirmarse por lectura estática
     * contra la imagen Docker de producción (no incluye `client/src/loader.js`
     * sin minificar) — verificado EMPÍRICAMENTE contra una instancia
     * EspoCRM 10.0.3 desechable antes de considerar esta pieza cerrada;
     * ver `docs/fase4b-decision-flow-final.md` §9 para el resultado exacto
     * de esa comprobación.
     */

    const DECISION_ROUTE = 'GapssaMeetingDecision';
    const GUARDED_SOURCE_STATE = 'PendingCenterApproval';
    const APPROVE_ITEM_NAME = 'gapssaApproveBooking';
    const REJECT_ITEM_NAME = 'gapssaRejectBooking';

    function generateOperationKey() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID();
        }
        // Reserva sin `crypto.randomUUID` (navegador muy antiguo/contexto no
        // seguro) — nunca bloquea la acción por esto; sigue siendo un valor
        // opaco alfanumérico válido para `operationKey`
        // (`^[A-Za-z0-9_-]+$`, PutDecide.php).
        return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    return class extends Dep {

        setup() {
            super.setup();

            this.dropdownItemList.push({
                name: APPROVE_ITEM_NAME,
                label: this.translate('Aprobar reserva', 'labels', 'Meeting'),
            });
            this.dropdownItemList.push({
                name: REJECT_ITEM_NAME,
                label: this.translate('Rechazar reserva', 'labels', 'Meeting'),
            });

            this.controlGapssaDecisionItems();
            this.listenTo(this.model, 'change:cEstadoReserva', () => this.controlGapssaDecisionItems());
            this.listenTo(this.model, 'sync', () => this.controlGapssaDecisionItems());
        }

        /**
         * Comprobación de VISIBILIDAD, puramente de UX — nunca la
         * autorización real. La autorización definitiva y obligatoria vive
         * en el servidor (`PutDecide.php`, comprobación de rol dentro de la
         * propia acción — `docs/fase4b-decision-flow-final.md` §6): un
         * usuario que llamara a la API directamente sin pasar por esta
         * vista seguiría bloqueado ahí aunque este método nunca se
         * ejecutara. `checkScope('Meeting', 'edit')` es el mínimo ya
         * exigido hoy por `PutDecide.php`; el rol humano específico
         * ("Profesional Gapssa" u otro futuro rol de aprobación) es una
         * puerta de escritura real aparte, documentada y NO ejecutada — ver
         * §6/§10 del mismo documento.
         */
        controlGapssaDecisionItems() {
            const isPending = this.model.get('cEstadoReserva') === GUARDED_SOURCE_STATE;
            const hasEditAccess = this.getAcl().checkScope('Meeting', 'edit');
            const visible = isPending && hasEditAccess;

            for (const name of [APPROVE_ITEM_NAME, REJECT_ITEM_NAME]) {
                if (visible) {
                    this.showActionItem(name);
                } else {
                    this.hideActionItem(name);
                }
            }
        }

        // noinspection JSUnusedGlobalSymbols
        actionGapssaApproveBooking() {
            this.confirm(this.translate('gapssaConfirmApprove', 'messages', 'Meeting'), () => {
                this.runGapssaMeetingDecision({decision: 'Confirmed', resultReason: 'Approved'});
            });
        }

        // noinspection JSUnusedGlobalSymbols
        actionGapssaRejectBooking() {
            this.createView('gapssaRejectReasonModal', 'custom:views/meeting/modals/reject-reason', {})
                .then((view) => {
                    view.render();
                    this.listenToOnce(view, 'gapssa-submit', (note) => {
                        this.runGapssaMeetingDecision({decision: 'Canceled', resultReason: 'RejectedByStaff', note});
                    });
                    this.listenToOnce(view, 'close', () => this.clearView('gapssaRejectReasonModal'));
                });
        }

        /**
         * Único punto de llamada a `PutDecide`. `operationKey` se genera
         * UNA vez por invocación de esta acción (un clic) y se REUTILIZA
         * en el único reintento automático permitido (fallo de red/timeout,
         * `xhr.status === 0` — nunca un reintento ante un 4xx/5xx real, que
         * es una respuesta definitiva, no una ausencia de respuesta) —
         * "operationKey UUID estable durante reintentos del mismo clic"
         * (encargo, punto 5). Los botones quedan deshabilitados durante
         * toda la operación (incluido el reintento) para impedir un
         * segundo clic que generase una operationKey distinta para la
         * MISMA decisión.
         */
        async runGapssaMeetingDecision({decision, resultReason, note}) {
            const operationKey = generateOperationKey();
            const body = {decision, resultReason, operationKey};
            if (note !== undefined) {
                body.note = note;
            }

            this.disableActionItem(APPROVE_ITEM_NAME);
            this.disableActionItem(REJECT_ITEM_NAME);
            Espo.Ui.notifyWait();

            const maxAttempts = 2;
            let attempt = 0;

            const send = () => {
                attempt += 1;
                return Espo.Ajax.putRequest(`${DECISION_ROUTE}/${this.model.id}`, body)
                    .then(() => this.onGapssaDecisionSuccess())
                    .catch((xhr) => {
                        const isNetworkFailure = xhr && xhr.status === 0;
                        if (isNetworkFailure && attempt < maxAttempts) {
                            return send();
                        }
                        this.onGapssaDecisionError(xhr);
                    });
            };

            try {
                await send();
            } finally {
                this.enableActionItem(APPROVE_ITEM_NAME);
                this.enableActionItem(REJECT_ITEM_NAME);
            }
        }

        /**
         * Cubre tanto una decisión aplicada AHORA como un replay (misma
         * operationKey, mismo payload, mismo Meeting) — `PutDecide`
         * responde 200 en ambos casos con el mismo cuerpo, así que no hace
         * falta (ni es posible desde el cliente) distinguirlos: el
         * resultado observable es idéntico y correcto en los dos casos.
         */
        onGapssaDecisionSuccess() {
            Espo.Ui.success(this.translate('Done'));
            this.model.fetch();
        }

        /**
         * 409: la reserva ya no estaba en `PendingCenterApproval` (otra
         * persona decidió primero, o el barrido la caducó) — nunca un
         * error genérico: se refresca el registro para que la interfaz
         * muestre el estado REAL de inmediato, sin dejar al usuario
         * creyendo que su clic pudo haber funcionado.
         *
         * Cualquier otro estado (400 propio de un payload mal formado —no
         * debería ocurrir si esta vista construye el payload correctamente
         * pero se trata igual por si acaso—, 401/403, 500): mensaje de
         * error genérico, sin refrescar (no hay ninguna garantía de que el
         * estado haya cambiado).
         */
        onGapssaDecisionError(xhr) {
            if (xhr && xhr.status === 409) {
                Espo.Ui.warning(this.translate('gapssaDecisionConflict', 'messages', 'Meeting'));
                this.model.fetch();
                return;
            }
            Espo.Ui.error(this.translate('gapssaDecisionError', 'messages', 'Meeting'));
        }
    };
});
