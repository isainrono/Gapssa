# EspoCRM — modelo operativo inicial

Fecha de configuración inicial: 3 de agosto de 2026.
Actualizado: 5 de agosto de 2026 (Fase 0 del plan de portal — auditoría real
contra la instancia en ejecución, alta del campo `cEstadoReserva` y
corrección posterior: se retiró su valor por defecto).

## Decisiones

- Los clientes se almacenan en la entidad nativa `Contact` (`Contacto`).
- Las citas utilizan la entidad nativa `Meeting` (`Reunión`) para conservar las
  funciones de calendario, participantes, recordatorios y sincronización.
- La interfaz mostrará `Meeting` como `Cita`; el nombre técnico se mantiene para
  no romper compatibilidad con la API de EspoCRM.
- Los tratamientos y las zonas son entidades personalizadas de tipo `Base`.
- EspoCRM almacena un precio operativo orientativo para preparar el catálogo y
  la agenda. FacturaScripts será la fuente de verdad económica y fiscal cuando
  se integre; impuestos, cobros y facturación no se gestionan aquí.

## Entidad Tratamiento

Nombre técnico: `CTratamiento`.

| Campo | Tipo | Reglas |
|---|---|---|
| `name` | Texto | Nombre del tratamiento; obligatorio por EspoCRM |
| `familia` | Lista | Obligatorio y auditado |
| `duracionMinutos` | Entero | Obligatorio, valor inicial 60, mínimo 5, máximo 480, auditado |
| `precioOrientativo` | Moneda | Opcional, EUR por configuración, mínimo 0 y auditado; no fiscal |
| `estadoPrecio` | Lista | `Pendiente`, `Fijo`, `Desde` o `Bajo valoración`; obligatorio y auditado |
| `activo` | Sí/No | Activo por defecto y auditado |
| `description` | Texto | Descripción operativa opcional |

Familias iniciales:

- Masajes
- Aparatología
- Depilación
- Tratamientos faciales
- Uñas
- Pestañas y cejas

## Entidad Zona de atención

Nombre técnico: `CZonaAtencion`.

| Campo | Tipo | Reglas |
|---|---|---|
| `name` | Texto | Nombre visible de la zona |
| `tipo` | Lista | `Centro` o `Domicilio / externa`; obligatorio y auditado |
| `activa` | Sí/No | Activa por defecto y auditada |
| `capacidadSimultanea` | Entero | Obligatorio, valor inicial 1, mínimo 1, máximo 20 y auditado |
| `suplementoDesplazamiento` | Moneda | Opcional y auditado; previsto para zonas externas, no fiscal |
| `description` | Texto | Observaciones opcionales |

## Relaciones de la cita

| Origen | Relación | Destino | Campo técnico en la cita |
|---|---|---|---|
| `Meeting` | Muchos-a-uno | `CTratamiento` | `cTratamiento` |
| `Meeting` | Muchos-a-uno | `CZonaAtencion` | `cZonaAtencion` |
| `Meeting` | Muchos-a-muchos nativa | `Contact` | `contacts` |

La relación inversa de tratamientos y zonas se etiqueta como `Citas`.

## Estado de reserva de la cita

Campo técnico `cEstadoReserva` en `Meeting`, tipo lista, opcional, auditado,
**sin valor por defecto**. Representa el modelo de negocio de 12 estados de
`PROJECT_CONTEXT.md` §6.3, independiente del `status` nativo de `Meeting`
(`Planned`/`Held`/`Not Held`), que sigue gobernando la semántica de
calendario y la extensión Google Calendar Sync (`canceledStatusList`). No se
ha tocado el `status` nativo para no romper la extensión ni las vistas de
calendario/kanban de EspoCRM.

