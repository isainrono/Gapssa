# Fuentes de verdad y reglas de negocio

Todo en este archivo procede de `/PROJECT_CONTEXT.md` (documento maestro, última
actualización 3 de agosto de 2026) y `/PLAN_DESARROLLO_WEB_PORTAL.md` (5 de
agosto de 2026). Marca: **[DOC]** = decisión validada y documentada.
**[ND]** = decisión pendiente, explícitamente aplazada; no debe inventarse.

Si un cambio propuesto contradice este archivo, hay que detenerse y pedir
confirmación al propietario del proyecto antes de implementar. No actualices
código de negocio sin comprobar primero si `PROJECT_CONTEXT.md` ya lo resuelve.

## 1. Qué es Gapssa [DOC]

Centro de estética y belleza integral en Barcelona (`Carrer de Gayarre 24,
08014 Barcelona`), nombre comercial **GAPSSA by Nana**. Servicios
exclusivamente estéticos no médicos: sin inyecciones ni procedimientos
reservados a personal sanitario. Tres capas de negocio:

1. **Web**: captación, catálogo, reservas, contenidos multilingües, área privada.
2. **Dashboard/CRM**: clientes, agenda, tratamientos, consentimientos, operación diaria.
3. **ERP**: ventas, pagos, facturación, contabilidad, inventario, compras, personal.

Google Calendar es agenda **complementaria**, nunca fuente de verdad.
**n8n Community Edition** es el orquestador central de integraciones, de uso
exclusivamente interno (ver §9).

## 2. Principios rectores [DOC]

- Primero se modelan y validan los procesos de negocio; la tecnología se adapta.
- Cada dato tiene **un único sistema responsable**.
- La información sensible se separa de los datos económicos y del calendario.
- Prohibidas las escrituras directas entre bases de datos de distintas apps:
  todo pasa por API, eventos o jobs asíncronos idempotentes.
- Las personalizaciones son módulos/plugins separados del núcleo de cada
  plataforma (EspoCRM, Payload, FacturaScripts). Nunca tocar el núcleo.
- Priorizar componentes gratuitos y autoalojables.
- El sistema debe crecer sin rediseñar los procesos principales.

## 3. Tabla de fuentes de verdad [DOC]

Consulta esta tabla antes de decidir dónde vive un dato o quién lo expone.

| Dominio | Sistema responsable | Consumidores |
|---|---|---|
| Clientes e identidad operativa | EspoCRM | Web, n8n, FacturaScripts |
| Consultas y potenciales clientes | EspoCRM | Web, n8n |
| Citas y estados | EspoCRM | Web, Google Calendar, n8n |
| Tratamientos, consentimientos, datos sensibles | EspoCRM | Área privada autorizada |
| Definición operativa de servicios | EspoCRM | Web, n8n |
| Precio base, impuestos, economía | FacturaScripts (futuro) | EspoCRM, Web, n8n |
| Pagos, deudas, devoluciones | FacturaScripts (futuro) | CRM, Web |
| Facturas y documentos fiscales | FacturaScripts (futuro) | CRM, Web |
| Stock, lotes, compras, proveedores | FacturaScripts (futuro) | CRM, dirección |
| Contabilidad y gestión laboral | FacturaScripts (futuro) | Gestoría, dirección |
| Contenido multilingüe (web) | Payload CMS | Web |
| Agenda complementaria | Google Calendar | Profesional |
| Orquestación e integraciones | n8n | Todos, vía API |
| Credenciales, sesión, verificación de acceso web | Aplicación Next.js | Portal privado |
| Bloqueos y códigos temporales de reserva | Redis (plan) | Next.js BFF |

La base de datos de la web solo debe guardar lo necesario para autenticación y
un vínculo al identificador de EspoCRM; nunca duplicar la ficha completa del
cliente [DOC, §4.2 del plan de portal].

## 4. Modelo de negocio validado [DOC]

- Un único centro en la fase inicial; una profesional durante la apertura.
- Futuras incorporaciones serán **empleados**, nunca autónomos ni arrendatarios
  de cabina.
- Dos zonas de atención, inicialmente polivalentes, ampliables después.
- Los equipos (aparatología) no bloquean agenda inicialmente: sin estados de
  disponibilidad, avería ni mantenimiento en el calendario.
- Cada cliente tiene un profesional de cabecera; otro puede atenderlo de forma
  eventual con autorización.
- Atención en el centro y, más adelante, a domicilio/ubicaciones externas con
  suplemento de desplazamiento por zona configurable.

## 5. Catálogo inicial [DOC]

55 conceptos de apertura, antes de desglosar variantes. Familias:

- **Masajes** (13 tipos; variantes conocidas de 30/60 min): relajante,
  descontracturante, deportivo, prenatal, aromaterapia, craneofacial, facial,
  piernas cansadas, relajante de pies, reflexología podal, drenaje manual,
  piedras calientes, exfoliación corporal.
