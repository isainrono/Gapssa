# Fase 4B — Revisión correctiva OCC 3: capacidad nominal cerrada en `AtomicDecisionContext`

Revisión dedicada exclusivamente al hueco de autorización interna señalado
sobre la revisión OCC 2 (`docs/fase4b-occ-revision-2.md`): `AtomicDecisionContext`
guardaba únicamente un booleano estático `$active`, sin atarlo al Meeting ni
a la transición concretos que `PutDecide` había autorizado bajo el lock de
fila de su propia transacción. Objetivo único: sustituirlo por una
capacidad nominal cerrada, demostrar empíricamente en una instancia
EspoCRM 10.0.3 desechable **nueva** que el ataque descrito en el encargo
(escritura anidada sobre un Meeting distinto durante `PutDecide`) queda
bloqueado, y declarar APROBADO o BLOQUEADO con el mismo nivel de exigencia
que las revisiones anteriores.

**Ningún dato, servicio, volumen, red, campo, API User ni credencial reales
se ha tocado.** No se ha ejecutado ninguna de las cinco puertas reales
pendientes (§8). No se ha tocado `editor@gapssa.test`. No se ha avanzado a
ninguna otra fase. No se ha hecho ningún commit. Toda la investigación de
código fuente (`Espo\ORM\Entity::getFetched()`/`getId()`,
`Espo\ORM\BaseEntity`) fue de solo lectura contra el contenedor real
(`gapssa-espocrm-1`); todas las escrituras y pruebas corrieron contra una
instancia EspoCRM+MariaDB completamente desechable
(`gapssa-occ-rehearsal-3`), aislada por nombre de proyecto
(`COMPOSE_PROJECT_NAME=gapssa-occ-rehearsal-3`), red, volúmenes y puertos
(`8092`/`8094`, distintos de los `8081`/`8083` reales) del stack real y de
los ensayos anteriores. El entorno desechable se ha eliminado por completo
al terminar (`docker compose ... down -v` — cero contenedores, volúmenes o
redes residuales, verificado). Sin commits — este documento y el código
nuevo en `extensions/espocrm/custom` son el único rastro que queda,
pendientes de tu revisión.

**Conclusión anticipada (desarrollada en §7): APROBADO.**

## 1. El hueco (confirmado, antes de corregirlo)

`AtomicDecisionContext` (revisión OCC 2):

```php
final class AtomicDecisionContext
{
    private static bool $active = false;

    public static function runActive(callable $callback) { /* ... */ }
    public static function isActive(): bool { return self::$active; }
}
```

`GuardMeetingDecisionTransition` confiaba en `AtomicDecisionContext::isActive()`
— un booleano genérico, verdadero mientras **cualquier** llamada a
`PutDecide` sostuviera el lock de fila de **su propio** Meeting dentro de
`Service::update()`. El hueco: mientras esa llamada a `Service::update()`
está en curso, cualquier hook adicional (`beforeUpdate`/`afterUpdate`,
clásico o `RecordHook`, propio o de una extensión futura) que intentara
actualizar un Meeting **distinto** hacia `Confirmed`/`Canceled` vería
`isActive() === true` y quedaría autorizado igual — sin que `PutDecide`
hubiera validado nunca, bajo ningún lock, que ese Meeting distinto seguía
en `PendingCenterApproval`. La capacidad temporal estaba ligada a "hay una
petición PHP con una decisión en curso", no al recurso y la transición
exactos que esa petición había autorizado.

Este hueco es distinto — y posterior — al que corrigió la revisión OCC 2
(la "decisión fantasma": una escritura del guard confirmada de forma
independiente del resto del guardado). Aquí la frontera transaccional ya
era correcta (una única transacción, un único commit); lo que faltaba era
que la señal de confianza *dentro* de esa transacción distinguiera **qué**
Meeting y **qué** transición tenía permiso, no solo si "hay una decisión en
curso en algún sitio".

## 2. Corrección — capacidad nominal cerrada

### 2.1 `AtomicDecisionContext`

Sustituye el booleano por una instancia privada e inmutable
(`Classes/Api/GapssaMeetingDecision/AtomicDecisionContext.php`), cerrada al
`meetingId`/`sourceState`/`targetState` exactos:

