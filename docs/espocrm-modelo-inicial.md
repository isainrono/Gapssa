# EspoCRM — modelo operativo inicial

Fecha de configuración inicial: 3 de agosto de 2026.

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
- El formulario de cita muestra tratamiento y zona de atención.

Datos ficticios creados para la validación:

- Tratamiento: `Masaje relajante 60 min [PRUEBA]`.
- Zona: `Cabina 1 [PRUEBA]`.
- Zona: `Cabina 2 [PRUEBA]`.
- Cita validada: `Cita Isain Uñas`, vinculada al contacto existente, al
  tratamiento de prueba y a `Cabina 1 [PRUEBA]`.

Los registros con el sufijo `[PRUEBA]` no representan datos operativos reales y
se pueden sustituir cuando se cargue el catálogo definitivo.
