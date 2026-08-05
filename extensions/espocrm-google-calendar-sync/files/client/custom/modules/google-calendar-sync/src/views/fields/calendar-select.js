define(['views/fields/enum'], (Dep) => {

    /**
     * Selector de calendario: las opciones provienen de la caché
     * calendarListCache rellenada al conectar la cuenta de Google.
     */
    return class extends Dep {

        setup() {
            super.setup();

            this.listenTo(this.model, 'change:calendarListCache', () => {
                this.setupOptions();

                if (this.isEditMode() || this.isDetailMode()) {
                    this.reRender();
                }
            });
        }

        setupOptions() {
            const raw = this.model.get('calendarListCache');

            let list = [];

            if (raw) {
                try {
                    list = JSON.parse(raw) || [];
                } catch (e) {
                    list = [];
                }
            }

            this.params.options = [''].concat(list.map(item => item.id));

            this.translatedOptions = {'': ''};

            list.forEach(item => {
                let label = item.summary || item.id;

                if (item.primary) {
                    label += ' — principal (no recomendado)';
                }

                this.translatedOptions[item.id] = label;
            });

            const current = this.model.get('calendarId');

            if (current && !this.params.options.includes(current)) {
                this.params.options.push(current);

                this.translatedOptions[current] = current;
            }
        }
    };
});