```php
final class AtomicDecisionContext
{
    private static ?self $current = null;

    private function __construct(
        private readonly string $meetingId,
        private readonly string $sourceState,
        private readonly string $targetState,
        private readonly ?string $operationKey,
    ) {}

    public static function runAuthorized(
        string $meetingId,
        string $sourceState,
        string $targetState,
        callable $callback,
        ?string $operationKey = null,
    ) {
        if (self::$current !== null) {
            throw new \LogicException('AtomicDecisionContext ya estaba activo — anidamiento no soportado.');
        }

        self::$current = new self($meetingId, $sourceState, $targetState, $operationKey);

        try {
            return $callback();
        } finally {
            self::$current = null;
        }
    }

    public static function authorizes(string $meetingId, string $sourceState, string $targetState): bool
    {
        $context = self::$current;

        if ($context === null) {
            return false;
        }

        return $context->meetingId === $meetingId
            && $context->sourceState === $sourceState
            && $context->targetState === $targetState;
    }
}
```

Puntos deliberados:

- **No hay `isActive()` genérico.** El único método de lectura,
  `authorizes()`, exige los tres valores exactos — no existe forma de
  interpretar un `true` como "autorización universal para esta petición".
- **`operationKey` es opcional y puramente informativo.** Se guarda para
  trazabilidad interna (quién lo llamó), pero nunca participa en la
  comprobación de `authorizes()`, nunca se expone en excepciones, logs,
  auditoría ni persistencia — sale de este fichero solo si algún día se
  añadiera un log explícito, cosa que hoy no ocurre en ningún sitio del
  árbol.
- **`self::$current` sigue siendo `static`** — misma justificación que la
  revisión 2 (cabecera del fichero): Apache+PHP clásico
  (`espocrm/espocrm:10.0.3-apache-trixie`), un proceso/intérprete nuevo por
  petición HTTP, sin estado compartido entre peticiones. El cambio de esta
  revisión es de **forma** del estado (de un booleano a un objeto cerrado
  con tres claves), no de su ciclo de vida ni de su mecanismo de
  aislamiento entre peticiones — ese sigue siendo exactamente el de la
  revisión 2.
- **Anidamiento sigue prohibido de la misma forma**: `runAuthorized()`
  lanza `LogicException` si ya hay un contexto activo, sin ninguna forma de
  sustituir temporalmente la capacidad exterior por una interior — no hay
  ninguna ruta de código que permita un `push`/`pop` de contextos, solo
  "activo o no". `finally` limpia siempre, incluida la excepción de
  anidamiento.

### 2.2 `PutDecide`

Único cambio: la llamada pasa ahora los tres valores exactos que ya tenía
disponibles (`$meetingId` de la ruta, `$currentEstadoReserva` ya verificado
como `PendingCenterApproval` en la línea anterior, `$decision` del
payload validado) más `$operationKey` para trazabilidad:

```php
$updateResult = AtomicDecisionContext::runAuthorized(
    $meetingId,
    $currentEstadoReserva,
    $decision,
    fn () => $this->recordServiceContainer
        ->get(Meeting::ENTITY_TYPE)
        ->update($meetingId, $data, UpdateParams::create()),
    $operationKey,
);
```

Nada más de `PutDecide` cambia — sigue siendo la única dueña de la
transacción completa, con el mismo orden de 9 pasos que la revisión OCC 2
(`docs/fase4b-occ-revision-2.md` §4.1), sin relajar ninguna de sus
garantías.

### 2.3 `GuardMeetingDecisionTransition`

Ya no basta con "hay un contexto activo": exige que
`AtomicDecisionContext::authorizes()` confirme el Meeting, el estado de
origen real y el destino solicitado, los tres exactos:

```php
$requested = $entity->get('cEstadoReserva');
// Valor previo a este set(), cargado desde BD al construir la entidad —
// no el ya mutado en memoria.
$original = $entity->getFetched('cEstadoReserva');

if (
    is_string($original)
    && AtomicDecisionContext::authorizes((string) $entity->getId(), $original, $requested)
) {
    return;
}

throw Conflict::createWithBody(/* ... */);
```

