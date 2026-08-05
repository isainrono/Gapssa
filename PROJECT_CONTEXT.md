# Gapssa — Contexto base del proyecto

> Documento maestro de contexto funcional, operativo y técnico.
>
> Última actualización: 3 de agosto de 2026.
>
> Este documento recoge las decisiones validadas durante la planificación inicial. Debe consultarse antes de diseñar, implementar o modificar cualquier parte del sistema. Si una decisión cambia, debe actualizarse este archivo y conservarse la trazabilidad del cambio en Git.

## 1. Objetivo

Construir un entorno informático modular para **Gapssa**, centro de estética y belleza integral ubicado en Barcelona, España.

La solución se organiza en tres capas de negocio:

1. **Web**: captación, catálogo, reservas, contenidos multilingües y futura área privada.
2. **Dashboard/CRM**: clientes, agenda, tratamientos, consentimientos, comunicaciones y operación diaria.
3. **ERP**: ventas, pagos, facturación, contabilidad, inventario, compras, proveedores y gestión laboral.

Google Calendar funcionará como agenda complementaria. **n8n Community Edition** será el orquestador central de integraciones y automatizaciones.

## 2. Principios del proyecto

- Primero se modelan y validan los procesos de negocio; la tecnología se adapta a ellos.
- Cada dato debe tener un único sistema responsable.
- La información sensible se separa de los datos económicos y del calendario.
- No deben existir escrituras directas entre las bases de datos de distintas aplicaciones.
- Las integraciones deben ser idempotentes, auditables y tolerantes a interrupciones.
- Las personalizaciones se implementarán como módulos o plugins separados del núcleo de cada plataforma.
- Se priorizan componentes gratuitos y autoalojables.
- n8n se utilizará exclusivamente para los procesos internos de Gapssa. Su panel no se ofrecerá a clientes ni a terceros.
- El sistema debe poder crecer sin rediseñar los procesos principales.

## 3. Modelo de negocio validado

### 3.1 Centro y capacidad inicial

- Un único centro en la fase inicial.
- Una profesional durante la apertura.
- Futuras incorporaciones serán empleados, no autónomos ni arrendatarios de cabina.
- Dos zonas de atención inicialmente polivalentes.
- Las zonas podrán especializarse y ampliarse posteriormente.
- Los equipos no se gestionarán inicialmente como recursos bloqueantes de agenda.
- Cada cliente tendrá un profesional de cabecera.
- Otro profesional podrá atenderlo de forma eventual con la autorización correspondiente.

### 3.2 Público y posicionamiento

- Público mixto, con orientación comercial principalmente femenina.
- Servicios exclusivamente estéticos no médicos.
- No se realizarán inyecciones ni procedimientos reservados a personal sanitario.
- Posicionamiento de precio medio o razonable.
- Diferenciación basada en profesionalidad, atención, confianza y resultados.

### 3.3 Modalidades de atención

- Atención en el centro.
- Atención a domicilio o en ubicaciones externas.
- Los servicios externos estarán limitados a zonas configurables.
- Se aplicará un suplemento de desplazamiento según la zona.
- Las valoraciones podrán ser presenciales o por videollamada, según acuerdo entre profesional y cliente.

## 4. Catálogo inicial de servicios

El catálogo de apertura contiene **55 conceptos**, antes de desglosar variantes de duración, método, zona, sesiones o complementos.

### 4.1 Masajes

Con variantes conocidas de 30 y 60 minutos:

1. Relajante.
2. Descontracturante.
3. Deportivo.
4. Prenatal.
5. Aromaterapia.
6. Craneofacial.
7. Facial.
8. Piernas cansadas.
9. Relajante de pies.
10. Reflexología podal.
11. Drenaje manual.
12. Piedras calientes.
13. Exfoliación corporal.

### 4.2 Tratamientos con aparatología

1. Presoterapia.
2. Presoterapia + masaje.
3. Lipoláser + radiofrecuencia.
4. Vacum.
5. Láser fisio dolor.

### 4.3 Depilación

Métodos:

- Láser.
- Cera.
- Hilo.

Zonas o servicios:

1. Diseño de cejas.
2. Cejas.
3. Labio superior.
4. Mentón.
5. Patillas.
6. Facial completo.
7. Axilas.
8. Espalda.
9. Brazos.
10. Medio brazo.
11. Pecho.
12. Abdomen.
13. Glúteos.
14. Perianal.
15. Ingles brasileñas.
16. Ingles normales.
17. Ingles integrales.
18. Piernas.
19. Medias piernas.

