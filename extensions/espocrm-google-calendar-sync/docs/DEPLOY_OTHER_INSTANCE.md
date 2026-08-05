# Instalar la extensión en otro EspoCRM

La extensión es independiente del proyecto donde se desarrolló. No requiere
entidades personalizadas, ni configuración previa, ni Composer en el servidor
de destino: el ZIP lleva dentro `google/apiclient` y todas sus dependencias.

## Requisitos del destino

- EspoCRM **10.0.x**. Probado en 10.0.3; el manifiesto declara
  `acceptableVersions: [">=10.0.0 <11.0.0"]`, así que EspoCRM rechazará la
  instalación en la familia 11 hasta que se pruebe.
- PHP **8.3+** con `curl` y `json` — la imagen oficial los trae. Es el mínimo
  de EspoCRM 10 (`>=8.3.0 <8.6.0`) y el que fija `platform.php` en el lock.
- **Cron de EspoCRM operativo**. Sin cron no se procesan los jobs y no se
  exporta ninguna cita. Es el requisito que más se pasa por alto.
- El módulo CRM activo: la extensión sincroniza la entidad nativa `Meeting`.

## Pasos

1. **Construir el ZIP** (en tu máquina de desarrollo, una sola vez por versión):

   ```bash
   make gcs-deps && make gcs-build
   ```

   Produce `extensions/espocrm-google-calendar-sync/build/google-calendar-sync-{versión}.zip`.
   El mismo archivo sirve para cualquier instancia.

2. **Instalar**: en el EspoCRM de destino, Administración → Extensiones →
   subir el ZIP. O por consola:

   ```bash
   bin/command extension --file="google-calendar-sync-1.1.0.zip"
   bin/command rebuild
   ```

3. **Credenciales de Google** para esa instancia: sigue
   `GOOGLE_CLOUD_SETUP.md`. Dos opciones:

   - **Un proyecto de Google Cloud por cliente** (recomendado si son
     organizaciones distintas): aislamiento total de cuotas y consentimiento.
   - **Reutilizar un mismo cliente OAuth**: basta con añadir el redirect URI de
     la nueva instancia (`https://otro-crm.com/?entryPoint=gcsCallback`) a la
     lista de URIs autorizados. Cómodo si administras varias instalaciones tuyas.

4. **Conectar y verificar**: `OAUTH_SETUP.md` para conectar la cuenta Business
   y elegir calendario; después, la comprobación previa de `TESTING.md`
   (`GET /api/v1/GcsAccount` debe devolver 200).

## Qué es propio de cada instancia

Nada se comparte entre instalaciones: credenciales OAuth, tokens, cuenta
Business, calendario elegido y vínculos cita↔evento viven en la base de datos
de cada CRM.

Cada instancia debe sincronizar **su propio calendario de Google**. Si dos
EspoCRM apuntan al mismo calendario, sus exportaciones se pisarán: los eventos
llevan `extendedProperties.private.espoMeetingId` y los identificadores de cita
de una instancia no significan nada en la otra.

## Idioma

La interfaz está en inglés y español (`en_US`, `es_ES`) y EspoCRM elige según
el idioma del usuario. Los mensajes de error guardados en el campo *Último
error* usan el **idioma por defecto de la instancia**. Para añadir otro idioma
basta con copiar `Resources/i18n/en_US/` a la nueva carpeta y traducir;
`tests/i18n_test.php` avisará si queda alguna clave sin traducir.

## Al actualizar

`make gcs-build` y volver a subir el ZIP. La actualización conserva cuentas,
tokens, vínculos y configuración (ver `UPGRADE.md`). No hace falta reconectar
Google.
