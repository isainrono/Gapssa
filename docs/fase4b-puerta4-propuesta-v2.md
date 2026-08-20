# Puerta 4 — propuesta revisada v2 (exclusivamente documental, no ejecutada)

> **Superada por `docs/fase4b-puerta4-propuesta-v3.md`.** v3 corrige el
> orden de activación, la ACL anticipada, el rollback de metadata, el
> resultado final declarado y la afirmación de que `PutDecide` queda
> "no autorizado" antes de escribir las allowlists (falsa: el admin único
> de la instancia real está autorizado incondicionalmente). El manifiesto
> de archivos (§5, hashes SHA-256) sigue vigente y se reutiliza sin
> cambios en v3 — no se recalcula aquí.

Responde punto por punto a la revisión solicitada sobre la propuesta
original de Puerta 4 (`docs/fase4b-decision-flow-final.md` §10, filas
4–8). **No se ha ejecutado nada de lo descrito aquí.** Las únicas
operaciones realizadas para producir este documento fueron de solo
lectura contra el contenedor real (`docker exec ... cat/sha256sum`,
lectura de código fuente de EspoCRM) y lectura de ficheros del
repositorio — ningún `rebuild`, ninguna escritura, ninguna copia, ningún
cambio de ACL/config/SQL, sin commits.

## 1. Separación estricta Puerta 4 / Puerta 5

**Puerta 4** (este documento): todo el despliegue técnico —
metadata, columna e índice, tabla SQL de idempotencia, código de servidor
(hooks PHP + API), rutas, cliente, configuración de autorización, ACL —
y todas las verificaciones que no impliquen crear ni decidir ningún
`Meeting`. Termina en un estado desplegado, verificado, pero **inerte**:
nadie ha llamado nunca a `PutDecide` contra la instancia real.

**Puerta 5** (aparte, no propuesta en este documento): la primera
escritura end-to-end real — crear un `Meeting [PRUEBA]` y decidirlo vía
`PutDecide`. El antiguo "Paso 6" de la propuesta original queda retirado
de la Puerta 4 en su totalidad; no se menciona más abajo como parte de
esta puerta.

## 2. ACL de `Meeting.cMotivoResolucionReserva` (V1) y compatibilidad con `PutDecide`

| Actor | read | edit |
|---|---|---|
| Administración (`isAdmin=true`) | yes (implícito, no restringible por ACL de campo) | yes (implícito) |
| `Portal GAPSSA API` | yes | yes |
| `Profesional Gapssa` | no | no |
| Anónimo (sin rol/portal) | sin acceso (ya sin acceso por ausencia de configuración — sin cambio) |

**Confirmación técnica de que esta ACL no bloquea `PutDecide`** (leído en
el core real de EspoCRM 10.0.3, `application/Espo/Core/Record/Service.php`,
método `update()` → `filterInput()`, líneas 450–459):

```php
protected function filterInput(stdClass $data): void
{
    $forbiddenAttributeList = $this->acl
        ->getScopeForbiddenAttributeList($this->entityType, AclTable::ACTION_EDIT);

    foreach ($forbiddenAttributeList as $attribute) {
        unset($data->$attribute);
    }
    ...
}
```

`PutDecide.php` (línea 341-343) llama a
`$this->recordServiceContainer->get(Meeting::ENTITY_TYPE)->update($meetingId, $data, ...)`
— el `RecordService` **estándar** de EspoCRM, que aplica `filterInput()`
sobre el usuario autenticado de la petición (aquí, siempre
`portal-gapssa-api`, el único con `authMethod=ApiKey` autorizado a llamar
esta ruta). Si `cMotivoResolucionReserva` estuviera prohibido en edición
para ese rol, `filterInput()` lo **eliminaría en silencio** de `$data`
antes de guardar — el `Meeting` cambiaría de `cEstadoReserva` pero el
motivo quedaría `NULL`, sin excepción ni error visible. Por eso
`edit=yes` para `Portal GAPSSA API` en este campo no es solo compatible:
es **obligatorio** para que la Puerta 4/5 funcionen como está diseñado.
`cEstadoReserva` ya tiene `edit=yes` para ese rol desde la Puerta 3 —
sin cambios ahí.