`Entity::getFetched(string $attribute)` — verificado línea por línea contra
`application/Espo/ORM/BaseEntity.php` del contenedor real
(`gapssa-espocrm-1`, solo lectura): conserva el valor cargado de BD en
`$fetchedValuesContainer`, poblado al construir la entidad, y **no** se
sobrescribe cuando `set()` cambia el valor en memoria — exactamente el
mecanismo que ya usa internamente `isAttributeChanged()` (usado por este
mismo hook desde la revisión 2) para comparar "antes" contra "después".
`Entity::getId(): string` — verificado igual, sin novedad. Ninguna
suposición sin verificar contra el código fuente real.

Esto cierra las cuatro discrepancias que dejaba pasar `isActive()`:

| Ataque | `isActive()` (revisión 2) | `authorizes()` (esta revisión) |
|---|---|---|
| Meeting distinto, dentro de la misma petición de `PutDecide` | Deja pasar (hueco) | Rechaza — `meetingId` no coincide |
| Mismo Meeting, destino distinto al autorizado | Deja pasar (hueco teórico) | Rechaza — `targetState` no coincide |
| Mismo Meeting, origen real distinto al autorizado (ya mutado por otra vía antes de este guardado) | Deja pasar (hueco teórico) | Rechaza — `sourceState` no coincide |
| Sin ninguna llamada activa a `PutDecide` | Rechaza | Rechaza (sin cambio) |
| Meeting/origen/destino exactos autorizados por `PutDecide` | Deja pasar (correcto) | Deja pasar (sin cambio) |

Nada más de este hook cambia — sigue sin escribir nada, sigue siendo
exclusivamente una guarda de la máquina de estados (ver cabecera completa
del fichero para la historia previa, sin cambios respecto a la revisión
2).

## 3. Modelo de capacidad limitada

Resumen del diseño, para referencia futura:

- **Capacidad, no bandera.** El objeto `self::$current` es una prueba de
  "PutDecide autorizó exactamente esto", no un semáforo de "hay una
  operación en marcha". La diferencia es exactamente la que corrige el
  hueco: una bandera se pregunta *si*, una capacidad se pregunta *para
  qué exactamente*.
- **Cerrada, no interpretable.** No existe ningún método que devuelva el
  contexto activo entero, ni sus campos por separado — solo `authorizes()`,
  que consume los tres valores y devuelve un booleano atado a ellos. No hay
  forma de leer "hay una capacidad viva" sin decir para qué se está
  preguntando.
- **De un solo uso, sin composición.** No hay `push`/`pop`, ni pila, ni
  forma de que una capacidad interior sustituya a una exterior — solo
  "activa o no", con `LogicException` en cualquier intento de solaparlas.
  Esto es intencional: el único llamador legítimo (`PutDecide`) nunca
  necesita anidar sus propias llamadas, así que cualquier intento de
  anidamiento es, por definición, o un error de programación o un ataque —
  ambos deben fallar cerrado.
- **`operationKey` es metadato, no autorización.** Se acepta como parámetro
  para trazabilidad interna futura (p. ej. si algún día se añade
  logging estructurado), pero deliberadamente no participa en
  `authorizes()` — mezclar un identificador de idempotencia (que el
  llamante controla) con la comprobación de autorización habría sido una
  superficie de confusión innecesaria.

## 4. Pruebas PHP puras (sin bootstrap de EspoCRM)

Ampliado `extensions/espocrm/custom/tests/MeetingHooksPureLogicTest.php`
con las 9 comprobaciones exigidas por el encargo (más las ya existentes de
`EstadoReservaStatusMap`/`MeetingDecisionTransitionPolicy`/
`DecisionIdempotencyStore::hashPayload`, sin cambios):

1. Meeting correcto + decisión correcta → permitido.
2. Meeting distinto + misma decisión → rechazado.
3. Meeting correcto + decisión distinta → rechazado.
4. Origen distinto → rechazado.
5. Ausencia de contexto → rechazado.
6. Contexto anidado → rechazado (`LogicException`), contexto limpio
   después.
7. Excepción dentro del callback → contexto limpiado (`finally`).
8. Actualización anidada simulada de otro Meeting (misma forma que el
   escenario 2 — `authorizes()` sobre un `meetingId` distinto mientras el
   contexto del primero sigue activo) → rechazada.
9. Una operación posterior legítima funciona con normalidad después de una
   excepción/anidamiento previos.

Además: `operationKey` no participa en `authorizes()` (comprobación
explícita: mismo Meeting/origen/destino con y sin `operationKey` da el
mismo resultado).

