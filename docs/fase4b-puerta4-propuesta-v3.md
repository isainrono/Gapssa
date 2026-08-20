# Puerta 4 — propuesta v3 (exclusivamente documental, no ejecutada)

> **Decisión adoptada y ya implementada en `docs/fase4b-puerta4-propuesta-v4.md`**:
> alternativa A (feature flag), con código real, 109/109 en el arnés PHP y
> un ensayo desechable completo contra EspoCRM 10.0.3. El análisis de este
> documento (§1–§3, por qué B no cierra el riesgo del admin, por qué la
> ACL anticipada no es viable) sigue vigente y no se repite en v4 — solo
> léelo aquí. El orden (§4), rollback (§5/§9) y manifiesto (§6/§7,
> heredado de v2) también siguen vigentes; v4 solo actualiza 3 hashes y
> cierra los puntos que dependían de "si se adopta A".

**Supersede a `docs/fase4b-puerta4-propuesta-v2.md`** en los 9 puntos de
esta revisión — el manifiesto de archivos y sus hashes (§5 de v2) siguen
vigentes y se reutilizan aquí sin cambios; el resto (orden, ACL, rollback,
resultado final) se reescribe. v2 no queda borrada, solo marcada como
superada al inicio de ese fichero.

**Nada de este documento se ha ejecutado.** Todo lo que se hizo para
producirlo fue lectura: código fuente real de EspoCRM 10.0.3 en el
contenedor (`Authentication.php`,
`Classes/RecordHooks/Role/BeforeSaveValidate.php`,
`Core/Record/HookManager.php`, `PutDecide.php`), consultas `SELECT`/`stat`
de solo lectura, y lectura del repositorio. Cero escrituras, cero copias,
cero `rebuild`, cero cambios de ACL/config/SQL, cero commits.

## 1. Corrección: `PutDecide` NO queda "no autorizado" solo por ausencia de listas

v2 (§8, orden) afirmaba que, tras desplegar el código y `routes.json`
pero antes de escribir las allowlists, "cualquier llamada real recibiría
403 por autorización". Es **falso** y queda retirado. Motivo, en el
propio código real:

```php
// PutDecide.php, isAuthorizedToDecide()
return MeetingDecisionAuthorizationPolicy::isAuthorized(
    $this->user->isAdmin(),   // ← si es true, autoriza SIN mirar ninguna lista
    ...
);
```

`MeetingDecisionAuthorizationPolicy::isAuthorized()` autoriza
incondicionalmente a `isAdmin() === true` antes de consultar
`gapssaBookingDecisionAuthorizedApiUserIds`/`...UserIds`. La instancia
real tiene **un único usuario admin** (`type=admin`, id
`6a70ac4451597eea8`, verificado ahora en la tabla `user`). En cuanto
`routes.json` + los 11 ficheros PHP quedan copiados y el `rebuild` los
activa, ese usuario admin **puede invocar `PutDecide` real** contra
cualquier `Meeting` real en `PendingCenterApproval` — con sesión de
administración normal, sin necesitar ninguna lista escrita. Esto se
resuelve en los puntos 2 y 4 (orden), no se documenta como "cerrado por
falta de autorización".

## 2. Alternativa elegida: feature flag (A)

### Alternativas evaluadas

**(B) Aceptar la exposición + exclusión de tráfico.** Investigado el
mecanismo real de exclusión de tráfico de EspoCRM (`maintenanceMode`,
`Authentication.php` línea 212):

```php
if (!$user->isAdmin() && $this->configDataProvider->isMaintenanceMode()) {
    throw ServiceUnavailable::createWithBody("Application is in maintenance mode.", ...);
}
```

El modo mantenimiento **excluye a todo el mundo excepto a admin**. Cierra
por completo el riesgo para `Profesional Gapssa`/`Portal GAPSSA API`
(útil, se usa igualmente en §3), pero **no cierra el riesgo del punto 1**:
un admin real seguiría pudiendo invocar `PutDecide` durante la ventana de
mantenimiento. La opción B, por tanto, no puede describirse como "cierre
completo" salvo aceptando explícitamente que el admin queda fuera de
cualquier exclusión de tráfico — es una limitación estructural de EspoCRM,
no un descuido de esta propuesta.