Para `Profesional Gapssa` en `no/no`: es coherente con que ese rol nunca
llama a `PutDecide` (no está en
`gapssaBookingDecisionAuthorizedUserIds`, ver §3) ni edita `Meeting` vía
la ruta estándar `PUT /Meeting/:id` con ese atributo — si lo intentara,
`filterInput()` lo bloquearía igual, defensa en profundidad coherente con
`GuardMeetingResolutionReasonConsistency` (verificación a nivel de hook,
no solo de ACL).

## 3. Configuración de autorización — se mantiene, no se escribe todavía

```
gapssaBookingDecisionAuthorizedApiUserIds = ["6a7b345b2624dbb56"]
gapssaBookingDecisionAuthorizedUserIds = []
```

`6a7b345b2624dbb56` es el id ya verificado de `portal-gapssa-api`
(Puerta 3, re-confirmado en vivo en la corrección documental anterior).
Con estos valores, **ningún profesional humano regular podrá decidir
reservas todavía** — la lista humana queda vacía a propósito
(`MeetingDecisionAuthorizationPolicy`: humano regular solo autorizado si
su id está en esa lista; lista vacía = nadie). **Administración conserva
autorización por la política ya existente**, no por esta lista:
`MeetingDecisionAuthorizationPolicy` autoriza a `isAdmin=true`
incondicionalmente, antes de consultar ninguna de las dos listas — así
que un usuario admin real podría llamar `PutDecide` aunque
`gapssaBookingDecisionAuthorizedUserIds` esté vacía. Estos valores **no
se escriben** en esta puerta; quedan definidos aquí para el Paso 4 (§8).

## 4. Procedimiento concreto de escritura de `data/config.php` (no ejecutado)

Sustituye la "edición genérica" de la propuesta original por el mecanismo
**nativo** de EspoCRM — el mismo que usa el propio panel de
Administración para cualquier cambio de configuración —, confirmado leyendo
`application/Espo/Core/Utils/Config/ConfigWriter.php` en el contenedor
real:

1. **Backup previo recuperable**:
   `docker compose exec -T espocrm sh -lc 'cp data/config.php data/config.php.bak-$(date -u +%Y%m%dT%H%M%SZ)'`
   — copia dentro del mismo volumen, con marca de tiempo UTC en el nombre,
   nunca sobrescribe un backup anterior.
2. **Escritura vía `ConfigWriter`** (clase nativa, no edición de texto a
   mano): un script PHP temporal que arranca `Espo\Core\Application`,
   resuelve `ConfigWriter` del contenedor de inyección de dependencias, y
   llama:
   ```php
   $configWriter->set('gapssaBookingDecisionAuthorizedApiUserIds', ['6a7b345b2624dbb56']);
   $configWriter->set('gapssaBookingDecisionAuthorizedUserIds', []);
   $configWriter->save();
   ```
   `ConfigWriter::save()` internamente (código real leído, líneas
   190-243): escribe con `FileManager::putPhpContents()` (bloqueo
   `LOCK_EX`), **relee el archivo inmediatamente** y compara un marcador
   de tiempo (`microtime`) recién escrito contra lo releído; si no
   coincide, reintenta con `putPhpContentsNoRenaming()`. Es
   autoverificante por diseño — no hace falta añadir una verificación
   externa para detectar una escritura a medias, aunque sí se añade una
   independiente (punto 5) por defensa en profundidad.
3. **`php -l` sobre el resultado**:
   `docker compose exec -T espocrm sh -lc 'php -l data/config.php'`
   — debe devolver `No syntax errors detected` antes de continuar.