| Valor técnico | Estado de negocio |
|---|---|
| `RequestReceived` | Solicitud recibida |
| `PendingGuardianAuthorization` | Pendiente de autorización del tutor |
| `PendingAssessment` | Pendiente de valoración |
| `PendingCenterApproval` | Pendiente de aprobación del centro |
| `Confirmed` | Confirmada |
| `ClientArrived` | Cliente llegado |
| `InTreatment` | En tratamiento |
| `Completed` | Completada |
| `Canceled` | Cancelada |
| `NoShow` | No presentado |
| `RescheduleRequested` | Reprogramación solicitada |
| `ScheduleConflict` | Conflicto de agenda |

No es obligatorio (`required: false`) **ni tiene valor por defecto**
(corrección de Fase 0, 5 de agosto: el alta inicial de este campo llevaba
`default: "RequestReceived"`, retirado antes de aprobar el documento técnico
porque el campo también cubre reuniones que nunca pasan por el flujo del
portal). Una cita puede existir con `cEstadoReserva` vacío/`NULL`:

- **Reuniones internas** (no ligadas a una reserva de cliente): quedan sin
  este campo; el personal puede asignarlo manualmente desde EspoCRM si
  decide incorporarlas al flujo de reservas, pero nada lo hace automático.
- **Citas importadas desde Google Calendar** durante la transición
  (`PROJECT_CONTEXT.md` §16.3): igual, quedan sin valor hasta que alguien lo
  asigne.
- **Flujo automático del portal** (reserva de invitado, Fase 4): nunca
  depende de un valor implícito. El backend asigna
  `cEstadoReserva = "PendingCenterApproval"` explícitamente en el mismo
  momento en que crea el `Meeting` (justo después de verificar el correo del
  invitado), no antes y no por defecto. Ver
  `packages/contracts/src/booking.ts` y
  `docs/contratos-portal-v1.md` para el ciclo de vida completo.

Verificado en la instancia real (5 de agosto): se creó un `Meeting` de
prueba sin especificar `cEstadoReserva` y quedó con el campo a `NULL` en
base de datos; se eliminó (soft-delete estándar) tras verificar. Los 9
`Meeting` ya existentes en la instancia (datos de prueba anteriores a esta
corrección) conservan el valor `RequestReceived` que el `default` antiguo
les asignó al crear la columna — **no se han reescrito**, por ser datos ya
existentes; quedan como resto conocido de la iteración anterior del campo,
no como estado de negocio real de esas citas.

La tabla de correspondencia obligatoria entre `cEstadoReserva` y el `status`
nativo de `Meeting` está en `docs/contratos-portal-v1.md` §6 y en
`packages/contracts/src/estado-reserva.ts`
(`ESTADO_RESERVA_A_MEETING_STATUS`). Las transiciones válidas entre estados
y quién puede efectuarlas son diseño de la Fase 4 (reservas) del plan de
portal, no de esta alta de campo.

## Moneda

- Moneda predeterminada: EUR.
- Moneda base: EUR.
- USD se conserva temporalmente en la lista de monedas de EspoCRM.

El ajuste de moneda base evita que una reconstrucción de metadatos intente
calcular una tasa USD/EUR inexistente durante el arranque inicial.

## Configuración visible y prueba funcional

- El nombre de la aplicación visible es `Gapssa`.
- La entidad técnica `Meeting` se muestra como `Cita` / `Citas`.
- `Tratamientos` y `Zonas de atención` están incluidos en la navegación.
- El formulario de tratamiento muestra nombre, familia, duración, precio
  orientativo, estado del precio, activo y descripción.
- El formulario de zona muestra tipo, estado, capacidad, suplemento opcional y
  observaciones.
- El formulario de cita muestra estado (nativo), estado de reserva
  (`cEstadoReserva`), tratamiento y zona de atención.

Datos ficticios creados para la validación:

- Tratamiento: `Masaje relajante 60 min [PRUEBA]`.
- Zona: `Cabina 1 [PRUEBA]`.
- Zona: `Cabina 2 [PRUEBA]`.
- Cita validada: `Cita Isain Uñas`, vinculada al contacto existente, al
  tratamiento de prueba y a `Cabina 1 [PRUEBA]`.

Los registros con el sufijo `[PRUEBA]` no representan datos operativos reales y
se pueden sustituir cuando se cargue el catálogo definitivo.