**(A) Feature flag `gapssaBookingDecisionEnabled`.** Un booleano nuevo,
comprobado dentro de `PutDecide::process()`, **antes** de cualquier otra
cosa (antes incluso del `acl->check()` de scope) — bloquea a
**cualquier** actor, admin incluido, porque la comprobación vive dentro
del propio endpoint, no depende de ACL ni de sesión ni de modo
mantenimiento.

### Recomendación: **A**

Es la única de las dos que cierra el riesgo del punto 1 (admin). B queda
como medida complementaria (para el riesgo de ACL de campo, §3), nunca
como sustituto de A para el riesgo de autorización de `PutDecide`.

### Diseño (no implementado)

- Config nueva: `gapssaBookingDecisionEnabled`, booleano, **por defecto
  `false`** si la clave no existe — mismo patrón defensivo ya usado para
  las dos listas (`$config->get(clave, valorSeguro)`, nunca lanza si la
  clave falta o está corrupta).
- Comprobación en `PutDecide::process()`, primera línea del método,
  antes de leer `$meetingId` de la ruta:
  ```php
  if (!$this->config->get(self::DECISION_ENABLED_CONFIG_KEY, false)) {
      throw ServiceUnavailable::createWithBody(
          'La decisión de reservas está deshabilitada temporalmente.',
          'meeting_decision_disabled',
      );
  }
  ```
- Se activa (`true`) **únicamente** en el último paso de la Puerta 4
  (§4, fase 9), tras `app-check` en verde — nunca antes.

### Cambios de código y pruebas que exige adoptar A (no implementados aquí)

1. `PutDecide.php`: la comprobación de arriba + nueva constante
   `DECISION_ENABLED_CONFIG_KEY = 'gapssaBookingDecisionEnabled'`.
2. `tests/MeetingHooksPureLogicTest.php` (o arnés equivalente): casos
   nuevos — flag ausente → bloqueado (admin incluido); flag `false` →
   bloqueado (admin incluido); flag `true` → comportamiento actual sin
   cambios; flag con valor no-booleano/corrupto → bloqueado, nunca lanza
   una excepción no controlada.
3. Re-ejecutar el ensayo end-to-end desechable (§0.1 de
   `fase4b-decision-flow-final.md`) con el flag en `false` por defecto
   para confirmar que **ningún** escenario de la matriz de autorización
   (§6 de ese documento, incluido el admin) consigue decidir un Meeting
   mientras el flag esté apagado, y que reactivarlo reproduce
   exactamente los mismos resultados ya validados.
4. `docs/fase4b-decision-flow-final.md` §6: añadir el flag como una
   **tercera capa**, evaluada antes que el ACL de scope y que la política
   de autorización (orden: flag → ACL de scope → política de usuario).
5. Nada de esto se ejecuta en esta puerta — es trabajo de repositorio
   pendiente, a realizar y probar contra la instancia desechable antes de
   que la Puerta 4 pueda incluir el flag como parte real del despliegue.

## 3. Ventana de exposición de `cMotivoResolucionReserva`

### Investigación: ¿acepta EspoCRM ACL de campo para un campo que aún no existe?

Leído el hook nativo de validación de `Role`/`PortalRole`
(`application/Espo/Classes/RecordHooks/Role/BeforeSaveValidate.php`,
método `validateFieldDataItemItem`):

```php
if (!$this->metadata->get("entityDefs.$scope.fields.$field")) {
    throw new BadRequest("Field *$field* does not exist in *$scope*.");
}
```

Este hook implementa `SaveHook` y se dispara vía
`Espo\Core\Record\HookManager` (confirmado en
`Core/Record/Service.php`: `processBeforeCreate`/`processBeforeUpdate`
llaman a `getRecordHookManager()->process...`). Es decir: **se ejecuta
siempre que un `Role` se guarda a través del `Record\Service` estándar**
— exactamente el camino que usa el panel de Administración vía HTTP.

**Conclusión — no viable por el camino estándar**: guardar ACL de campo
anticipada para `cMotivoResolucionReserva` antes de crear el campo en
metadata sería rechazado con `BadRequest: Field cMotivoResolucionReserva
does not exist in Meeting` si se hiciera vía el panel de Administración o
cualquier llamada a la API estándar de `Role`.