La matriz de combinaciones válidas entre método y zona se definirá posteriormente. No se debe asumir que todos los métodos son aplicables a todas las zonas.

### 4.4 Tratamientos faciales

1. Limpieza básica.
2. Limpieza profunda.
3. Mesoterapia estética no inyectable.
4. Microneedling.
5. Dermapen.
6. Radiofrecuencia.
7. Peeling PRX.
8. SkinPen.
9. Láser de carbono.

### 4.5 Uñas

1. Manicura express.
2. Manicura tradicional.
3. Manicura semipermanente.
4. Parafina de manos.
5. Pedicura express.
6. Pedicura tradicional.
7. Pedicura semipermanente.

### 4.6 Pestañas y cejas

1. Lifting de pestañas.
2. Lifting de pestañas + tinte.
3. Tinte.
4. Laminado de cejas.

## 5. Modalidades comerciales previstas

- Sesiones individuales.
- Bonos de varias sesiones.
- Packs combinados.
- Membresías.
- Suscripciones mensuales con renovación automática.
- Tarjetas regalo por importe, servicio o pack.
- Programa de puntos, niveles, recompensas, referidos y cumpleaños.
- Códigos promocionales y descuentos configurables.

Los nombres, precios, duraciones, vigencias, reglas de consumo, cancelaciones y devoluciones se definirán después de estabilizar la operativa principal.

### 5.1 Modelo de precio

El modelo validado es:

`precio final = importe base + suplementos - descuentos o beneficios`

Los suplementos podrán depender de duración, zona, modalidad, desplazamiento, técnica, material o complemento. El cliente deberá conocer el precio calculado antes de enviar la solicitud. Cuando sea necesaria valoración se podrá mostrar un precio orientativo o “desde”.

### 5.2 Suscripciones

- Renovación automática.
- Si falla el cobro, los beneficios se suspenden inmediatamente.
- El cliente dispone de cinco días para actualizar el método de pago.
- Si el cobro se completa, los beneficios se reactivan.
- Durante la suspensión no se pueden consumir beneficios.

## 6. Reservas y agenda

### 6.1 Canales

Se admitirán reservas o solicitudes desde:

- Web.
- WhatsApp.
- Teléfono.
- Instagram y otras redes sociales.
- Presencialmente.
- Alta interna por la profesional.
- Futuras plataformas externas.

Todas deben terminar en una agenda central única.

### 6.2 Reglas iniciales

- Todas las reservas requieren aprobación manual al inicio.
- En el futuro podrá activarse confirmación automática por servicio.
- Inicialmente no se exigirá señal ni prepago.
- Las reglas de cancelación y penalización se definirán posteriormente.
- Se registrarán cancelaciones, reprogramaciones, retrasos y ausencias.
- Cada cita corresponde a un único tratamiento.
- Se pueden organizar varias citas consecutivas en una misma visita.
- Varias citas de una visita pueden cobrarse y facturarse conjuntamente.
- Se admiten clientes sin cita mediante alta rápida y cita inmediata.
- Existirá lista de espera con retención temporal del hueco ofrecido.

### 6.3 Estados base de una cita

1. Solicitud recibida.
2. Pendiente de autorización del tutor.
3. Pendiente de valoración.
4. Pendiente de aprobación del centro.
5. Confirmada.
6. Cliente llegado.
7. En tratamiento.
8. Completada.
9. Cancelada.
10. No presentado.
11. Reprogramación solicitada.
12. Conflicto de agenda.

Cada transición debe conservar fecha, usuario o sistema, canal y motivo.

## 7. Clientes, privacidad y tratamientos

### 7.1 Alta e identidad

- Se puede reservar como invitado o mediante cuenta registrada.
- Para nuevas solicitudes web serán obligatorios nombre, apellidos, teléfono y correo.
- Durante la transición desde Google Calendar se permitirá crear fichas con nombre y teléfono.
- Teléfono y correo ayudan a localizar coincidencias.
- Las coincidencias dudosas no se fusionan automáticamente.
- Cada cliente dispone de un identificador interno único.
- Menores, tutores, empresas, contactos y beneficiarios tienen fichas separadas y relacionadas.

### 7.2 Menores

