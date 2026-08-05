define(['views/record/detail'], (Dep) => {

    /**
     * Vista de detalle de GcsAccount con acciones de conexión con Google.
     */
    return class extends Dep {

        setup() {
            super.setup();

            this.dropdownItemList.push({
                name: 'gcsConnect',
                label: this.translate('Connect Google', 'labels', 'GcsAccount'),
            });

            this.dropdownItemList.push({
                name: 'gcsRefreshCalendars',
                label: this.translate('Refresh Calendars', 'labels', 'GcsAccount'),
            });

            this.dropdownItemList.push({
                name: 'gcsDisconnect',
                label: this.translate('Disconnect', 'labels', 'GcsAccount'),
            });
        }

        // noinspection JSUnusedGlobalSymbols
        actionGcsConnect() {
            Espo.Ajax
                .getRequest('GcsSync/authUrl', {id: this.model.id})
                .then(response => {
                    window.location.href = response.authUrl;
                });
        }

        // noinspection JSUnusedGlobalSymbols
        actionGcsRefreshCalendars() {
            Espo.Ui.notifyWait();

            Espo.Ajax
                .postRequest('GcsSync/refreshCalendars', {id: this.model.id})
                .then(() => {
                    Espo.Ui.success(this.translate('Done'));

                    this.model.fetch();
                });
        }

        // noinspection JSUnusedGlobalSymbols
        actionGcsDisconnect() {
            this.confirm(
                this.translate('gcsConfirmDisconnect', 'messages', 'GcsAccount'),
                () => {
                    Espo.Ajax
                        .postRequest('GcsSync/disconnect', {id: this.model.id})
                        .then(() => {
                            Espo.Ui.success(
                                this.translate('gcsDisconnected', 'messages', 'GcsAccount'));

                            this.model.fetch();
                        });
                }
            );
        }
    };
});