**Matiz importante**: el mecanismo nativo ya usado en la Puerta 3B
(`EntityManager`/`saveEntity()` directo, vía `setupSystemUser()`) **no
pasa por `Record\Service`/`HookManager`** — esta validación vive
exclusivamente en esa capa, no en el ORM. Técnicamente, ese camino de
bajo nivel probablemente aceptaría escribir el `fieldData` anticipado sin
lanzar la excepción. **No se recomienda hacerlo**, aunque sea posible:
dejaría el rol en un estado que el propio panel de Administración de
EspoCRM no puede reproducir ni volver a guardar — cualquier edición
futura de ese mismo rol vía la UI nativa (incluso una que no toque
`cMotivoResolucionReserva`, porque la UI reenvía el objeto `fieldData`
completo en cada guardado) fallaría con el mismo `BadRequest` mientras el
campo no exista. Sería una mina para cualquier administrador que use el
panel normal durante la ventana, no solo un riesgo teórico.

### Alternativa adoptada: ventana de mantenimiento sin devolver acceso entre operaciones

Dado que la ACL anticipada no es recomendable, se agrupan metadata +
`rebuild` + ACL en una única ventana, con `maintenanceMode=true` activo
durante toda ella (fases 3–4 de §4), sin ningún paso intermedio que
devuelva acceso:

1. Activar `maintenanceMode=true` (vía `ConfigWriter`, mismo mecanismo
   que §4 de v2).
2. Copiar `entityDefs/Meeting.json` (campo nuevo) → `rebuild`.
3. Aplicar el ACL de campo real (ya no anticipada — el campo ya existe en
   este punto, así que `validateFieldDataItemItem` la acepta sin
   excepción) sobre `Profesional Gapssa` (no/no) y `Portal GAPSSA API`
   (yes/yes), mismo mecanismo nativo que la Puerta 3B.
4. Verificar (§3 más abajo) que el ACL quedó exactamente como se pidió.
5. Desactivar `maintenanceMode` **solo después** de verificar el punto 4.

**Por qué esto cierra el riesgo real**: durante la ventana,
`Profesional Gapssa` (el único actor cuyo acceso al campo nos importa —
`Portal GAPSSA API` recibe `yes/yes`, sin exposición que evitar; admin
nunca está sujeto a ACL de campo, la bypassa siempre, por diseño de
EspoCRM, así que ninguna ventana de ACL lo protege ni lo expone de forma
distinta a como ya puede operar cualquier `Meeting` real hoy) queda sin
acceso alguno al sistema por `maintenanceMode`. En el instante en que
recupera acceso (mantenimiento desactivado), el ACL de campo ya está
aplicado — nunca hay un instante con el campo visible/editable y el ACL
todavía sin aplicar para un actor con sesión activa.

### Verificación tras `rebuild` de que el ACL sigue vigente

Tras cada `rebuild` de esta ventana:
`docker compose exec -T espocrm-db sh -lc 'mariadb ... -e "SELECT field_data FROM role WHERE id IN (\"6a7361290526f104b\",\"6a7b345b239b2ed26\");"'`
— comparar contra la matriz de §2 de `fase4b-puerta4-propuesta-v2.md`
(reafirmada aquí sin cambios: Admin yes/yes implícito, `Portal GAPSSA
API` yes/yes, `Profesional Gapssa` no/no, Anónimo sin acceso). `rebuild`
recompila metadata, nunca toca la tabla `role` — no hay motivo técnico
para que el ACL varíe, pero se verifica igual, sin asumir.

## 4. Orden de activación corregido