- Los menores pueden solicitar una cita.
- La solicitud queda pendiente hasta que el tutor autorice.
- Tras la autorización del tutor, la cita pasa a aprobación del centro.
- Si la autorización no llega dentro del plazo configurable, la solicitud caduca y libera el horario.

### 7.3 Consentimientos y datos sensibles

- Cuestionario general de salud actualizable.
- Consentimiento por familia o tipo de tratamiento.
- Nueva confirmación si cambian el tratamiento, protocolo, riesgos o estado de salud.
- Registro de versión, fecha, firmante, alcance y revocación.
- Permisos separados para fotografías privadas y uso promocional.
- El cliente decide el alcance de acceso de los profesionales a su ficha.
- Se admite autorización puntual a un profesional sustituto.

### 7.4 Registro de sesión

El modelo completo podrá registrar:

- Servicio y protocolo.
- Profesional, zona, fecha y duración real.
- Productos, cantidades y lotes.
- Parámetros de aparatología.
- Observaciones y reacciones.
- Fotografías autorizadas.
- Resultados y evolución.
- Recomendaciones posteriores.
- Incidencias y seguimiento.

Cada contenido podrá marcarse como interno o visible para el cliente.

### 7.5 Comunicaciones

Canales previstos:

- Correo electrónico.
- WhatsApp.
- SMS.
- Notificaciones en el área privada.

Las comunicaciones operativas se separarán de las comerciales. No se enviarán promociones sin consentimiento expreso. La ficha reunirá correos, mensajes, fecha y notas de llamadas, cambios de cita, seguimientos y reclamaciones. Las llamadas no se grabarán.

## 8. Inventario, proveedores y productos

- Inicialmente no se venderán productos al público.
- El modelo permitirá añadir venta de productos posteriormente.
- Desde el inicio se controlarán los consumibles utilizados.
- Cada servicio tendrá una plantilla de consumos previstos.
- La profesional podrá corregir las cantidades reales.
- Se controlarán lotes y fechas de caducidad.
- Se conservará la trazabilidad del lote aplicado en cada sesión.
- Se gestionarán proveedores, pedidos, recepciones, costes, facturas, devoluciones e incidencias.

Los equipos de aparatología no tendrán inicialmente estados de disponibilidad, avería ni mantenimiento dentro de la agenda.

## 9. Pagos, facturación y administración

### 9.1 Métodos de pago

- Efectivo.
- Tarjeta.
- Bizum.
- Transferencia.
- Combinaciones de varios métodos.
- Pagos parciales y saldos pendientes.

Para compras en línea se utilizarán tarjeta y Bizum como pagos inmediatos. Las transferencias quedarán pendientes hasta confirmar el ingreso. El efectivo será presencial.

### 9.2 Documentos y caja

- Facturas simplificadas.
- Facturas completas.
- Facturas rectificativas.
- Apertura, cierre y arqueo diario.
- Entradas y salidas de efectivo.
- Registro y justificación de diferencias.

La gestoría tendrá acceso completo al área económica, fiscal, contable y laboral del ERP, pero no a cuestionarios, fotografías, consentimientos ni notas sensibles del CRM.

### 9.3 Empresas

- Se admitirán clientes particulares y empresas.
- Podrán existir beneficiarios o empleados asociados a una empresa.
- La información estética pertenece al beneficiario y no es accesible para la empresa.
- Se permitirá facturación periódica consolidada y pago posterior por transferencia.

## 10. Empleados y permisos

- Futuras incorporaciones serán empleados.
- Se gestionarán agendas, turnos, descansos, vacaciones, bajas y bloqueos.
- Existirán roles de dirección, recepción, profesional, almacén y gestoría.
- Se aplicará el principio de acceso mínimo necesario.
- Existirán comisiones, incentivos y objetivos configurables.
- Solo los importes aprobados pasarán a nómina.
- Se gestionará fichaje, pausas, horas e incidencias de jornada.
- Determinadas devoluciones, descuentos, compensaciones y anulaciones requerirán aprobación de dirección.

## 11. Sistemas y fuentes de verdad

