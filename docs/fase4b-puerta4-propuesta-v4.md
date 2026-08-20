# Puerta 4 — v4: flag implementado, probado en repo y en instancia desechable

Consolida la decisión de `docs/fase4b-puerta4-propuesta-v3.md` §2 (alternativa
A adoptada, validación booleana estricta) con el código, las pruebas y el
ensayo desechable ya ejecutados. **v3 no queda invalidada** — su análisis
(por qué B no basta para el admin, por qué la ACL anticipada no es viable,
el orden de activación, el rollback, los backups) sigue vigente y se
reutiliza aquí sin repetirlo. Esta v4 solo añade: el código real, la
evidencia de las pruebas, y el cierre de los puntos que dependían de "si se
adopta A" (ya no son condicionales).

**Lo único ejecutado para producir este documento**: cambios en el
repositorio (código PHP nuevo/modificado, tests), y un EspoCRM 10.0.3
completamente desechable (`gapssa-flag-rehearsal-*`, red y contenedores
propios, sin volúmenes con nombre, sin tocar `gapssa_public`/`gapssa_private`),
destruido al terminar (`docker compose down`, verificado: cero contenedores,
cero redes, cero volúmenes residuales). **Cero operaciones contra
`gapssa-espocrm-1` real** — verificado al final: mismo hash
(`d56b05...185b4a22`) que antes de empezar, mismo uptime, sin reinicios.
`ESPO_BOOKING_ADAPTER` no se ha tocado en ningún entorno (sigue en
`simulated`). Sin commits.

## 1. Código implementado

### `DecisionFeatureFlag.php` (nuevo)

`extensions/espocrm/custom/Espo/Custom/Classes/Api/GapssaMeetingDecision/DecisionFeatureFlag.php`
— clase pura, un único método:

```php
final class DecisionFeatureFlag
{
    public static function isEnabled(mixed $value): bool
    {
        return $value === true;
    }
}
```

Comparación estricta (`===`), no "truthy" — clave ausente, `false`, `null`,
`0`/`1`, `"true"`/`"false"` (string), array, objeto: todos devuelven
`false`. Solo el booleano `true` devuelve `true`.

### `PutDecide.php` (modificado)

- Nueva constante: `private const DECISION_ENABLED_CONFIG_KEY = 'gapssaBookingDecisionEnabled';`
- Primera línea de `process()`, antes de `$meetingId = $request->getRouteParam('id')`:
  ```php
  if (!DecisionFeatureFlag::isEnabled($this->config->get(self::DECISION_ENABLED_CONFIG_KEY))) {
      throw ServiceUnavailable::createWithBody(
          'La decisión de reservas está deshabilitada temporalmente.',
          'meeting_decision_disabled',
      );
  }
  ```
- Import añadido: `use Espo\Core\Exceptions\ServiceUnavailable;`
- Docblock de la clase actualizado: nueva sección "## Interruptor de
  despliegue" (explica por qué ni la ACL de scope ni la política de
  autorización ni el modo mantenimiento pueden bloquear al admin, y por qué
  este interruptor sí) y nuevo paso "0." en el listado de "Orden exacto de
  la operación".
- Ocurre **después** del enrutado/autenticación general de EspoCRM (la
  petición ya llegó autenticada a `process()`) y **antes** de cualquier
  lógica o efecto de la decisión — no se afirma en ningún sitio que ocurra
  antes de la autenticación de EspoCRM, tal como pediste.

`php -l` sobre ambos ficheros: sin errores (verificado con el PHP real del
contenedor, `docker exec ... php -l`, solo lectura).

## 2. Pruebas — arnés PHP puro (sin bootstrap)

Añadidas a `extensions/espocrm/custom/tests/MeetingHooksPureLogicTest.php`
(mismo arnés existente, mismo patrón `check()`, sin PHPUnit, sin `Espo\...`
en las clases bajo prueba):

- 13 comprobaciones de `DecisionFeatureFlag::isEnabled()` — los 8 valores
  exigidos por el encargo (ausente/`null`, `false`, `0`, `1`, `"false"`,
  `"true"`, array, objeto) más `1.0` (float) y `""` (string vacía) como
  casos adicionales, y el único caso positivo (`true`).