4. **Comprobación de que solo cambian las dos claves autorizadas**:
   `diff` entre el backup del paso 1 y el `data/config.php` resultante
   (ambos vía `docker compose exec ... cat`, comparados en el host, nunca
   editados a mano); se aborta si aparece cualquier clave distinta a
   `gapssaBookingDecisionAuthorizedApiUserIds`,
   `gapssaBookingDecisionAuthorizedUserIds` y `cacheTimestamp`/`microtime`
   (estos dos últimos los reescribe el propio `ConfigWriter` en cada
   `save()`, esperado y documentado, no una divergencia).
5. **Reversión exacta**: restaurar el backup exacto del paso 1
   (`docker compose exec -T espocrm sh -lc 'cp data/config.php.bak-<ts> data/config.php'`),
   `php -l` de nuevo, y `bin/command rebuild` — nunca "vaciar las listas a
   mano", porque no garantiza bit a bit el estado previo (`microtime`
   distinto, orden de claves potencialmente distinto).

## 5. Manifiesto cerrado del despliegue (21 archivos, cada uno individual)

Rutas relativas a `extensions/espocrm/custom/` (origen, repositorio,
árbol de trabajo) y a `/var/www/html/` (destino, contenedor real). SHA-256
calculado ahora mismo sobre el fichero del repositorio.

### 5.1 Código de servidor — `Classes/RecordHooks/Meeting/` (destino: `custom/Espo/Custom/Classes/RecordHooks/Meeting/`)

| # | Archivo | SHA-256 | Bytes | Nuevo/Reemplaza |
|---|---|---|---|---|
| 1 | `EstadoReservaStatusMap.php` | `b04452d591d1bccda23adab5c7f3637864594bc6fd98cefaf03b884f2546571a` | 1649 | Nuevo (ruta no existe en el contenedor real) |
| 2 | `GuardMeetingDecisionTransition.php` | `3a0a355691bfd692c60a6cc3f3fdf5fc558ed76179b4ddcb8e02063164199caf` | 6932 | Nuevo |
| 3 | `GuardMeetingResolutionReasonConsistency.php` | `c3e9138e5385c6e56dc00c9a6ae8342b04087fc0e8e572cd37710fc609d07725` | 3789 | Nuevo |
| 4 | `MeetingDecisionTransitionPolicy.php` | `1bbf13355847b2356ddc8ad4689f20fb203105d5be7ea28503073f6213b29c99` | 1752 | Nuevo |
| 5 | `MeetingResolutionPolicy.php` | `2f63f70aa73bdb904f8b201fd15591a126571ecc3eade6c29c27e41fbf2e41ab` | 2728 | Nuevo |
| 6 | `MeetingResolutionReason.php` | `9cabc77257986e517eb85e41088a0c174adb0dd209ff114c54dd006a8410ce13` | 2066 | Nuevo |
| 7 | `SyncEstadoReservaToStatus.php` | `56bb9cb1f1becea98eeed15ebcf9c682b98bd7a9333aae49b0b0121c96d1dea7` | 4077 | Nuevo |

Confirmado en el contenedor real: ese directorio hoy solo contiene
`SendInvitationsAfterCreate.php`/`SendInvitationsAfterUpdate.php`
(preexistentes desde el aprovisionamiento inicial, 04-08, no relacionados
con esta puerta, **no se tocan**). Los 7 ficheros de arriba son
adiciones puras al directorio.

### 5.2 Código de servidor — `Classes/Api/GapssaMeetingDecision/` (destino: `custom/Espo/Custom/Classes/Api/GapssaMeetingDecision/`)

| # | Archivo | SHA-256 | Bytes | Nuevo/Reemplaza |
|---|---|---|---|---|
| 8 | `PutDecide.php` | `4cc685040d42915980fd2a037ba12e647fcb929cf913bb3d47b4a2ba9a183c0b` | 19685 | Nuevo (directorio `Classes/Api` no existe en el contenedor real) |
| 9 | `MeetingDecisionAuthorizationPolicy.php` | `5ba246e357c84cac524c9b7ee5079182dd8e25d10553a3d0f7d09a01e6e443c2` | 2710 | Nuevo |
| 10 | `DecisionIdempotencyStore.php` | `41cbd7f1cc2398c209932bb2036c93271f3f76c608b2dff77b60deb73d7e4e3a` | 5370 | Nuevo |
| 11 | `AtomicDecisionContext.php` | `49ad8b41925b57df470387111e795a96d8cc6d0f6f6c32575b426d5ec1dbce2a` | 4532 | Nuevo |

