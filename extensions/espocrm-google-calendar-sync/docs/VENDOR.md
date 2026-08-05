# Dependencias PHP — gestión reproducible

La extensión usa la librería oficial **`google/apiclient` ^2.18**. Las
extensiones de EspoCRM no se instalan vía Composer, así que el árbol `vendor/`
viaja **dentro del ZIP** y se registra en runtime desde
`Resources/autoload.json`.

Regla del repositorio:

| Artefacto | ¿En Git? | Cómo se obtiene |
|---|---|---|
| `composer.json` | **Sí** | Editado a mano |
| `composer.lock` | **Sí** | `make gcs-lock` (una vez, o al cambiar dependencias) |
| `vendor/` | **No** (en `.gitignore`) | `make gcs-deps` — reproducible desde el lock |
| ZIP | **No** (en `.gitignore`) | `make gcs-build` — incluye todo el `vendor/` |

## Flujo

```bash
make gcs-lock     # solo la primera vez o al cambiar dependencias: genera composer.lock
make gcs-deps     # instala las versiones EXACTAS del lock en vendor/
make gcs-build    # empaqueta el ZIP y lo verifica (deps + autoload + mapper + php -l)
```

Composer y PHP se ejecutan dentro de la imagen `composer:2`, así que **no hace
falta instalar nada en macOS más allá de Docker**. `make gcs-install` encadena
`gcs-deps` y `gcs-build` antes de instalar, de modo que nunca se instala un ZIP
construido con dependencias desactualizadas.

Para empezar de cero: `make gcs-clean && make gcs-deps && make gcs-build`.

## El ZIP es autónomo

`composer install` instala el árbol completo, así que el ZIP **no depende de
Guzzle, PSR, Monolog, phpseclib ni ninguna otra librería interna de EspoCRM**.
La lista exacta y sus versiones salen de `composer show --locked`; ver
`TEST_RESULTS.md` para la instantánea vigente.

### Por qué `phpseclib/phpseclib` es dependencia directa

`google/apiclient` **v2.19 lo retiró de sus `require`** (v2.18 sí lo exigía) y
`google/auth` solo lo declara como `suggest`. Pero el código instalado lo usa
de verdad:

- `google/auth/src/AccessToken.php` → `phpseclib3\Crypt\PublicKeyLoader`,
  `phpseclib3\Crypt\RSA`, `phpseclib3\Math\BigInteger` (verificación de ID tokens).
- `google/auth/src/ServiceAccountSignerTrait.php` → firma con RSA cuando no se
  fuerza OpenSSL.

Sin él, esos caminos fallarían en runtime. Por eso se declara explícitamente en
`composer.json` en lugar de confiar en que llegue como dependencia transitiva.
Fue `tools/check-dependencies.php` quien detectó la ausencia al actualizar la
librería, antes de empaquetar nada.

`tools/check-dependencies.php` lo comprueba de forma automática: carga
**únicamente** el `vendor/autoload.php` del paquete y exige que resuelvan tanto
las clases de Google como `GuzzleHttp\Client`, `Monolog\Logger`,
`phpseclib3\Crypt\RSA`, `Psr\Log\LoggerInterface`, etc. Si alguna faltara —es
decir, si el ZIP dependiera de que EspoCRM la aporte— la construcción falla.

### Matiz de precedencia en runtime

El ZIP contiene todo lo necesario, pero PHP solo carga una vez cada clase. El
`vendor/autoload.php` de Composer se registra con *prepend*, así que nuestras
copias tienen prioridad **salvo** que EspoCRM ya hubiera cargado esa clase
antes en la misma petición (por ejemplo su propio Guzzle). En ese caso se usa
la instancia ya cargada, que es de una versión compatible. Aislar los
namespaces por completo exigiría `php-scoper`, desproporcionado aquí.

Lo importante: la extensión **funciona aunque EspoCRM deje de incluir esas
librerías**, que era el objetivo.

## Sin limpieza manual

`composer.json` recorta `google/apiclient-services` mediante el script oficial:

```json
"extra": { "google/apiclient-services": ["Calendar"] },
"scripts": {
    "post-install-cmd": "Google\\Task\\Composer::cleanup",
    "post-update-cmd": "Google\\Task\\Composer::cleanup"
}
```

Sin esto, `vendor/` supera los 500 MB (Google publica cientos de servicios en
un solo paquete). El script está registrado en `install` **y** en `update`
porque al instalar desde el lock el paquete se extrae completo y hay que
recortarlo también entonces. **No hay que borrar nada a mano**;
`tools/check-dependencies.php` verifica que en `apiclient-services/src` solo
queda el directorio `Calendar`.

## Autoload

`Resources/autoload.json` se limita a cargar el autoloader generado por
Composer:

```json
{
    "autoloadFileList": [
        "custom/Espo/Modules/GoogleCalendarSync/vendor/autoload.php"
    ]
}
```

Así no hay que mantener a mano la lista de prefijos PSR-4 —que se desincroniza
en cuanto cambia una dependencia— y además se cargan los *files* de autoload de
los paquetes que los necesitan (funciones de Guzzle, polyfills). El fijado de
plataforma `"platform": {"php": "8.3.0"}` en `composer.json` hace que el lock se
resuelva para el PHP de la imagen oficial de EspoCRM, no para el de tu Mac.

## Cuándo hace falta refirmar el lock

Composer calcula un `content-hash` a partir de un subconjunto de campos de
`composer.json` —entre ellos `name` y `require`—. Si cambias cualquiera de
ellos, aunque no toques ninguna dependencia, el lock queda marcado como
desincronizado y `make gcs-deps` aborta.

```bash
make gcs-relock     # composer update --lock --no-install: refresca solo la firma
```

**No uses `make gcs-lock` para esto**: re-resuelve las dependencias y puede
subir versiones sin que lo pidas. Tras un relock, comprueba que el diff de
`composer.lock` solo toca `content-hash` y que ninguna versión ha cambiado.

## Actualizar dependencias

```bash
make gcs-lock          # recalcula composer.lock con las últimas versiones compatibles
make gcs-build         # reconstruye y vuelve a verificar
git diff -- extensions/espocrm-google-calendar-sync/files/custom/Espo/Modules/GoogleCalendarSync/composer.lock
```

Revisa el diff del lock antes de confirmar: es el registro de qué versiones
exactas se despliegan.