| Dominio | Sistema responsable | Consumidores principales |
|---|---|---|
| Clientes e identidad operativa | EspoCRM | Web, n8n, FacturaScripts |
| Consultas y potenciales clientes | EspoCRM | Web, n8n |
| Citas y estados | EspoCRM | Web, Google Calendar, n8n |
| Tratamientos, consentimientos y datos sensibles | EspoCRM | Área privada autorizada |
| Definición operativa de servicios | EspoCRM | Web, n8n |
| Precio operativo orientativo del catálogo | EspoCRM | Web, n8n; copia provisional |
| Precio definitivo, impuestos y dimensión económica | FacturaScripts | EspoCRM, Web, n8n |
| Pagos, deudas y devoluciones | FacturaScripts | CRM, Web |
| Facturas y documentos fiscales | FacturaScripts | CRM, Web |
| Stock, lotes, compras y proveedores | FacturaScripts | CRM, dirección |
| Contabilidad y gestión laboral | FacturaScripts | Gestoría, dirección |
| Contenido multilingüe | Payload CMS | Web |
| Agenda complementaria | Google Calendar | Profesional |
| Orquestación e integraciones | n8n | Todos los sistemas mediante API |

## 12. Arquitectura técnica validada

```text
                    ┌────────────────────────┐
                    │ Web / Payload CMS      │
                    │ Next.js + React + TS   │
                    └───────────┬────────────┘
                                │
                                ▼
                    ┌────────────────────────┐
                    │ n8n Community Edition  │
                    │ Orquestación interna   │
                    └───┬────────┬────────┬──┘
                        │        │        │
              ┌─────────▼─┐  ┌───▼────┐  ┌▼────────────────┐
              │ EspoCRM   │  │ Google │  │ FacturaScripts  │
              │ CRM       │  │Calendar│  │ ERP             │
              └───────────┘  └────────┘  └─────────────────┘
```

### 12.1 Tecnologías

- Web y futura área privada: **Next.js + React + TypeScript**.
- Gestión de contenidos: **Payload CMS**.
- CRM: **EspoCRM**.
- ERP: **FacturaScripts**.
- Automatización: **n8n Community Edition**.
- Extensiones de EspoCRM: PHP.
- Plugins de FacturaScripts: PHP.
- Componentes web y auxiliares: TypeScript.
- Despliegue: Docker sobre VPS administrado con Plesk.

### 12.2 Condición de uso de n8n

n8n se utilizará únicamente para operaciones internas de Gapssa:

- Los clientes no accederán al editor ni al panel de n8n.
- No se revenderá n8n.
- No se ofrecerá automatización a terceros desde esta instancia.
- Si el entorno se transforma en un producto para franquicias o empresas independientes, se revisará la licencia antes de ampliar el uso.

## 13. Integraciones principales

### 13.1 Google Calendar → EspoCRM

1. n8n detecta un evento creado, modificado o cancelado.
2. Localiza la relación existente o busca al cliente por teléfono cuando proceda.
3. Crea una ficha básica si no existe una coincidencia fiable.
4. Crea o actualiza la cita en EspoCRM.
5. Valida horario, zona y solapamientos.
6. Si existe un conflicto, conserva la situación anterior y solicita revisión.
7. Registra resultado, identificadores y errores.

### 13.2 EspoCRM → Google Calendar

1. EspoCRM comunica el cambio mediante webhook.
2. n8n valida estado y datos permitidos.
3. Crea o actualiza el evento correspondiente.
4. Transfiere únicamente información operativa mínima.
5. Conserva la relación entre cita y evento.
6. Evita que el cambio regrese como una nueva operación.

Google Calendar mostrará nombre, tratamiento, horario, estado, modalidad y una referencia protegida. No contendrá teléfono, cuestionarios, consentimientos, fotografías, notas sensibles ni información fiscal.

Eliminar un evento en Google Calendar no elimina la cita del CRM. Genera una cancelación pendiente de revisión. Una cita completada nunca puede cancelarse mediante la eliminación del evento.

### 13.3 EspoCRM → FacturaScripts

1. Una cita completada origina una operación económica pendiente.
2. Varias citas de una visita pueden agruparse.
3. FacturaScripts registra cobro y emite el documento fiscal.
4. FacturaScripts devuelve número, importe, estado y referencia.
5. Las correcciones generan ajustes o documentos rectificativos; no eliminan el original.

### 13.4 Consumo de stock

1. EspoCRM propone los consumibles asociados al tratamiento.
2. La profesional confirma cantidades y lotes reales.
3. n8n envía el consumo a FacturaScripts.
4. FacturaScripts registra la salida y devuelve confirmación o incidencia.

## 14. Reglas de integración