- **Aparatología** (5): presoterapia, presoterapia + masaje, lipoláser +
  radiofrecuencia, vacum, láser fisio dolor.
- **Depilación**: métodos láser/cera/hilo × 19 zonas (cejas, labio superior,
  mentón, patillas, facial completo, axilas, espalda, brazos, medio brazo,
  pecho, abdomen, glúteos, perianal, ingles brasileñas/normales/integrales,
  piernas, medias piernas). **La matriz método × zona no está definida** [ND]:
  no asumas que todos los métodos aplican a todas las zonas.
- **Faciales** (9): limpieza básica/profunda, mesoterapia estética no
  inyectable, microneedling, dermapen, radiofrecuencia, peeling PRX, SkinPen,
  láser de carbono.
- **Uñas** (7): manicura/pedicura express, tradicional, semipermanente;
  parafina de manos.
- **Pestañas y cejas** (4): lifting, lifting + tinte, tinte, laminado de cejas.

Las 6 familias en EspoCRM (`CTratamiento.familia`) son: Masajes, Aparatología,
Depilación, Tratamientos faciales, Uñas, Pestañas y cejas — ver
[[03-espocrm-modelo-y-extension-gcs]].

## 6. Modelo comercial y de precio [DOC / ND]

Previstas (nombres, precios y reglas concretas **pendientes** [ND]): sesiones
individuales, bonos, packs, membresías, suscripciones mensuales con renovación
automática, tarjetas regalo, puntos/niveles/recompensas/referidos/cumpleaños,
códigos promocionales.

Fórmula validada [DOC]:

```
precio final = importe base + suplementos - descuentos o beneficios
```

Suplementos según duración, zona, modalidad, desplazamiento, técnica, material
o complemento. El cliente debe conocer el precio antes de enviar la solicitud;
si requiere valoración, se puede mostrar precio orientativo o "desde".

Suscripciones: renovación automática; si falla el cobro, los beneficios se
suspenden de inmediato; 5 días para actualizar el método de pago; sin cobro,
sin consumo de beneficios durante la suspensión.

## 7. Reservas y agenda [DOC]

### 7.1 Canales admitidos
Web, WhatsApp, teléfono, Instagram/redes, presencial, alta interna por la
profesional, futuras plataformas externas. **Todas** terminan en la agenda
central única (EspoCRM).

### 7.2 Reglas iniciales
- Todas las reservas requieren **aprobación manual** al inicio (confirmación
  automática por servicio, fase posterior).
- Sin señal ni prepago inicialmente.
- Reglas de cancelación/penalización: pendientes [ND].
- Se registran cancelaciones, reprogramaciones, retrasos, ausencias.
- Cada cita corresponde a **un único tratamiento**; varias citas consecutivas
  pueden formar una visita y cobrarse/facturarse juntas.
- Alta rápida y cita inmediata para clientes sin cita previa.
- Lista de espera con retención temporal del hueco ofrecido.

### 7.3 Estados base de una cita [DOC]
1. Solicitud recibida
2. Pendiente de autorización del tutor
3. Pendiente de valoración
4. Pendiente de aprobación del centro
5. Confirmada
6. Cliente llegado
7. En tratamiento
8. Completada
9. Cancelada
10. No presentado
11. Reprogramación solicitada
12. Conflicto de agenda

Cada transición conserva fecha, usuario o sistema, canal y motivo. Esto **no**
es todavía el conjunto de `status` real de la entidad `Meeting` en EspoCRM
(que hoy usa los valores nativos del CRM); es el modelo de negocio objetivo
para cuando se construya el flujo de reservas — ver
[[04-portal-web-reservas-plan]] §Estados y aprobación.

## 8. Clientes, privacidad y tratamientos [DOC]

- Reserva como invitado o con cuenta registrada.
- Alta web nueva exige nombre, apellidos, teléfono y correo. Durante la
  transición desde Google Calendar se permiten fichas solo con nombre y
  teléfono.
- Teléfono/correo ayudan a localizar coincidencias; **las coincidencias
  dudosas nunca se fusionan automáticamente**.
- Cada cliente tiene un identificador interno único. Menores, tutores,
  empresas, contactos y beneficiarios: fichas separadas y relacionadas.

### Menores [DOC, fase posterior]
El menor puede solicitar cita; queda pendiente hasta autorización del tutor;
tras autorizar, pasa a aprobación del centro; si el tutor no responde en un
plazo configurable, la solicitud caduca y libera el horario. Al alcanzar la
mayoría de edad, el joven puede pedir independencia — no es automática,
requiere confirmación e identidad verificada.