### 5.3 Rutas y SQL

| # | Archivo | Origen | Destino | SHA-256 | Bytes | Nuevo/Reemplaza |
|---|---|---|---|---|---|---|
| 12 | `routes.json` | `Espo/Custom/Resources/routes.json` | `custom/Espo/Custom/Resources/routes.json` | `e6ea82e157e69e3a03c28739bbbe72fd787a412ba8a62d6ead696f1e73101920` | 178 | Nuevo (no existe en el contenedor real) |
| 13 | `install.sql` | `Classes/Api/GapssaMeetingDecision/sql/install.sql` | (no se copia — se ejecuta el DDL, ver §7) | `f62d2d942af3c59576e6e27eac62c85d6ba0b1af0a1e8ba7834d03cbec6f0fbc` | 1301 | Crea tabla nueva `gapssa_meeting_decision_operation` |

### 5.4 Cliente (destino: `client/custom/src/...`)

| # | Archivo | SHA-256 | Bytes | Nuevo/Reemplaza |
|---|---|---|---|---|
| 14 | `views/meeting/record/detail.js` | `261f5e9ae76c4e66b01f0910827fb614a6cc86ffe9ff83c9dfe047542a24496e` | 10137 | Nuevo (el contenedor real solo tiene módulos de `google-calendar-sync` bajo `client/custom`) |
| 15 | `views/meeting/modals/reject-reason.js` | `28ed1665a7ab0ab70c38752b74bda3d07bcb74b2d1bdf0ca7e8308365beee460` | 2510 | Nuevo |

### 5.5 Metadata que reemplaza un archivo real existente (destino: `custom/Espo/Custom/Resources/...`)

| # | Archivo | SHA-256 (repo) | Bytes | SHA-256 (real, actual) | Diferencia |
|---|---|---|---|---|---|
| 16 | `metadata/entityDefs/Meeting.json` | `22b11f8d55bc080c314a8c0c0664cbaff120bfb58c3586516908099f0c915e8d` | 2183 | `d56b05d99d554e9e924aaea171e58801fd61112f8a59a415bec0c74a185b4a22` | Añade únicamente el bloque `cMotivoResolucionReserva` (ver §6) |
| 17 | `metadata/recordDefs/Meeting.json` | `1c7f1b9476cbd948018e5d7cc1ed337b0963283b7098edc278ac04f614b57af6` | 790 | `67c14118e319e3d9a0ab9b39e81d8ecaf1c12bd28d59e00f28b11768629e44b0` | Añade `beforeCreateHookClassNameList`/`beforeUpdateHookClassNameList` |
| 18 | `metadata/clientDefs/Meeting.json` | `387362b7e718e2994c0dd82ee9479d0d420ac0b20bee61866d63317b4b212c7a` | 426 | `eaddf7b7a7a1a3c34af99164845755b708bb2ca62b824c94078c012d7c19382e` | Añade `recordViews.detail` |
| 19 | `layouts/Meeting/detail.json` | `4430d16010fb09491effe8894d3adce90746895db6c4ddb54d71746f4293cb95` | 1250 | `e75df3ac81234cc4cc99268c7c2723b8d00bd5ddfc08388b41a3d57acb4069d7` | Añade el campo `cMotivoResolucionReserva` al layout |
| 20 | `i18n/es_ES/Meeting.json` | `eea2d35d4402dc6da4b30f33f4a9a089f3ce703bf9c8dd4c5b3ea574a5f9701c` | 1974 | `be5dc87c26e865b2a4e71ed43d9c506e127ec941597be8e951ec4f1e7c6e418f` | Añade etiquetas/labels/mensajes nuevos, ninguna clave existente modificada |
| 21 | `i18n/en_US/Meeting.json` | `7f16e2050b092be9c9581ff50a090f0aae72204fd49c860591dae37b85322f64` | 1845 | `c78d7cf8b1790837521fa489f78556e0d18a32b2e812a0c448bae4077ebd64ca` | Igual que arriba, en inglés |

