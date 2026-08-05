define(['views/settings/record/edit'], (Dep) => {

    /**
     * Pantalla de administración: credenciales OAuth de Google Calendar.
     */
    return class extends Dep {

        layoutName = 'gcsSettings'

        saveAndContinueEditingAction = false
    };
});
