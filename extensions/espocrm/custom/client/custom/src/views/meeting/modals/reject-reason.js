define(['views/modal'], (Dep) => {

    /**
     * "Fase 4B — flujo de decisión final", punto 5 del encargo: modal
     * mínimo para recoger el motivo obligatorio de un rechazo manual —
     * `PutDecide` exige `note` no vacía/no-solo-espacios para
     * `resultReason: RejectedByStaff` (`MeetingResolutionPolicy::isNoteAcceptable`,
     * lado PHP); este modal aplica la MISMA validación en el cliente antes
     * de disparar la llamada, para no obligar al usuario a esperar un 400
     * evitable.
     *
     * API verificada contra el bundle real de EspoCRM 10.0.3
     * (`client/lib/espo-main.js`, solo lectura): `views/modal` como clase
     * base, `templateContent`/`headerText`/`buttonList` como propiedades
     * reales de `Dialog`/`ModalView`, `onClick` en cada entrada de
     * `buttonList` (patrón confirmado en el propio core, p. ej.
     * `views/record/detail`).
     */
    return class extends Dep {

        templateContent = `
            <div class="form-group">
                <label class="control-label">{{translate 'Motivo del rechazo' category='labels' scope='Meeting'}}</label>
                <textarea class="form-control" data-name="gapssa-reject-note" rows="4" style="width: 100%;"></textarea>
                <div class="text-danger" data-name="gapssa-reject-note-error" style="display: none;">
                    {{translate 'gapssaNoteRequired' category='messages' scope='Meeting'}}
                </div>
            </div>
        `;

        setup() {
            super.setup();

            this.headerText = this.translate('Rechazar reserva', 'labels', 'Meeting');
            this.backdrop = 'static';

            this.buttonList = [
                {
                    name: 'gapssaSubmitReject',
                    label: this.translate('Rechazar reserva', 'labels', 'Meeting'),
                    style: 'danger',
                    onClick: () => this.actionGapssaSubmitReject(),
                },
                {
                    name: 'cancel',
                    label: this.translate('Cancel'),
                },
            ];
        }

        actionGapssaSubmitReject() {
            const note = (this.$el.find('[data-name="gapssa-reject-note"]').val() || '').toString().trim();

            if (note === '') {
                this.$el.find('[data-name="gapssa-reject-note-error"]').show();
                return;
            }

            this.trigger('gapssa-submit', note);
            this.close();
        }
    };
});