- 12 comprobaciones de una función `wouldDecide()` que compone
  `DecisionFeatureFlag::isEnabled() && MeetingDecisionAuthorizationPolicy::isAuthorized()`
  — el mismo orden exacto que `PutDecide::process()` — para demostrar a
  nivel puro: admin/API autorizado/humano autorizado bloqueados con
  flag ausente/`false`/corrupto; y que con flag `true` el resultado es
  idéntico a la matriz de autorización ya probada (sin alterarla).

**Resultado**: `php extensions/espocrm/custom/tests/MeetingHooksPureLogicTest.php`
→ **109/109** (84 previas + 25 nuevas), ejecutado con el PHP local del
host (8.3.12), sin bootstrap de EspoCRM, sin tocar ningún contenedor.

**Límite explícito, igual que el resto del arnés**: esto prueba la lógica
de `DecisionFeatureFlag` en aislamiento y la composición lógica del orden
de las dos puertas — no prueba que `PutDecide::process()` real ejecute
ese orden exacto contra HTTP/ACL/transacción/DB reales. Eso es
exactamente lo que cubre el punto 3.

## 3. Ensayo desechable — EspoCRM 10.0.3 completo, aislado

### 3.1 Topología

| Componente | Detalle |
|---|---|
| Proyecto compose | `gapssa-flag-rehearsal` (aparte de `gapssa`) |
| EspoCRM | `espocrm/espocrm:10.0.3-apache-trixie` (misma imagen que producción), contenedor `gapssa-flag-rehearsal-espocrm-1`, `127.0.0.1:8099` |
| MariaDB | `mariadb:11.4` (misma imagen que producción), contenedor `gapssa-flag-rehearsal-espocrm-db-1`, sin puerto publicado |
| Red | `gapssa-flag-rehearsal_default` — propia, sin unirse a `public`/`private`/`apps-private` reales |
| Volúmenes | Ninguno con nombre — capa de escritura del contenedor únicamente |
| Código desplegado | El árbol de trabajo completo de `extensions/espocrm/custom/` (incluye el flag ya implementado) vía `docker cp`, `sql/install.sql` ejecutado, `bin/command rebuild` |
| Usuarios/roles/API Key | Todos ficticios, creados vía script PHP con `setupSystemUser()` (mismo mecanismo nativo que las Puertas 3/3B) — ninguno real, ninguno incrustado en el repo |

Verificado antes de empezar: contenedor de producción (`gapssa-espocrm-1`)
en 6 servicios `Up`/`healthy`, sin relación de red con el proyecto nuevo.

### 3.2 Fixtures creados (todos en la instancia desechable, ninguno real)

- Rol `API Rehearsal Role` / `Human Rehearsal Role`: `Meeting`
  create=yes/read=all/edit=all/delete=no/stream=no; campo
  `cEstadoReserva`/`cMotivoResolucionReserva` en `read:yes,edit:yes` — el
  ACL que la Puerta 4 real aplicaría (§2 de v3), reproducido aquí para que
  el ensayo pruebe la interacción real, no una versión simplificada.
- Usuario `rehearsal-api` (`type=api`, `authMethod=ApiKey`) y usuario
  `rehearsal-human` (`type=regular`) — cada uno con su id escrito en
  `gapssaBookingDecisionAuthorizedApiUserIds`/`...UserIds` respectivamente,
  vía `ConfigWriter` nativo (mismo mecanismo de la Puerta 4 real, v3 §4).
- Usuario `rehearsal-human-unauth` (`type=regular`, mismo rol, pero **sin**
  figurar en ninguna lista) — para probar que `true` no autoriza de más.
- `admin` — el usuario admin nativo del aprovisionamiento del contenedor
  desechable (no el admin real).
- Varios `Meeting` frescos en `cEstadoReserva=PendingCenterApproval`, uno
  por escenario que debía terminar en éxito (para no contaminar resultados
  entre escenarios).

### 3.3 Resultados — flag ausente

`PUT /api/v1/GapssaMeetingDecision/{id}` con `decision=Confirmed,
resultReason=Approved`:

| Actor | HTTP | Cuerpo |
|---|---|---|
| admin | 503 | `meeting_decision_disabled` |
| `rehearsal-api` (autorizado) | 503 | `meeting_decision_disabled` |
| `rehearsal-human` (autorizado) | 503 | `meeting_decision_disabled` |