### Consentimientos y datos sensibles [DOC]
Cuestionario general de salud actualizable; consentimiento por familia o tipo
de tratamiento; nueva confirmación si cambia tratamiento/protocolo/riesgos/
estado de salud; se registra versión, fecha, firmante, alcance y revocación;
permisos separados para fotos privadas vs. uso promocional; el cliente decide
el alcance de acceso de los profesionales a su ficha; se admite autorización
puntual a un sustituto.

### Registro de sesión [DOC]
Servicio y protocolo, profesional, zona, fecha, duración real, productos y
lotes, parámetros de aparatología, observaciones y reacciones, fotos
autorizadas, resultados/evolución, recomendaciones, incidencias. Cada
contenido puede marcarse interno o visible para el cliente.

### Comunicaciones [DOC]
Correo, WhatsApp, SMS, notificaciones del área privada. Operativas separadas
de comerciales; nunca promociones sin consentimiento expreso. Las llamadas no
se graban.

## 9. n8n: condición de uso [DOC]

n8n se usa **únicamente** para operaciones internas de Gapssa:

- Los clientes no acceden al editor ni al panel de n8n.
- No se revende n8n ni se ofrece automatización a terceros desde esta
  instancia.
- Si el proyecto se convierte en producto para franquicias/terceros, hay que
  **revisar la licencia** antes de ampliar el uso.

## 10. Inventario y proveedores [DOC]

No se venden productos al público inicialmente (el modelo lo permite después).
Desde el inicio se controlan los consumibles: cada servicio tiene una
plantilla de consumos previstos, la profesional corrige cantidades reales, se
controlan lotes/caducidad y se conserva trazabilidad del lote aplicado.

## 11. Pagos, facturación y empresas [DOC]

Métodos: efectivo, tarjeta, Bizum, transferencia, combinaciones, pagos
parciales. Online: tarjeta/Bizum inmediatos, transferencia pendiente hasta
confirmar ingreso, efectivo solo presencial. Documentos: facturas
simplificadas/completas/rectificativas; apertura, cierre y arqueo de caja. La
gestoría accede al área económica/fiscal/laboral del ERP pero **no** a
cuestionarios, fotos, consentimientos ni notas sensibles del CRM. Empresas
pueden tener beneficiarios/empleados asociados; la información estética
pertenece al beneficiario, no es accesible para la empresa.

## 12. Empleados y permisos [DOC, mayormente futuro]

Roles previstos: dirección, recepción, profesional, almacén, gestoría.
Principio de acceso mínimo necesario. Comisiones, incentivos y objetivos
configurables; solo importes aprobados pasan a nómina. Determinadas
devoluciones, descuentos, compensaciones y anulaciones requieren aprobación de
dirección.

## 13. Criterio obligatorio para cambios futuros [DOC]

Antes de implementar cualquier función nueva, responde:

1. ¿Qué proceso de negocio resuelve?
2. ¿Qué sistema es propietario del dato?
3. ¿Qué otros sistemas necesitan copia o referencia?
4. ¿Contiene información sensible, fiscal o laboral?
5. ¿Qué sucede si la integración falla?
6. ¿Cómo se evita duplicar la operación?
7. ¿Qué debe quedar auditado?
8. ¿Cómo se prueba y se revierte?

## 14. Decisiones pendientes que NO deben inventarse [ND]

Duración predeterminada de cada servicio · precios base y suplementos ·
condiciones de bonos/packs/membresías · política de cancelación, retrasos y
ausencias · reglas de señal/prepago · matriz método de depilación × zona ·
qué servicios requieren valoración/cuestionario/prueba/consentimiento
específico · vigencia de consentimientos · zonas de cobertura a domicilio y
suplementos · horario habitual del centro · pedido mínimo de desplazamiento ·
reglas de fidelización y promociones · plazos de facturación empresarial ·
destino externo definitivo de backups · teléfono/WhatsApp públicos definitivos
· cuenta de Instagram definitiva · credenciales SMTP · textos legales
definitivos · condiciones de tratamientos con aparatología.

Si una tarea depende de uno de estos valores, trátalo como configuración o
dato administrable, no como constante de negocio. No lo rellenes por tu
cuenta: pregunta o dilo explícitamente como bloqueante.

## 15. Fecha de lanzamiento inicial y roadmap [DOC]

Primer lanzamiento (EspoCRM operativo, no la web): **lunes 10 de agosto de
2026**. V1 del portal web/reservas: objetivo **1 de septiembre de 2026**
(desarrollo y validación en local; despliegue a VPS/Plesk solo tras
aprobación explícita del propietario). Roadmap posterior por hitos 2–8:
ficha avanzada → web y reservas → venta y fiscalidad → inventario y compras →
bonos y fidelización → equipo → optimización. Ver
[[04-portal-web-reservas-plan]] para el detalle de fases de implementación de
la V1 y [[05-infraestructura-y-operacion]] para el calendario orientativo.