- Cada registro relacionado debe conservar identificadores externos.
- Cada envío debe tener una clave de idempotencia.
- Se debe registrar el sistema de origen.
- Los reintentos no pueden crear duplicados.
- Una interrupción deja la operación en espera, no la descarta.
- Las operaciones críticas no se comunican como definitivas hasta que responda el sistema responsable.
- Las discrepancias no se corrigen silenciosamente.
- Las eliminaciones se modelan preferentemente como estados o anulaciones con historial.
- Cada cambio sensible debe registrar valor anterior, valor nuevo, fecha, usuario o sistema, canal y motivo.

La conciliación diaria debe detectar, como mínimo:

- Citas completadas sin operación económica.
- Cobros sin factura o con diferencias.
- Consumos de stock pendientes.
- Eventos de Google Calendar sin vínculo con EspoCRM.
- Posibles clientes duplicados.
- Renovaciones cobradas sin beneficios activados.
- Devoluciones sin reflejo operativo.
- Errores de sincronización pendientes.

## 15. Infraestructura

- VPS existente con capacidad validada.
- Plesk disponible.
- Dominio principal: `gapssa.es`.
- Despliegue mediante contenedores Docker.
- Bases de datos aisladas y credenciales independientes.
- Comunicación entre aplicaciones mediante APIs y eventos.
- Red privada de Docker para bases de datos y servicios internos.
- Plesk actuará como proxy inverso y terminación HTTPS.

### 15.1 Subdominios

- `gapssa.es`: web pública.
- `crm.gapssa.es`: EspoCRM.
- `erp.gapssa.es`: FacturaScripts.
- `automatiza.gapssa.es`: n8n.
- `staging.gapssa.es`: pruebas de la web.

Los entornos de prueba de CRM, ERP y n8n deben estar protegidos y no indexados.

### 15.2 Seguridad

- Segundo factor obligatorio para usuarios internos.
- Cuentas personales, nunca compartidas.
- Bloqueo tras intentos fallidos.
- Cierre de sesiones inactivas.
- Auditoría de accesos y cambios sensibles.
- Secretos fuera del repositorio.
- Acceso de n8n limitado a los permisos mínimos en cada API.

### 15.3 Correo

- Cuenta inicial prevista: `reservas@gapssa.es`.
- Se utilizará para citas, avisos y recuperación de acceso.
- Posteriormente podrán añadirse `hola@gapssa.es` y `administracion@gapssa.es`.

### 15.4 Copias de seguridad

- Copias externas, independientes de Plesk y del VPS.
- Copia diaria cifrada.
- Conservación diaria durante 14 días.
- Copias semanales durante 8 semanas.
- Copias mensuales durante 12 meses.
- Pruebas periódicas de restauración.

### 15.5 Entornos y despliegue

- Entorno de pruebas separado de producción.
- Pruebas con datos ficticios o anonimizados.
- Cambios sometidos a pruebas automáticas.
- Despliegue automático a pruebas desde la rama principal.
- Producción requiere aprobación manual.
- Copia recuperable antes de cambios de datos o plataformas.
- Procedimiento de reversión si falla la verificación posterior.

### 15.6 Repositorio

- Repositorio privado en GitHub.
- Monorepositorio modular para Web/CMS, integraciones, módulos de EspoCRM, plugins de FacturaScripts, contratos de datos, infraestructura, pruebas y documentación.

## 16. Primer lanzamiento

Fecha objetivo validada: **lunes 10 de agosto de 2026**.

### 16.1 Alcance incluido

- EspoCRM operativo.
- Una cuenta interna con funciones de propietaria, administradora y profesional.
- Catálogo inicial completo.
- Fichas básicas de clientes.
- Agenda central y estados de cita.
- Dos zonas de atención.
- Inicio y fin introducidos manualmente.
- Una cita por tratamiento.
- Registro mínimo de sesión.
- Estado provisional del consentimiento.
- Sincronización bidireccional con Google Calendar.
- Detección básica de conflictos y duplicados.
- Auditoría esencial.
- Copias y monitorización.
- Google Calendar como respaldo temporal.

### 16.2 Alcance excluido

- Web comercial completa.
- Área privada del cliente.
- Pagos y facturación integrados.
- Inventario operativo completo.
- Consentimientos digitales avanzados.
- Fotografías y documentos avanzados.
- Bonos, packs, membresías y suscripciones.
- Automatizaciones avanzadas de comunicación.

### 16.3 Reglas provisionales