`Meeting` tras los 3 intentos: `cEstadoReserva=PendingCenterApproval`,
`cMotivoResolucionReserva=NULL` (sin tocar). `gapssa_meeting_decision_operation`: `0` filas.

### 3.4 Resultados — flag `false` y valores corruptos representativos

Mismos 3 actores, contra los mismos ids de Meeting reutilizados (sin
cambiar de estado en ningún momento, confirmando cada vez), para cada
valor: `false`, `null`, `0`, `1`, `"false"` (string), `"true"` (string),
`[]` (array vacío), `{}` (objeto vacío) — **24 intentos en total (8 valores
× 3 actores), los 24 con `HTTP 503 meeting_decision_disabled`**. `Meeting`
sin tocar tras los 24; tabla de operaciones en `0` filas durante toda esta
fase.

### 3.5 Resultados — flag `true`

| Actor | Meeting | HTTP | Resultado |
|---|---|---|---|
| admin | fresco A | **200** | `cEstadoReserva=Confirmed`, `cMotivoResolucionReserva=Approved` |
| `rehearsal-api` (autorizado) | fresco B | **200** | igual |
| `rehearsal-human` (autorizado) | fresco C | **200** | igual |
| `rehearsal-human-unauth` (NO autorizado) | fresco D | **403** | Forbidden — política de autorización intacta, el flag en `true` no autoriza a nadie por sí solo |

`gapssa_meeting_decision_operation` tras esta fase: **exactamente 3 filas**
(las 3 decisiones exitosas — admin/API/humano autorizado), `0` para el
intento del usuario no autorizado (bloqueado antes de llegar a la tabla).
**Coincide exactamente con la matriz de autorización ya validada en
`docs/fase4b-decision-flow-final.md` §0.1.5** — el flag no la altera, solo
la antecede.

### 3.6 Concurrencia mínima con flag `false`

Un `Meeting` fresco, **10 peticiones `PUT` genuinamente concurrentes**
(lanzadas en paralelo, `wait` hasta que todas responden) desde el API User
autorizado, cada una con `operationKey` distinta: **las 10 devolvieron
`503 meeting_decision_disabled`**. `Meeting` tras las 10: sin tocar.
`gapssa_meeting_decision_operation`: seguía en `3` filas (las de §3.5,
ninguna nueva) — cero efecto parcial, cero fila de idempotencia generada
por ningún intento bloqueado.

### 3.7 Teardown

`docker compose down` (proyecto `gapssa-flag-rehearsal`) — verificado tras
ejecutar: `docker ps -a`, `docker network ls`, `docker volume ls`, los tres
sin ninguna entrada de `flag-rehearsal`. Cero residuos.

## 4. Validación proporcional — resultado completo

| Comprobación | Resultado |
|---|---|
| `php -l` (`PutDecide.php`, `DecisionFeatureFlag.php`) | OK, sin errores |
| Arnés PHP puro (`MeetingHooksPureLogicTest.php`) | **109/109** |
| `npm run typecheck` (`apps/web`) | OK, sin errores — ningún fichero TypeScript tocado por este cambio |
| `npm run lint` (`apps/web`) | OK, sin errores |
| Tests TS relevantes | No aplica ningún cambio de comportamiento del lado BFF — `httpEspoAdapter.ts` ya trata cualquier respuesta de error de EspoCRM de forma genérica vía `EspoApiError`; no se ha tocado ni haría falta tocar ese código para este flag |
| `make gcs-test` | OK — ZIP 1.1.1 íntegro, extensión Google Calendar Sync no afectada |
| Ensayo desechable (§3) | OK — todos los escenarios exigidos, resultados exactos arriba |
| Escaneo de secretos (diff de los 3 ficheros tocados/nuevos) | Sin coincidencias (`api_key`/`secret`/`password`/`token`) |
| `git diff --check` | OK, sin errores de espacio en blanco |
| Commits | Ninguno |

## 5. Documentación — estado final de la Puerta 4 con el flag

