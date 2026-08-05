<?php

namespace Espo\Modules\GoogleCalendarSync\Controllers;

use Espo\Core\Templates\Controllers\Base;

/**
 * Controlador API de GcsAccount.
 *
 * EspoCRM resuelve el controlador de cada entidad por su ubicación
 * (`{Modulo}\Controllers\{Entidad}`) y no aplica ningún fallback: sin esta
 * clase, `GET /api/v1/GcsAccount` devuelve 404 aunque la entidad, la tabla y
 * los metadatos existan.
 *
 * `Templates\Controllers\Base` es el controlador de las entidades de tipo Base
 * y extiende `Espo\Core\Controllers\Record`, que aporta el CRUD estándar.
 *
 * GcsEventLink no necesita controlador: es una entidad interna
 * (`object: false`, sin ACL ni layouts) que solo se usa desde PHP a través de
 * EntityManager.
 */
class GcsAccount extends Base
{
}