- Las citas importadas desde Google Calendar se sincronizan desde el 10 de agosto de 2026.
- No se importa el historial anterior.
- Los eventos existentes crean fichas básicas con nombre y teléfono.
- Las citas importadas usan “Tratamiento pendiente de asignar”.
- Apellidos y correo son opcionales durante la transición.
- Las duraciones se introducen manualmente.
- El consentimiento se registra como pendiente, firmado o no aplicable; el documento continúa temporalmente mediante el procedimiento actual.

### 16.4 Registro mínimo al completar una cita

- Tratamiento realizado.
- Hora real de inicio y fin.
- Observaciones.
- Reacción o incidencia.
- Recomendaciones.
- Próxima cita sugerida.
- Indicador de documentos o consentimientos pendientes.

## 17. Pruebas de aceptación del primer lanzamiento

Las pruebas de usuario están previstas para el 8 y 9 de agosto de 2026.

Casos mínimos:

1. Crear un cliente.
2. Crear y aprobar una cita.
3. Modificarla desde EspoCRM.
4. Modificarla desde Google Calendar.
5. Detectar y gestionar un conflicto.
6. Solicitar una cancelación desde Google Calendar sin perder historial.
7. Completar una cita y registrar notas.
8. Detectar un posible duplicado.
9. Simular una interrupción y conciliar al restablecer.
10. Verificar que Google Calendar no contiene datos sensibles.

## 18. Roadmap posterior

### Hito 2 — Ficha avanzada

- Cuestionarios digitales.
- Consentimientos versionados.
- Autorizaciones de menores.
- Fotografías y permisos.
- Planes de tratamiento.
- Incidencias y reacciones adversas.
- Visibilidad selectiva para el cliente.

### Hito 3 — Web y reservas

- Web administrable en seis idiomas.
- Reserva como invitado o usuario registrado.
- Valoraciones presenciales y remotas.
- Lista de espera.
- Servicios a domicilio.
- Recordatorios multicanal.
- Confirmación automática configurable.
- Captación y seguimiento de consultas.

### Hito 4 — Venta y fiscalidad

- Precios, suplementos y promociones.
- Pagos presenciales y en línea.
- Pagos combinados y pendientes.
- Facturación y rectificaciones.
- Caja y arqueo.
- Conciliación económica.
- Validación con la gestoría y normativa española vigente.

### Hito 5 — Inventario y compras

- Productos y consumibles.
- Plantillas de consumo.
- Lotes y caducidades.
- Proveedores y pedidos.
- Costes y rentabilidad.

### Hito 6 — Bonos y fidelización

- Bonos y packs.
- Membresías y suscripciones.
- Tarjetas regalo.
- Puntos, niveles y referidos.
- Promociones y campañas.

### Hito 7 — Equipo

- Nuevos empleados.
- Roles, agendas y permisos.
- Registro de jornada.
- Comisiones e incentivos.
- Nóminas y coordinación con gestoría.

### Hito 8 — Optimización

- Informes combinados.
- Rentabilidad por servicio y canal.
- Automatizaciones avanzadas.
- Revisión de rendimiento, seguridad y continuidad.

## 19. Decisiones pendientes

Estas decisiones están deliberadamente aplazadas y no deben inventarse durante la implementación:

- Duración predeterminada de cada servicio.
- Precios base y suplementos.
- Bonos, packs, membresías y condiciones concretas.
- Política de cancelación, retrasos y ausencias.
- Reglas de señales y prepagos futuras.
- Matriz método de depilación × zona.
- Servicios que requieren valoración, cuestionario, prueba o consentimiento específico.
- Vigencia concreta de consentimientos.
- Zonas de cobertura a domicilio y suplementos.
- Horario habitual del centro.
- Pedido mínimo para desplazamientos.
- Reglas concretas de fidelización y promociones.
- Plazos y condiciones de facturación empresarial.
- Destino externo definitivo de copias de seguridad.

## 20. Criterio para cambios futuros

Antes de implementar una función nueva se debe responder:

1. ¿Qué proceso de negocio resuelve?
2. ¿Qué sistema es propietario del dato?
3. ¿Qué otros sistemas necesitan una copia o referencia?
4. ¿Contiene información sensible, fiscal o laboral?
5. ¿Qué sucede si la integración falla?
6. ¿Cómo se evita duplicar la operación?
7. ¿Qué debe quedar auditado?
8. ¿Cómo se prueba y se revierte?

Una decisión técnica que contradiga este documento requiere validación explícita y actualización previa del contexto maestro.