- **La Puerta 4 termina siempre con `gapssaBookingDecisionEnabled=false`**
  escrito explícitamente (no ausente — escrito y verificado en `false`,
  fase 7 del orden de v3 §4). Ausente y `false` se comportan igual en
  tiempo de ejecución, pero dejarlo escrito explícitamente documenta la
  intención y evita depender de que "ausente" siga significando "apagado"
  si algún día cambiara el valor por defecto de `DecisionFeatureFlag`.
- **Fase 10 de v3 §4 (activación del flag) queda eliminada de la Puerta
  4.** La Puerta 4, tal como queda definida ahora, nunca activa el flag.
- **Activar `gapssaBookingDecisionEnabled=true` pasa a ser el primer paso
  controlado de la Puerta 5** — con su propia aprobación explícita,
  separada de la aprobación de la Puerta 4, y con **rollback inmediato a
  `false`** como parte del mismo paso si algo del resto de la Puerta 5 no
  sale como se espera (no se espera a terminar toda la Puerta 5 para poder
  revertir el flag).
- **Con el flag en `false`, la ruta puede existir y responder** (routes.json
  desplegado, código cargado) **pero ningún actor — admin incluido — puede
  ejecutar una decisión con efecto real**: la comprobación es la primera
  operación de negocio de `process()`, antes de ACL, `Meeting` o la tabla
  de idempotencia. Confirmado empíricamente en §3.3/§3.4/§3.6 contra una
  instancia real (aunque desechable) — no es solo un argumento de diseño.
- `ESPO_BOOKING_ADAPTER` se mantiene en `simulated` en todos los entornos
  — sin cambios, sin llamadas al EspoCRM real en ningún punto de esta fase.

### Resultado de la Puerta 4 — actualizado respecto a v3 §8

Ya no aplica la distinción condicional de v3 §8 ("si se adopta A y el flag
queda en `false`..." / "si no se adopta A...") — A está adoptada y el
flag SIEMPRE queda en `false` al cerrar la Puerta 4. Por tanto:

**Ningún actor puede invocar `PutDecide` con efecto al terminar la Puerta
4** — ni el admin único de la instancia real, ni `portal-gapssa-api`
(aunque su id ya esté en la allowlist, escrita como parte de la propia
Puerta 4), ni nadie más. La ruta existe y responde `503
meeting_decision_disabled` a cualquiera. Esto es ahora una garantía
verificada empíricamente (§3), no solo una intención de diseño.

## 6. Manifiesto — hashes actualizados

Respecto al manifiesto de `fase4b-puerta4-propuesta-v2.md` §5 (reutilizado
sin cambios por v3): **solo estos 3 archivos cambian** — el resto de
hashes del manifiesto siguen vigentes tal cual, no se recalculan aquí.

| Archivo | SHA-256 nuevo | Bytes | Motivo |
|---|---|---|---|
| `Classes/Api/GapssaMeetingDecision/PutDecide.php` | `a989a334abad443648e10b6b2c8e5760be91dc4d4c48cb8786c4ca8bc281d234` | 21623 (antes 19685) | Constante + comprobación del flag + docblock ampliado |
| `Classes/Api/GapssaMeetingDecision/DecisionFeatureFlag.php` | `36f1c9409740c113dfd5a09f07c8656bc67c0fa54e38abfb271ddb3486b8f9b0` | 1447 | **Nuevo** — no estaba en el manifiesto v2/v3, se añade a la lista de "nuevos" de §5.2 (ahora 5 archivos en esa sección, no 4) |
| `tests/MeetingHooksPureLogicTest.php` | `32000751d40bd886697782b8b61627bb3bdcb08104afd56ff1af5d0cbbaa939f` | 29955 (antes no listado — no forma parte del despliegue a EspoCRM real, es arnés de repositorio) | +25 comprobaciones nuevas — incluido aquí como evidencia, no como archivo a copiar al contenedor real |

`DecisionFeatureFlag.php` se despliega en la Puerta 4 real en la misma
fase que el resto del código servidor (v3 §4, fase 6 — "clases PHP y
hooks, sin publicar `routes.json` todavía"), junto a los otros 10 archivos
PHP ya listados.

---

**Nada de esto se ha ejecutado contra EspoCRM real.** Cambios de
repositorio (código + tests) autorizados y aplicados; ensayo desechable
autorizado, ejecutado y destruido. Queda a la espera de tu revisión y de
una nueva autorización explícita, por separado, para la primera fase real
de la Puerta 4.