## 6. Verificación de los 6 archivos que reemplazan uno real (ya ejecutada, solo lectura)

Para cada uno de los archivos 16–21: se leyó el contenido real actual del
contenedor (`docker exec ... cat`), se calculó su hash (tabla §5.5,
columna "SHA-256 (real, actual)"), y se comparó línea a línea
(`diff`) contra el archivo del repositorio. Resultado, los 6 sin
excepción: **el `diff` es puramente aditivo** — todas las líneas nuevas
son adiciones (`>`), ninguna línea existente fue modificada ni eliminada,
más allá de la coma de continuación de JSON esperada al añadir una clave
al final de un objeto (p. ej. `"cEstadoReserva": "Estado de la reserva"`
→ `"cEstadoReserva": "Estado de la reserva",` seguido de la clave nueva —
mismo valor, misma clave, solo la puntuación JSON que exige la adición
siguiente).

**Criterio de aborto para el momento real de la copia** (procedimiento,
no ejecutado): inmediatamente antes de `docker compose cp` de cada uno de
estos 6 archivos, releer el archivo real y comparar su hash contra la
columna "SHA-256 (real, actual)" de §5.5. Si no coincide, **abortar sin
copiar** — significa que el archivo real cambió desde esta verificación y
la comparación aditiva de arriba ya no es válida; no se sobrescribe ante
ninguna divergencia no explicada por este documento.

## 7. Auditoría de `sql/install.sql` (sin ejecutar)

Contenido exacto (1301 bytes, hash en §5.3):