```
$ php extensions/espocrm/custom/tests/MeetingHooksPureLogicTest.php
OK — 42 comprobaciones pasaron (MeetingHooksPureLogicTest).
```

(42 = las 15 de `EstadoReservaStatusMap` + 6 de
`MeetingDecisionTransitionPolicy` + 15 de `AtomicDecisionContext` (esta
revisión) + 6 de `DecisionIdempotencyStore::hashPayload`, sin bootstrap de
EspoCRM, sin tocar ninguna base de datos.)

## 5. Ensayo en vivo — EspoCRM 10.0.3 desechable (`gapssa-occ-rehearsal-3`)

### 5.1 Entorno

`docker compose --env-file <.env desechable, solo en el scratchpad de esta
sesión> -p gapssa-occ-rehearsal-3 up -d espocrm-db espocrm` — mismo
`compose.yml`/misma imagen (`espocrm/espocrm:10.0.3-apache-trixie`,
`mariadb:11.4`) que el stack real, proyecto/red/volúmenes/puertos
(`8092`/`8094`) completamente distintos. Contraseñas de admin/DB generadas
solo para este ensayo, nunca reutilizadas de `.env` real.

Despliegue **acotado al alcance de esta corrección** — deliberadamente
más reducido que el ensayo de la revisión 2, documentado sin ocultarlo:

- Los 7 ficheros reales de `Classes/Api/GapssaMeetingDecision/*` y
  `Classes/RecordHooks/Meeting/{EstadoReservaStatusMap,
  GuardMeetingDecisionTransition,MeetingDecisionTransitionPolicy,
  SyncEstadoReservaToStatus}.php` + `Resources/routes.json`, copiados tal
  cual.
- `entityDefs/Meeting.json` **simplificado**: solo el campo
  `cEstadoReserva` (se omiten los links `cTratamiento`/`cZonaAtencion`,
  que dependen de las entidades custom `CTratamiento`/`CZonaAtencion`,
  ajenas por completo a este guard — incluirlas habría exigido desplegar
  también esas dos entidades sin aportar nada a la prueba del hueco de
  autorización).
- `recordDefs/Meeting.json` **simplificado**: se omiten
  `SendInvitationsAfterCreate`/`SendInvitationsAfterUpdate` (hooks de
  invitaciones por correo, ajenos a este guard) del
  `afterCreate`/`afterUpdateHookClassNameList` real. Se conservan
  íntegros `SyncEstadoReservaToStatus` (`beforeCreate`/`beforeUpdate`) y
  `GuardMeetingDecisionTransition` (`beforeUpdate`) — los dos únicos hooks
  relevantes para esta corrección.
- `sql/install.sql` ejecutado tal cual contra la MariaDB desechable.

Confirmado con `bin/command app-check` en verde tras cada `rebuild`.

**Nota metodológica, sin relación con la corrección**: el primer intento
de instalar Google Calendar Sync (§5.7) falló por una `DivisionByZeroError`
en `Espo\Core\Utils\Currency\DatabasePopulator` — la instancia recién
creada tenía `defaultCurrency=EUR` (fijado por `compose.yml`) pero
`currencyList=[USD]` únicamente (comportamiento de instalación limpia de
la imagen oficial sin configuración adicional de moneda). Se corrigió
añadiendo `'EUR'` a `currencyList` en el `config.php` **de esta instancia
desechable únicamente**, con un one-liner PHP ejecutado dentro del
contenedor de ensayo. Verificado que el contenedor real
(`gapssa-espocrm-1`) **no** tiene este problema: ya tiene
`currencyList=[USD, EUR]` y, además, `baseCurrency=EUR=defaultCurrency`
(lo que evita esa rama de código por completo) — confirmado por lectura
directa de su `config.php`, sin modificarlo. No es un hallazgo de esta
revisión, solo una peculiaridad de bootstrap del entorno desechable,
documentada por transparencia.

### 5.2 Escenario 1 — decisión normal

Meeting fresco en `PendingCenterApproval`, `PUT /GapssaMeetingDecision/{id}`
`{"decision":"Confirmed","note":"aprobado en ensayo","operationKey":"s1-op-key-001"}`:

```
HTTP 200 {"status":"confirmed","cEstadoReserva":"Confirmed","meetingStatus":"Planned","modifiedById":"<admin>",...}
BD: c_estado_reserva=Confirmed, status=Planned, modified_by_id=<admin>, description="aprobado en ensayo"
```

### 5.3 Escenario 2 — `PUT` genérico bloqueado

Meeting fresco en `PendingCenterApproval`, `PUT /Meeting/{id}`
`{"cEstadoReserva":"Canceled"}` (sin pasar por `PutDecide`):

```
HTTP 409 meeting_decision_requires_atomic_action
BD: c_estado_reserva=PendingCenterApproval (sin cambio), modified_by_id=NULL
```

### 5.4 Escenario 3 — actualización anidada de OTRO Meeting durante `PutDecide` (el hueco corregido)

El escenario central de esta revisión. Hook de ensayo
`FaultInjectionNestedMeetingUpdate` (`afterUpdate` de `Meeting`, **solo en
el contenedor desechable, nunca en el repositorio**): cuando el Meeting que
se está guardando lleva `description === 'NESTED_ATTACK_TRIGGER'`, busca
otro Meeting por `name === 'NESTED_ATTACK_TARGET'` e intenta decidirlo
(`cEstadoReserva → Confirmed`) vía el mismo `ServiceContainer` que usa
`PutDecide` — simulando cualquier hook futuro (propio o de una extensión)
que, disparado dentro del `Service::update()` que `PutDecide` ya envuelve
en `AtomicDecisionContext::runAuthorized()` para el Meeting A, intentara
tocar un Meeting B distinto.

Meeting A (disparador) y Meeting B (`NESTED_ATTACK_TARGET`) frescos en
`PendingCenterApproval`. `PUT /GapssaMeetingDecision/{A}`
`{"decision":"Confirmed","note":"NESTED_ATTACK_TRIGGER","operationKey":"s3-op-key-001"}`:

```
HTTP 409 meeting_decision_requires_atomic_action
BD tras la petición:
  A (disparador): c_estado_reserva=PendingCenterApproval (sin cambio — la transacción completa se revirtió)
  B (target):     c_estado_reserva=PendingCenterApproval (sin cambio — el guard lo rechazó)
Fila de idempotencia para s3-op-key-001: 0 (todo se revirtió, incluida la propia decisión legítima de A)
```

`GuardMeetingDecisionTransition::authorizes()` rechaza el intento sobre B
porque el contexto activo autoriza el `meetingId` de A, no el de B — la
`Conflict` se propaga sin capturar a través de `Service::update()` de A,
hasta el `catch` único de `PutDecide::process()`, que la relanza tal cual
(409) y revierte **toda** la transacción (incluida la decisión legítima de
A, que nunca llega a confirmarse). Comportamiento correcto: ante cualquier
discrepancia, "no modificar nada" — exactamente lo exigido por el encargo.

**Test de control — el mismo ataque contra el código PRE-FIX**, para
confirmar que este ensayo detecta realmente el hueco y no es un falso
negativo: se redesplegaron temporalmente copias exactas de la
`AtomicDecisionContext`/`GuardMeetingDecisionTransition`/`PutDecide` de la
revisión OCC 2 (con `isActive()`/`runActive()` genéricos, reconstruidas
del propio historial de esta conversación, nunca commiteadas) sobre el
mismo contenedor desechable, y se repitió exactamente el mismo payload.
Resultado:

```
HTTP 200 {"status":"confirmed",...}  (la decisión de A se aceptó con normalidad)
BD: el Meeting B ("NESTED_ATTACK_TARGET") quedó c_estado_reserva=Confirmed,
    modified_by_id=<admin> — SIN que ninguna llamada a PutDecide lo hubiera
    autorizado nunca, exclusivamente porque isActive() era verdadero
    durante la actualización de A.
```

Confirmado: el código pre-fix **sí** era vulnerable al ataque exacto que
describe el encargo; el código corregido de esta revisión lo bloquea. Se
redesplegó de inmediato el código corregido (verificado con `app-check` en
verde) antes de continuar con el resto de escenarios.

### 5.5 Escenario 4 — concurrencia `Confirmed` vs `Canceled`

Mismo Meeting fresco en `PendingCenterApproval`, dos peticiones
`PUT /GapssaMeetingDecision/{id}` simultáneas (`Confirmed` con
`operationKey` A, `Canceled` con `operationKey` B):