| Fase | Acción | Justificación |
|---|---|---|
| 1 | Backups y línea base | §6/§7 más abajo: hash+propietario+grupo+modo+tamaño+timestamp de los 6 archivos reales que se van a reemplazar, y confirmación de ausencia de los 15 archivos nuevos. Sin esto, ningún paso posterior es verificable ni reversible con precisión |
| 2 | `maintenanceMode=true` | Cierra el acceso de `Profesional Gapssa`/`Portal GAPSSA API`/portal a todo el sistema antes de tocar nada — no cierra el riesgo de admin (§2), que se cierra en la fase 9 con el flag, todavía apagado |
| 3 | Metadata/columna (`entityDefs/Meeting.json`) + `rebuild` | El campo empieza a existir — condición necesaria para que el ACL real (no anticipada) del siguiente paso sea aceptada por `BeforeSaveValidate` |
| 4 | ACL de `cMotivoResolucionReserva` (§3) + verificación | Inmediatamente después de la metadata, dentro de la misma ventana de mantenimiento — sin devolver acceso entre 3 y 4 |
| 5 | Tabla SQL (`install.sql`) | Después de que el ACL del campo esté cerrado; antes del código que la usa (`DecisionIdempotencyStore`) — si el código se desplegara antes que la tabla, la primera invocación real fallaría con un error SQL en vez de un fallo controlado |
| 6 | Clases PHP y hooks — **sin publicar `routes.json` todavía** | El código de `Classes/RecordHooks/Meeting` y `Classes/Api/GapssaMeetingDecision` queda copiado y cargable, pero sin la ruta HTTP registrada la ruta `PutDecide` no es invocable por nadie — ni siquiera por admin. Los hooks de `recordDefs` sí quedan activos aquí, pero solo se disparan ante un `save()` real de `Meeting`, y ninguno ocurre en esta puerta |
| 7 | Configuración de autorización (`...ApiUserIds`/`...UserIds`) + (si se adopta A) `gapssaBookingDecisionEnabled=false` explícito | Se escribe con la ruta todavía sin publicar (fase 8) — cuando la ruta exista, la config de autorización ya está en su valor final deseado, sin una ventana donde exista una cosa sin la otra |
| 8 | Cliente **y `routes.json`** en una fase final controlada | Aquí, y solo aquí, la ruta HTTP queda registrada — con el ACL, la config de autorización, y (si se adopta A) el flag en `false`, ya en su sitio. Es el punto exacto en que el hallazgo del punto 1 se vuelve relevante: desde este momento, admin puede invocar `PutDecide` real si NO se adoptó A (o si se adoptó A pero el flag sigue en `false`, no puede) |
| 9 | `rebuild` final + `app-check` + verificación GCS no destructiva (§10 de v2, sin cambios) + `maintenanceMode=false` | Cierre técnico. `maintenanceMode` se desactiva aquí, no antes — recupera acceso general solo cuando todo lo anterior está verificado |
| 10 | Activación de `gapssaBookingDecisionEnabled=true`, **solo si se adopta A** | Último paso, aparte, con su propia aprobación explícita — puede posponerse indefinidamente sin que el resto de la Puerta 4 quede incompleta. Si no se adopta A, esta fase no existe y el resultado final es el descrito en §8 con el admin ya técnicamente capaz desde la fase 8 |

**Variación justificada respecto al esqueleto pedido**: se inserta la
fase 1 (backups/línea base) antes de la exclusión de tráfico — sin
backups, ni siquiera se puede activar con confianza el modo mantenimiento
(no habría con qué comparar si algo falla durante la ventana). El resto
sigue el orden pedido literalmente.

## 5. Rollback de metadata — corregido

Se retira el `ALTER TABLE meeting DROP COLUMN c_motivo_resolucion_reserva`
automático de cualquier procedimiento de rollback de esta puerta.

- Rollback de metadata = **restaurar el archivo fuente exacto** (backup
  de §6, no reconstruido desde Git) + `rebuild`.
- Si la columna física `c_motivo_resolucion_reserva` ya se había creado,
  **se permite que permanezca** como residuo — aditiva (`NULL` por
  defecto, sin índice, sin `NOT NULL`), inocua para cualquier lectura o
  escritura existente del resto del sistema (ORM/EspoCRM/GCS ignoran
  columnas que no están en su metadata activa).
- Eliminarla exige una **autorización destructiva aparte**, explícita,
  después de:
  ```sql
  SELECT COUNT(*) FROM meeting WHERE c_motivo_resolucion_reserva IS NOT NULL;
  ```
  — solo si el resultado es `0`. Si hay cualquier valor no-`NULL`
  (solo podría ocurrir tras una Puerta 5 ya ejecutada, nunca dentro de
  esta puerta), no se propone ningún `DROP COLUMN` — sería destruir datos
  de decisiones reales ya tomadas.

## 6. Backup exacto de los 6 archivos reemplazados (antes de tocar nada)

**Regla**: backup = copia del archivo **vivo** del contenedor
(`docker compose exec ... cat > backup`), nunca una reconstrucción desde
Git — el archivo real puede diferir de lo que el repositorio cree que
hay ahí (ya ocurrió una vez, ver corrección documental anterior sobre
`entityDefs/Meeting.json`).

Línea base capturada ahora (solo lectura):