```sql
CREATE TABLE IF NOT EXISTS gapssa_meeting_decision_operation (
    operation_key           VARCHAR(128) NOT NULL,
    meeting_id               VARCHAR(36)  NOT NULL,
    payload_hash              CHAR(64)     NOT NULL,
    decision                 VARCHAR(32)  NOT NULL,
    result_status             VARCHAR(16)  NOT NULL,
    result_c_estado_reserva  VARCHAR(64)  NULL,
    result_http_status       SMALLINT     NOT NULL,
    result_body               TEXT         NOT NULL,
    created_at                DATETIME     NOT NULL,
    PRIMARY KEY (operation_key),
    KEY idx_gapssa_mdo_meeting_id (meeting_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- **Tablas/columnas/índices afectados**: una única tabla nueva,
  `gapssa_meeting_decision_operation` — ninguna tabla existente tocada
  (ni `meeting`, ni ninguna otra). Clave primaria `operation_key`, índice
  secundario `idx_gapssa_mdo_meeting_id`.
- **Sin operaciones destructivas**: un único `CREATE TABLE`. Sin `DROP`,
  `ALTER`, `DELETE`, `TRUNCATE` ni `UPDATE`.
- **Idempotencia**: `IF NOT EXISTS` — ejecutarlo dos veces es un no-op la
  segunda vez, sin error.
- **Ejecución parcial**: es una única sentencia DDL; MariaDB/InnoDB la
  aplica como una unidad atómica a nivel de motor de almacenamiento (un
  `CREATE TABLE` no puede quedar "a medias" — o la tabla existe completa
  con sus índices, o no existe). No hay un segundo statement que pudiera
  dejar un estado intermedio.
- **Transacción**: no se envuelve explícitamente en
  `BEGIN`/`COMMIT` porque no hace falta ni sería efectivo — el DDL de
  MariaDB provoca un commit implícito propio, independiente de cualquier
  transacción abierta alrededor.
- **Consulta exacta de verificación** (solo lectura, tras ejecutar):
  ```sql
  SHOW CREATE TABLE gapssa_meeting_decision_operation;
  ```
  debe devolver exactamente las columnas, la clave primaria, el índice y
  `ENGINE=InnoDB` de arriba.
- **Reversión exacta**: `DROP TABLE IF EXISTS gapssa_meeting_decision_operation;`
  — segura solo si la tabla está vacía (comprobar antes con
  `SELECT COUNT(*) FROM gapssa_meeting_decision_operation;`). **Consecuencia
  sobre datos**: si la tabla ya tiene filas (solo puede ocurrir tras la
  Puerta 5, nunca dentro de esta puerta), el `DROP` destruye el historial
  de idempotencia de decisiones ya tomadas — aceptable únicamente como
  reversión completa de toda la Puerta 4+5, nunca como reversión parcial
  mientras haya decisiones reales registradas.

## 8. Orden de despliegue (justificado, sin ventanas inconsistentes)

1. **Metadata + columna** (archivos 16 `entityDefs` primero) + `rebuild`.
   Antes que nada: si algo posterior falla, el peor caso es un campo sin
   usar en la instancia, nunca una ruta activa sin su columna.
2. **`sql/install.sql`** (tabla de idempotencia). Después de la columna,
   antes que cualquier código que la use — `DecisionIdempotencyStore`
   (archivo 10) referencia esta tabla; si se desplegara el código antes
   que la tabla, la primera llamada real fallaría con un error SQL en vez
   de un 404/403 controlado.
3. **Código de servidor** (archivos 1–11, `recordDefs` archivo 17,
   `routes.json` archivo 12) + `rebuild`. La ruta HTTP
   (`PutDecide`) queda registrada, pero **no autorizada todavía** (§9
   sigue vacío/config aún no escrito) — cualquier llamada real recibiría
   403 por autorización, no un error de infraestructura. Los hooks
   (`GuardMeetingDecisionTransition`,
   `GuardMeetingResolutionReasonConsistency`, `SyncEstadoReservaToStatus`)
   quedan activos vía `recordDefs`, pero solo se disparan ante un
   `save()` real de `Meeting` — no hay ninguno en esta puerta.
4. **Configuración de autorización** (§3/§4). Se escribe **después** del
   código, nunca antes — si se escribiera antes, existiría una ventana
   donde la config apunta a una ruta que todavía no existe (sin efecto
   práctico, pero rompe el invariante "cada paso deja el sistema en un
   estado coherente consigo mismo hasta ese punto"). Con el orden
   propuesto, en el momento en que la autorización queda escrita, la ruta
   que autoriza ya existe y ya está probada estructuralmente.
5. **Cliente** (archivos 14, 15, `clientDefs` archivo 18,
   `layouts/detail` archivo 19, `i18n` archivos 20/21) + `rebuild`. Al
   final del lado servidor a propósito: la UI de decisión solo debe
   aparecer cuando la ruta que invoca ya existe y ya está correctamente
   autorizada — mostrar los botones "Aprobar"/"Rechazar" antes tentaría a
   un clic real contra una ruta todavía no lista.
6. **ACL de `cMotivoResolucionReserva`** (§2). Al final, no antes: mientras
   el campo exista en metadata pero sin ACL explícita, EspoCRM lo trata
   como accesible por defecto para cualquier rol con `edit=all` de scope
   (mismo comportamiento ya documentado para `cGapssaAccountId`/
   `cBookingRequestId` antes de la Puerta 3B) — una ventana corta pero
   real de sobre-exposición si se escribiera antes que el resto. Aplicarla
   al final, cuando el campo ya lleva desplegado varios pasos sin tráfico
   real que lo toque (nadie ha llamado `PutDecide` todavía en esta
   puerta), elimina esa ventana en la práctica.
7. **`rebuild` + `app-check` final** de todo el conjunto, y verificación
   GCS no destructiva (§10) como cierre.

Ninguna ruta queda "operativa" (invocable con efecto real) antes de que
sus dependencias existan: la ruta HTTP existe antes que su autorización;
la autorización existe antes que la UI que la invoca; el campo y su ACL
existen antes de que cualquier escritura real pudiera necesitarlos — y
ninguna escritura real ocurre en esta puerta de todos modos.

## 9. Rollback por paso (no ejecutado, procedimiento previsto)

| Paso | Qué se restaura | Comandos previstos (no ejecutados) | Comprobación de reversión | Cuándo revertir vs. cuándo detenerse conservando evidencia |
|---|---|---|---|---|
| 1. Metadata/columna | `entityDefs/Meeting.json` al hash de §5.5, columna física | Restaurar el archivo real desde el repo (versión sin el campo, commit actual) vía `docker compose cp`; `rebuild`; si la columna física llegó a crearse, `ALTER TABLE meeting DROP COLUMN c_motivo_resolucion_reserva;` (no asumido automático — comprobar antes) | `sha256sum` del archivo = hash pre-paso; `SHOW COLUMNS FROM meeting` sin la columna | Revertir si `app-check` falla o el hash post-copia no coincide con el origen. Detenerse conservando evidencia si el hash *pre-paso* ya no coincide con §5.5 (posible escritor concurrente — no hay indicios de que exista, pero es la condición objetiva) |
| 2. `install.sql` | Tabla `gapssa_meeting_decision_operation` | `SELECT COUNT(*)` (debe ser 0 en esta puerta) → `DROP TABLE IF EXISTS gapssa_meeting_decision_operation;` | `SHOW TABLES` sin la tabla | Revertir solo si la tabla está vacía (garantizado en esta puerta, sin Puerta 5). Si tuviera filas, detenerse — señal de que algo fuera de esta puerta ya escribió, investigar antes de tocar nada |
| 3. Código servidor + rutas | Directorios `Classes/RecordHooks/Meeting` (los 7 nuevos), `Classes/Api/GapssaMeetingDecision` (completo), `Resources/routes.json`, `recordDefs/Meeting.json` | Borrar los ficheros nuevos (`docker exec ... rm`) uno a uno según el manifiesto §5.1/§5.2/§5.3, restaurar `recordDefs/Meeting.json` al hash real de §5.5; `rebuild` | Directorios vuelven a contener solo lo preexistente (`SendInvitationsAfter*`); `find` no encuentra los 11 ficheros nuevos; `app-check` OK | Revertir si `php -l` falla en algún archivo o si `app-check` falla tras el `rebuild`. Detenerse si un archivo objetivo de reemplazo (`recordDefs`) no coincide con el hash esperado antes de tocarlo |
| 4. Config de autorización | `data/config.php` | Restaurar el backup exacto del paso §4.1 (`cp data/config.php.bak-<ts> data/config.php`); `php -l`; `rebuild` | `diff` contra el backup = vacío; `php -l` OK | Revertir si el `diff` post-escritura (§4.4) muestra alguna clave no esperada. Detenerse conservando el backup (nunca borrarlo) si la restauración misma falla `php -l` — señal de corrupción más profunda a investigar antes de seguir tocando el archivo |
| 5. Cliente | `client/custom/src/views/meeting/*`, `clientDefs/recordViews`, `layouts/Meeting/detail.json`, `i18n/{es_ES,en_US}/Meeting.json` | Borrar los 2 ficheros JS nuevos; restaurar los 4 ficheros de metadata a los hashes reales de §5.5; `rebuild` | UI real sin la vista de decisión ni los textos nuevos; hashes = §5.5 columna "real, actual" | Revertir si aparece cualquier error de consola nuevo al verificar la UI. Detenerse si la restauración de algún fichero no reproduce el hash "real, actual" exacto — indicaría que ese archivo ya no es lo que este documento asume |
| 6. ACL del campo | `fieldData.Meeting.cMotivoResolucionReserva` de los roles `Profesional Gapssa` y `Portal GAPSSA API` | Mutar `fieldData` de vuelta a ausencia de la clave (mismo mecanismo nativo que la Puerta 3B, `EntityManager`/`saveEntity()`) | `SELECT field_data FROM role WHERE id IN (...)` sin la clave `cMotivoResolucionReserva` | Revertir si la verificación posterior a escribir el ACL no coincide exactamente con la matriz de §2. Detenerse conservando evidencia si el `field_data` leído *antes* de tocarlo ya difiere de lo esperado (mismo criterio que la Puerta 3B) |

Cada fila es reversible de forma independiente y en orden inverso al
desplegado (6 → 1) sin depender de que las filas posteriores se hayan
ejecutado.

## 10. Verificación de Google Calendar Sync — no destructiva

- **No se activa ni desactiva la extensión real** en ningún paso.
- `make gcs-test` (`Makefile` raíz, línea 101: `gcs-test: gcs-build`) —
  ejecuta `google-calendar-sync/build.sh`, que empaqueta y verifica el
  contenido del ZIP de la extensión **fuera del contenedor**, sin tocar
  `gapssa-espocrm-1`. Confirma que el paquete de la extensión sigue
  íntegro tras los cambios de esta puerta, no que la extensión "siga
  funcionando en vivo" — eso lo cubre el punto siguiente.
- `bin/command app-check` (dentro del contenedor real) tras cada
  `rebuild` de esta puerta — mismo comando ya usado en las Puertas 1–3,
  de solo lectura/diagnóstico, no destructivo.
- **Inspección de hooks sin ejecutarlos**: confirmar por listado
  (`find`/`ls`) que ninguno de los ficheros de GCS
  (`client/custom/modules/google-calendar-sync/*`,
  hooks de GCS bajo `custom/Espo/Custom/Classes` si los hubiera) aparece
  en el manifiesto de §5 como reemplazado — el despliegue de esta puerta
  toca únicamente rutas bajo `RecordHooks/Meeting`, `Api/GapssaMeetingDecision`,
  y los ficheros de `Meeting` listados en §5.5, nunca nada bajo `google-calendar-sync`.
- **Prueba adicional no destructiva propuesta**: tras el `rebuild` final,
  `docker compose exec -T espocrm bin/command app-check` y una lectura
  agregada (`SELECT COUNT(*) FROM gcs_event_link;`, solo lectura) para
  confirmar que el conteo de vínculos de calendario no cambió durante
  esta puerta — ningún paso de este documento debería tocarlo, y esta
  consulta lo confirma sin modificar nada.

## 11. Condiciones objetivas de parada y límites de la Puerta 4

**Parar inmediatamente si:**
- El hash de cualquier archivo, inmediatamente antes de tocarlo, no
  coincide con el valor "real, actual" de §5.5 (para los 6 que reemplazan)
  o con la ausencia confirmada en §5.1/§5.2/§5.3 (para los nuevos).
- `php -l` falla sobre cualquier `.php` copiado, o sobre `data/config.php`
  tras escribirlo.
- `bin/command app-check` falla tras cualquier `rebuild` intermedio.
- El `diff` de `data/config.php` (backup vs. resultado) muestra una clave
  no autorizada por §4.4.
- `SHOW CREATE TABLE gapssa_meeting_decision_operation` no coincide
  exactamente con §7.
- La verificación de ACL (§9, fila 6) no coincide exactamente con la
  matriz de §2.
- Aparece cualquier error de consola nuevo al verificar la UI (§9, fila 5).
- El conteo de `meeting` real, o el de `gcs_event_link`, cambia en
  cualquier punto del proceso.

**Esta puerta, tal como queda propuesta, termina explícitamente sin:**
- Crear ningún `Meeting` (de prueba o real).
- Decidir ningún `Meeting` — ninguna llamada real a `PutDecide`.
- Cambiar `ESPO_BOOKING_ADAPTER` a `http` en ningún entorno — sigue en
  `simulated`.
- Hacer ninguna llamada `PutDecide` real (ni de prueba).
- Tocar nada de la Puerta 5 — que queda como puerta aparte, con su propia
  autorización explícita, no incluida ni implícita en esta.

---

**Nada de este documento se ha ejecutado.** Queda a la espera de tu
aprobación explícita, paso por paso, antes de ejecutar cualquiera de las
6 fases de §8.