```
Confirmed: HTTP 409 {"status":"conflict","existingCEstadoReserva":"Canceled"}
Canceled:  HTTP 200 {"status":"confirmed","cEstadoReserva":"Canceled",...}
BD: c_estado_reserva=Canceled, modified_by_id=<admin> — exactamente un ganador
```

### 5.6 Escenarios 5 y 6 — inyección de fallos (fuera del alcance de esta corrección, repetidos como regresión)

Mismos dos puntos que la revisión OCC 2 (§7.1 de ese documento), repetidos
aquí solo como prueba de que el cambio de esta revisión no afecta a la
garantía transaccional ya demostrada — sentinels en `note`
(`FAULT_BEFORE_COMMIT`/`FAULT_AFTER_COMMIT`) añadidos **solo en una copia
del contenedor desechable**, nunca en el repositorio:

```
FAULT_BEFORE_COMMIT: HTTP 500, BD sin cambios (PendingCenterApproval), 0 filas de idempotencia.

FAULT_AFTER_COMMIT, intento 1: HTTP 500, BD YA Confirmed (el commit fue real,
  el fallo simulado ocurre después) — modified_at=13:57:50.
FAULT_AFTER_COMMIT, intento 2 (mismo operationKey, mismo payload): HTTP 200,
  {"status":"confirmed",...,"modifiedAt":"...13:57:50"} — modified_at IDÉNTICO
  al intento 1 (replay puro, sin segunda escritura), exactamente 1 fila de
  idempotencia para esa clave.
```

(Se detectó y corrigió un defecto en la instrumentación *de este ensayo*,
no en el código del repositorio: el sentinel `FAULT_AFTER_COMMIT` volvía a
dispararse en el reintento porque solo comprobaba `note`, sin distinguir
un reintento real de una primera ejecución — corregido añadiendo una
bandera `lastCallWasReplay` a la copia instrumentada, exclusiva del
contenedor de ensayo.)

### 5.7 Escenario 7 — compatibilidad con Google Calendar Sync

`make gcs-test` (suite local completa, sin credenciales ni conexión real a
Google, sin tocar ningún contenedor): **todo en verde** —
`COMPROBACIÓN DE DEPENDENCIAS: OK`, `AUTOLOAD`, `CONTROLADORES`, `I18N`,
`MAPPER`, `HOOK DE RELACIONES`, `HOOK DE CONTACT`, `RESOLVER DE
CONTACTOS`, `PAQUETE`, `php -l` sobre el ZIP — produce
`google-calendar-sync-1.1.1.zip`.

Instalado ese ZIP en `gapssa-occ-rehearsal-3` (**nunca en el contenedor
real**, `docker compose -p gapssa-occ-rehearsal-3 cp .../gcs-extension.zip
espocrm:/tmp/... && bin/command extension --file=...`), **sin cuenta
conectada, sin OAuth, sin credenciales**. `bin/command app-check` en
verde tras el `rebuild` de la instalación. Se repitió una decisión
`PendingCenterApproval → Confirmed` vía `PutDecide`:

```
HTTP 200 {"status":"confirmed","cEstadoReserva":"Confirmed","meetingStatus":"Planned",...}
Jobs GcsPush* en la tabla job: 0 (sin cuenta conectada, nada que sincronizar)
Entradas relacionadas con GCS en el log: 0
gcs_account: 1 fila ("Calendario Business", status=Disconnected, calendar_id=NULL) —
  registro por defecto que crea la propia instalación de la extensión, no una
  cuenta conectada
```

Ningún error, ninguna interferencia, ninguna alteración indebida de
`status`. Coherente con el resultado ya documentado en la revisión 2 (§8).

### 5.8 Confirmación de artefacto — contenedor desechable vs. repositorio

Tras retirar toda la instrumentación de ensayo (hook de ataque anidado,
sentinels de fallo en `PutDecide`, `recordDefs` ampliado) del contenedor y
redesplegar los 8 ficheros reales desde el propio repositorio, comparación
byte a byte:

```
IDÉNTICO: Classes/Api/GapssaMeetingDecision/AtomicDecisionContext.php
IDÉNTICO: Classes/Api/GapssaMeetingDecision/DecisionIdempotencyStore.php
IDÉNTICO: Classes/Api/GapssaMeetingDecision/PutDecide.php
IDÉNTICO: Classes/RecordHooks/Meeting/EstadoReservaStatusMap.php
IDÉNTICO: Classes/RecordHooks/Meeting/GuardMeetingDecisionTransition.php
IDÉNTICO: Classes/RecordHooks/Meeting/MeetingDecisionTransitionPolicy.php
IDÉNTICO: Classes/RecordHooks/Meeting/SyncEstadoReservaToStatus.php
IDÉNTICO: Resources/routes.json
```

Humo final repetido sobre este artefacto limpio (decisión exitosa + bypass
directo bloqueado, `docker compose -p gapssa-occ-rehearsal-3 exec`):
mismos resultados que en el ensayo instrumentado (§5.2/§5.3). Lo que se ha
probado es exactamente lo que está en el árbol de trabajo.

### 5.9 Eliminación del entorno

`docker compose --env-file <desechable> -p gapssa-occ-rehearsal-3 down -v`
— 2 contenedores, 2 redes, 4 volúmenes eliminados. Verificado
`docker ps`/`docker compose ps` (proyecto por defecto): cero rastro de
`gapssa-occ-rehearsal-3`, los 6 contenedores reales (`gapssa-*`) intactos,
`healthy`/`Up`, sin cambios.

## 6. Riesgos residuales (heredados de la revisión 2, sin cambios)

Sin novedad respecto a `docs/fase4b-occ-revision-2.md` §10.3 — ninguno de
esos cinco puntos (sin camino manual de excepción, dependencia del modelo
de ejecución de la imagen, `operationKey` responsabilidad del llamante, no
probado con más de 2 peticiones simultáneas, tabla de idempotencia sin
purga) se ve afectado por esta corrección. Se añade uno nuevo, menor:

6. **La capacidad de `AtomicDecisionContext` sigue siendo válida durante
   TODA la llamada a `Service::update()` del Meeting autorizado**, no solo
   durante el `UPDATE` SQL en sí — cualquier hook que corra en esa ventana
   (`beforeUpdate`/`afterUpdate`, presente o futuro) puede invocar
   `authorizes()` para ese mismo Meeting/transición y obtener `true`. Esto
   es intencional y correcto para el propio guard (necesita poder
   consultarlo desde `beforeUpdate`), pero cualquier hook **futuro** que se
   añada a `Meeting` deberá tenerlo en cuenta: `authorizes()` no distingue
   "soy el guard legítimo" de "soy cualquier otro código que corre en esa
   ventana" — la propiedad de seguridad depende de que ningún código ajeno
   actualice el **mismo** Meeting con el **mismo** origen/destino de forma
   no autorizada durante esa ventana, lo cual no puede ocurrir hoy porque
   `PutDecide` ya sostiene el lock de fila (`SELECT ... FOR UPDATE`) de ese
   Meeting durante toda la transacción.

## 7. Conclusión

**APROBADO.**

- El hueco descrito en el encargo (autorización universal por petición en
  lugar de por recurso) está corregido: `AtomicDecisionContext` ahora
  expone una capacidad nominal cerrada al Meeting/origen/destino exactos,
  sin ningún `isActive()` genérico.
- El ataque exacto (actualización anidada de otro Meeting durante
  `PutDecide`) queda **rechazado** con el código corregido, y se ha
  confirmado mediante un test de control que el mismo ataque **sí**
  atravesaba la guarda con el código pre-fix — el ensayo detecta realmente
  lo que dice detectar.
- Los 9 escenarios PHP puros y los 7 escenarios de la instancia desechable
  (incluidos los heredados de la revisión 2: fallo antes/después del
  commit con recuperación idempotente, concurrencia, bypass directo,
  compatibilidad GCS) pasan sin excepción.
- Ninguna de las garantías de la revisión OCC 2 (frontera transaccional
  única, idempotencia, ACL/stream/GCS vía `Service::update()` normal) se
  ha relajado.
- Validación completa del repositorio en verde (§9).

## 8. Las 5 escrituras reales pendientes (sin cambios, NO ejecutadas)