| Archivo | SHA-256 (real) | Propietario:Grupo | Modo | Tamaño | mtime (UTC) |
|---|---|---|---|---|---|
| `metadata/entityDefs/Meeting.json` | `d56b05d99d554e9e924aaea171e58801fd61112f8a59a415bec0c74a185b4a22` | **UID 501:GID 20** (sin nombre en el contenedor, aparece como `UNKNOWN:dialout`) | 644 | 1826 | 2026-08-11 14:16:59 |
| `metadata/recordDefs/Meeting.json` | `67c14118e319e3d9a0ab9b39e81d8ecaf1c12bd28d59e00f28b11768629e44b0` | www-data:www-data | 644 | 257 | 2026-08-04 13:19:13 |
| `metadata/clientDefs/Meeting.json` | `eaddf7b7a7a1a3c34af99164845755b708bb2ca62b824c94078c012d7c19382e` | www-data:www-data | **664** | 343 | 2026-08-03 18:43:46 |
| `layouts/Meeting/detail.json` | `e75df3ac81234cc4cc99268c7c2723b8d00bd5ddfc08388b41a3d57acb4069d7` | www-data:www-data | 644 | 1107 | 2026-08-05 18:26:57 |
| `i18n/es_ES/Meeting.json` | `be5dc87c26e865b2a4e71ed43d9c506e127ec941597be8e951ec4f1e7c6e418f` | www-data:www-data | 644 | 1022 | 2026-08-05 18:25:15 |
| `i18n/en_US/Meeting.json` | `c78d7cf8b1790837521fa489f78556e0d18a32b2e812a0c448bae4077ebd64ca` | www-data:www-data | 644 | 908 | 2026-08-05 18:25:20 |

`entityDefs/Meeting.json` **ya muestra hoy** la propiedad incorrecta (UID
del host, no `www-data`) — huella confirmada de un `docker
cp`/`docker compose cp` anterior (Puerta 2). Esto no es hipotético: es el
mismo fallo que se corregiría en el resto de archivos si no se actúa
explícitamente.

**Procedimiento por archivo** (no ejecutado):

1. Backup: `docker compose exec -T espocrm sh -lc 'cp custom/.../<archivo> custom/.../<archivo>.bak-puerta4-<ts>'` (dentro del propio volumen, nunca fuera).
2. Registrar la fila de la tabla de arriba como línea base (ya hecho).
3. `docker compose cp` del archivo del repositorio sobre el real.
4. **Inmediatamente después**: `stat` del archivo copiado. Si
   propietario/grupo no son `www-data:www-data`, o el modo no coincide
   con la columna "Modo" de la tabla de arriba (644 en 5 de los 6 casos,
   664 en `clientDefs`), corregirlo explícitamente:
   ```
   docker compose exec -T espocrm sh -lc 'chown www-data:www-data custom/.../<archivo> && chmod <modo-esperado> custom/.../<archivo>'
   ```
   — nunca asumir que `docker compose cp` preserva lo correcto; el propio
   `entityDefs/Meeting.json` real, ahora mismo, demuestra que no lo hace
   por defecto.
5. `sha256sum` del resultado — debe coincidir con el hash del archivo del
   repositorio (manifiesto v2 §5.5), nunca con el de la tabla de arriba
   (ese es el estado *previo*, el que se está reemplazando).

**Rollback**: restaurar desde el backup exacto del paso 1
(`cp ....bak-puerta4-<ts> <archivo original>`), `rebuild`, y verificar
que propietario/grupo/modo/hash vuelven a coincidir con la tabla de
arriba — no con ningún archivo reconstruido del repositorio.

## 7. Archivos nuevos (los 15 restantes del manifiesto v2 §5.1–§5.4)

**Ausencia previa** — confirmada de nuevo ahora (solo lectura): el
directorio `Classes/Api` no existe en el contenedor real; `routes.json`
no existe; `client/custom` solo contiene módulos de `google-calendar-sync`
(ninguna ruta bajo `views/meeting/`); `Classes/RecordHooks/Meeting/` solo
contiene `SendInvitationsAfterCreate.php`/`SendInvitationsAfterUpdate.php`
(ninguno de los 7 nuevos).

**Propietario/grupo/modo esperado tras la copia**, por tipo, según
convención real ya usada en el mismo contenedor:

| Tipo | Referencia real usada | Propietario:Grupo esperado | Modo esperado |
|---|---|---|---|
| PHP (`Classes/RecordHooks/Meeting/*.php`, `Classes/Api/GapssaMeetingDecision/*.php`) | `SendInvitationsAfterCreate.php` (`www-data:www-data`, `644`) | www-data:www-data | 644 |
| `routes.json` | Resto de `Resources/*.json` no-`clientDefs` (644 mayoritario) | www-data:www-data | 644 |
| Cliente (`client/custom/src/views/meeting/*.js`) | `client/custom/modules/google-calendar-sync/.../gcs-settings.js` (`www-data:www-data`, `664`) | www-data:www-data | 664 |

Mismo procedimiento de verificación/corrección explícita que en §6 tras
cada copia (no asumir que `docker compose cp` deja lo correcto).

**Rollback — solo rutas exactas del manifiesto**: eliminar
individualmente cada una de las 15 rutas listadas en
`fase4b-puerta4-propuesta-v2.md` §5.1–§5.4 con su ruta completa y
exacta:

```
docker compose exec -T espocrm sh -lc 'rm -f custom/Espo/Custom/Classes/RecordHooks/Meeting/EstadoReservaStatusMap.php'
docker compose exec -T espocrm sh -lc 'rm -f custom/Espo/Custom/Classes/RecordHooks/Meeting/GuardMeetingDecisionTransition.php'
... (una línea por cada uno de los 15 archivos, nunca rm -rf de un directorio, nunca un glob)
```

Los directorios que quedan vacíos tras el rollback (`Classes/Api/`,
`Classes/Api/GapssaMeetingDecision/`) **no se eliminan** en este
procedimiento — quedar un directorio vacío es inocuo; borrar un
directorio completo arriesga llevarse por delante algo no listado en el
manifiesto que hubiera aparecido ahí después por cualquier otra razón.

## 8. Resultado de la Puerta 4 — redefinido

No se realiza ninguna llamada `PutDecide` ni ninguna escritura de
`Meeting` como parte de esta puerta. **No se describe como "inerte"**:
desde la fase 8 de §4 (cliente + `routes.json` publicados), la ruta
`PUT /GapssaMeetingDecision/{id}` queda técnicamente invocable contra la
instancia real. Actores exactos que podrían invocarla al terminar la
Puerta 4, en función de si se adopta el flag:

**Si se adopta A y el flag queda en `false` al cerrar la puerta (fase 9,
sin ejecutar la fase 10)**: ningún actor puede invocarla con efecto —
la comprobación del flag es la primera línea de `process()` y responde
`503` antes de tocar ACL, `Meeting` o la base de datos, para cualquier
usuario, admin incluido.

**Si no se adopta A, o se adopta pero se activa el flag (fase 10)**:
- El único usuario `type=admin` de la instancia real (id
  `6a70ac4451597eea8`) — autorizado incondicionalmente por
  `MeetingDecisionAuthorizationPolicy`, con o sin las listas escritas.
- `portal-gapssa-api` (id `6a7b345b2624dbb56`) — autorizado porque su id
  queda escrito en `gapssaBookingDecisionAuthorizedApiUserIds` en la
  fase 7 de §4, que es parte del alcance propio de esta puerta.
- El usuario `regular` existente (rol `Profesional Gapssa`) **no** está
  autorizado — `gapssaBookingDecisionAuthorizedUserIds` queda vacía, y la
  política deniega a cualquier humano no admin ausente de esa lista.
- El usuario `system` (interno, `type=system`) no es alcanzable vía HTTP
  autenticado — no aplica.

En ambos casos, cualquier invocación real (si el flag lo permitiera)
solo podría afectar a un `Meeting` real en `PendingCenterApproval` — la
misma garantía de `MeetingDecisionTransitionPolicy` que protege cualquier
otra vía de escritura.

## 9. Puerta 5 — separación mantenida

Sin cambios respecto a la v2: la primera escritura end-to-end (crear un
`Meeting [PRUEBA]`, decidirlo vía `PutDecide`) sigue completamente fuera
de esta puerta, no propuesta aquí, con su propia autorización explícita
por separado.

---

**Nada de este documento se ha ejecutado.** Queda a la espera de: (a) tu
decisión sobre adoptar el flag (A) o aceptar la exposición residual del
admin (B, documentada en §2); (b) tu aprobación explícita, fase por fase
de §4, antes de ejecutar cualquier operación real.