Sin cambios de fondo respecto a `docs/fase4b-occ-revision-2.md` §14 /
`docs/fase4b-revision-4.md` §8 — se repiten aquí solo como referencia. El
punto 4 se refiere ahora al conjunto corregido de esta revisión
(`AtomicDecisionContext.php`/`GuardMeetingDecisionTransition.php`
actualizados, más `PutDecide.php` con la llamada a `runAuthorized()`).
Ninguno de estos 5 puntos se ejecuta sin tu aprobación expresa y punto por
punto:

1. Crear `Contact.cGapssaAccountId` en el EspoCRM real.
2. Crear `Meeting.cBookingRequestId` + índice único en el EspoCRM real.
3. Crear el API User dedicado en el EspoCRM real.
4. Copiar los hooks PHP corregidos + `PutDecide`/`routes.json` +
   ejecutar `sql/install.sql` en el contenedor real, `bin/command
   rebuild` — demostrado atómico y con el hueco de autorización cerrado
   (esta revisión, §5), pero sigue requiriendo tu aprobación expresa punto
   por punto, igual que el resto.
5. Primera prueba de escritura end-to-end contra EspoCRM real, incluida la
   primera llamada real a `PutDecide` contra un Meeting `[PRUEBA]`.

## 9. Validación completa del repositorio

| Comando | Resultado |
|---|---|
| `docker compose config` (real, `compose.yml`) | válido, sin tocar servicios reales |
| `npm run typecheck` | limpio (`@gapssa/web`, `@gapssa/contracts`) |
| `npm run lint` | limpio, 0 errores/avisos |
| `npm run test` (workspaces) | **713/713** (`@gapssa/web`, 37 ficheros) + **98/98** (`@gapssa/contracts`) — sin cambios, esta revisión es exclusiva de EspoCRM/PHP |
| `npm run test:integration` | **251/251**, 26 ficheros, contra Postgres real de desarrollo, sin tocar EspoCRM |
| `npm run build` | compila limpio (Next.js, Turbopack), misma superficie de rutas |
| `npm run test:e2e` | **43/43** (Playwright) |
| `php -l` sobre los 4 ficheros nuevos/modificados del repositorio, con PHP local (8.3.12) y con el PHP del contenedor real (`gapssa-espocrm-1`, invocado solo como intérprete de lectura vía stdin, nunca escrito en `custom/`) | sin errores, ambos |
| Arnés de pruebas PHP puras (`MeetingHooksPureLogicTest.php`, ampliado con las 9 comprobaciones de `AtomicDecisionContext::authorizes()`) | **42/42** comprobaciones |
| `make gcs-test` | verde (§5.7) |
| `git diff --check` | limpio, sin conflictos de espacio en blanco |
| Servicios reales tras terminar (`docker compose ps`) | los 6 contenedores reales (`gapssa-*`) siguen `healthy`/`Up`, sin cambios |

## 10. Archivos nuevos/modificados

**Modificados**:
- `extensions/espocrm/custom/Espo/Custom/Classes/Api/GapssaMeetingDecision/AtomicDecisionContext.php`
  (reescrito — booleano estático → capacidad nominal cerrada, §2.1)
- `extensions/espocrm/custom/Espo/Custom/Classes/Api/GapssaMeetingDecision/PutDecide.php`
  (una sola llamada actualizada — `runActive()` → `runAuthorized()` con los
  tres valores exactos, §2.2)
- `extensions/espocrm/custom/Espo/Custom/Classes/RecordHooks/Meeting/GuardMeetingDecisionTransition.php`
  (comprobación reforzada — `isActive()` → `authorizes(meetingId,
  original, requested)`, §2.3)
- `extensions/espocrm/custom/tests/MeetingHooksPureLogicTest.php`
  (+9 comprobaciones de `AtomicDecisionContext`, sustituyendo las 5
  anteriores de `isActive()`/`runActive()`)

**Sin cambios** (confirmado explícitamente, byte a byte en el ensayo, §5.8):
- `DecisionIdempotencyStore.php`, `EstadoReservaStatusMap.php`,
  `MeetingDecisionTransitionPolicy.php`, `SyncEstadoReservaToStatus.php`,
  `sql/install.sql`, `Resources/routes.json`
- `Resources/metadata/recordDefs/Meeting.json`,
  `Resources/metadata/entityDefs/Meeting.json` (los nombres de clase no
  cambiaron)
- Todo `apps/web`, `packages/contracts`, esquema de `gapssa_booking`

**Documentación**: `docs/fase4b-occ-revision-3.md` (este documento).
