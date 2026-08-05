# Plan de desarrollo — Web, reservas y portal de clientes de Gapssa

> Documento de implementación preparado para Claude Code.
>
> Fecha de planificación: 5 de agosto de 2026.
> Objetivo de la primera versión operativa local: 1 de septiembre de 2026.
>
> Antes de implementar, leer íntegramente `PROJECT_CONTEXT.md`, este documento y cualquier `AGENTS.md` aplicable al directorio que se vaya a modificar.

## 1. Objetivo

Construir una aplicación unificada para **GAPSSA by Nana** que incluya:

1. Web pública multilingüe.
2. Catálogo de tratamientos.
3. Reservas online como invitado o cliente registrado.
4. Portal privado del cliente en `/mi-cuenta`.
5. Integración segura con EspoCRM, Payload CMS y n8n.
6. Preparación para integrar FacturaScripts posteriormente.

La V1 se desarrollará y validará completamente en local. Solo cuando el propietario del proyecto la apruebe se desplegará en el VPS con Plesk.

## 2. Reglas de trabajo obligatorias

- No inventar reglas de negocio que no estén en `PROJECT_CONTEXT.md` o en este documento.
- Ante una contradicción entre ambos documentos, detener la implementación afectada y solicitar confirmación.
- Mantener EspoCRM como fuente de verdad de clientes, profesionales, tratamientos, disponibilidad, citas, cuestionarios y consentimientos.
- Mantener Payload CMS como fuente de verdad del contenido editorial y multilingüe.
- Mantener FacturaScripts como futura fuente de verdad de precios, impuestos, pagos y facturas.
- No escribir directamente en bases de datos de otros sistemas.
- Integrar sistemas mediante APIs, eventos o trabajos asíncronos idempotentes.
- El navegador nunca debe acceder directamente a EspoCRM, n8n o FacturaScripts.
- Next.js debe proporcionar una capa backend/BFF que autentique, autorice y valide las operaciones.
- No exponer secretos al navegador ni guardarlos en el repositorio.
- No introducir datos reales en desarrollo o pruebas.
- No modificar ni eliminar cambios ajenos existentes en el repositorio.
- Implementar por módulos y evitar personalizaciones dentro del núcleo de EspoCRM, Payload o FacturaScripts.
- Documentar las decisiones técnicas relevantes y los procedimientos de instalación, actualización y reversión.

## 3. Alcance de la V1 del 1 de septiembre

La V1 es una versión operativa controlada, no el producto final.

### 3.1 Incluido

- Web pública responsive.
- Identidad visual basada en `gapssa1`.
- Seis idiomas desde el lanzamiento:
  - Español, idioma principal.
  - Catalán.
  - Inglés.
  - Italiano.
  - Francés.
  - Portugués.
- Traducción inicial asistida, sin flujo de revisión editorial obligatorio.
- Navegación y páginas públicas administrables.
- Catálogo por familias y páginas individuales de tratamientos.
- SEO local, metadatos multilingües y datos estructurados.
- Cuenta de cliente con correo y contraseña.
- Acceso alternativo mediante enlace o código temporal enviado por correo.
- Reserva como invitado.
- Verificación del invitado por correo.
- Portal privado en `gapssa.es/mi-cuenta`.
- Consulta y gestión básica de citas.
- Selección de tratamiento, profesional, fecha y hora.
- Aprobación manual de todas las solicitudes por Gapssa.
- Cuestionarios configurables desde EspoCRM.
- Consentimientos versionados.
- Firma dibujada y confirmación mediante código por correo.
- Correos operativos mediante el SMTP de `gapssa.es` y remitente inicial `reservas@gapssa.es`.
- Formularios accesibles y objetivo WCAG 2.2 AA.
- Analítica básica con Umami, sin registrar información personal o sensible.
- Pruebas automáticas y pruebas funcionales completas.
- Documentación operativa y técnica.

### 3.2 Preparado arquitectónicamente, pero activado después de la V1

- Fotografías y evolución del tratamiento.
- Cuentas independientes de menores vinculadas a tutores.
- Independización confirmada por el joven al alcanzar la mayoría de edad.
- Lista de espera.
- WhatsApp Business Platform.
- Promociones por correo y WhatsApp con consentimiento expreso.
- Permisos granulares de acceso por profesional.
- Exportación de datos del cliente.
- Servicios a domicilio y ubicaciones externas.
- Valoraciones por videollamada.
- SMS.
- PWA instalable.
- Pagos, facturas, bonos, packs, membresías y suscripciones.

Estas funciones no deben aparecer como secciones vacías en la V1. Deben permanecer ocultas mediante configuración o feature flags hasta estar completas.

## 4. Arquitectura objetivo

```text
Cliente
   |
   v
Next.js: web pública + reservas + portal
   |
   v
API/BFF privada de Next.js
   |------------> Payload CMS: contenido y traducciones
   |------------> EspoCRM: clientes, catálogo operativo y citas
   |------------> PostgreSQL: autenticación, sesiones y datos auxiliares
   |------------> Redis: códigos, bloqueos, límites y colas
   |------------> n8n: automatizaciones y comunicaciones
   `-. futuro .-> FacturaScripts: precios, pagos y facturación

EspoCRM <-------> Google Calendar, como agenda complementaria
```

### 4.1 Tecnologías base

- Next.js, React y TypeScript.
- Payload CMS.
- PostgreSQL, con separación lógica de CMS, autenticación y datos auxiliares.
- Redis para estados temporales y colas.
- EspoCRM para el dominio operativo.
- n8n Community Edition para automatización interna.
- Umami autoalojado para analítica.
- Docker Compose para desarrollo local y despliegue posterior.

Antes de seleccionar versiones o librerías, comprobar compatibilidad actual entre Next.js, Payload y los adaptadores de base de datos. No asumir APIs antiguas.

### 4.2 Propiedad de los datos

| Dominio | Propietario |
|---|---|
| Identidad operativa y ficha del cliente | EspoCRM |
| Credenciales, sesiones y verificación de acceso | Aplicación web |
| Tratamientos y capacidad profesional | EspoCRM |
| Citas, estados y disponibilidad | EspoCRM |
| Cuestionarios y consentimientos | EspoCRM |
| Contenido editorial y traducciones | Payload CMS |
| Precios, impuestos y pagos | FacturaScripts, fase posterior |
| Bloqueos y códigos temporales | Redis |
| Automatizaciones y notificaciones | n8n |

La base web debe guardar únicamente los datos necesarios para autenticación, seguridad y vinculación con el identificador de EspoCRM. No debe duplicar la ficha completa del cliente.

## 5. Identidad visual y contenido

Usar `gapssa1` como referencia, no como implementación final ni como código que deba copiarse literalmente.

### 5.1 Dirección visual inicial

- Nombre visible: **GAPSSA by Nana**.
- Colores principales: crema, dorado y marrón oscuro.
- Tipografías de referencia: Cormorant Garamond y Jost.
- Sensación: elegante, cálida, profesional y cercana.
- Diseño mobile-first y completamente responsive.
- Respetar `prefers-reduced-motion`.
- Mantener contraste, foco visible y navegación por teclado.

### 5.2 Estructura pública prevista

- Inicio.
- Sobre Gapssa/Diana.
- Familias de servicios.
- Página individual por tratamiento.
- Proceso de atención.
- Motivos para elegir Gapssa.
- Testimonios anonimizados.
- Galería.
- Selección manual de publicaciones de Instagram desde Payload.
- Contacto y consulta.
- Reserva.
- Acceso a `Mi cuenta`.
- Textos legales provisionales.

Las imágenes incluidas en `gapssa1` pueden emplearse inicialmente después de verificar su licencia. Deben ser sustituibles desde Payload.

### 5.3 Ficha individual de tratamiento

Preparar campos para:

- Nombre.
- Familia.
- Descripción comercial.
- Beneficios.
- Duración.
- Precio o indicación pendiente.
- Profesionales habilitadas.
- Requisitos previos.
- Contraindicaciones generales.
- Preguntas frecuentes.
- Imágenes.
- SEO.
- Estado publicable.
- Botón de reserva.

La descripción y el SEO pertenecen a Payload. La duración, habilitación profesional y definición operativa pertenecen a EspoCRM. El precio pertenecerá a FacturaScripts.

## 6. Autenticación y vinculación con EspoCRM

### 6.1 Métodos de acceso

- Correo y contraseña.
- Enlace o código temporal por correo, sin contraseña.
- Recuperación segura de acceso.
- Verificación adicional por correo para acciones sensibles.

### 6.2 Reglas

- Cerrar la sesión después de 30 minutos de inactividad.
- Rotar y revocar sesiones de forma segura.
- Guardar contraseñas con un algoritmo moderno y parámetros seguros.
- Aplicar límites de intentos por IP, cuenta y operación.
- No revelar si una dirección existe durante recuperación o acceso.
- Registrar auditoría de inicios de sesión y acciones sensibles.
- Preparar la estructura para segundo factor futuro.

### 6.3 Vinculación de identidad

- EspoCRM es propietario de la ficha del cliente.
- Una cuenta web nueva debe vincularse a un identificador de contacto de EspoCRM.
- Si el correo verificado coincide con una ficha existente, no mostrar automáticamente información histórica.
- Crear una solicitud de vinculación para revisión manual por Gapssa.
- Las coincidencias dudosas nunca se fusionan automáticamente.
- Hasta aprobar la vinculación, la cuenta puede operar como nueva, pero no debe acceder a citas, fotografías, documentos o datos históricos de la ficha candidata.

## 7. Disponibilidad y reservas

### 7.1 Fuente de disponibilidad

- EspoCRM es la agenda central y fuente de verdad.
- Google Calendar es complementario.
- La web nunca debe decidir disponibilidad usando únicamente Google Calendar.
- Citas, descansos, vacaciones, bloqueos y eventos importados a EspoCRM deben impedir ofrecer el horario.
- No se necesita margen extra entre citas: la duración del tratamiento ya debe incluir preparación y transición.

### 7.2 Horario y ventana de reserva

- Horario inicial configurable: lunes a sábado, de 09:00 a 21:00.
- Domingo cerrado.
- Antelación mínima: 2 horas.
- Antelación máxima: 60 días.
- Solo atención presencial en el centro en la V1.
- Dirección pública: Carrer de Gayarre 24, 08014 Barcelona.

### 7.3 Selección

El flujo debe permitir seleccionar:

1. Tratamiento.
2. Profesional.
3. Fecha.
4. Horario disponible.

Mostrar únicamente profesionales habilitadas para el tratamiento. La relación tratamiento-profesional debe ser configurable desde EspoCRM.

### 7.4 Reserva como invitado

Campos obligatorios:

- Nombre.
- Apellidos.
- Teléfono.
- Correo electrónico.

Reglas:

- Enviar enlace o código de verificación por correo.
- Retener provisionalmente el horario durante 10 minutos mientras se verifica.
- Si no se verifica, liberar el horario automáticamente.
- Tras verificar, crear la solicitud formal y comenzar el bloqueo de 5 horas.

### 7.5 Solicitud y aprobación

- Todas las reservas requieren aprobación manual de Gapssa.
- Una solicitud verificada bloquea el horario durante un máximo de 5 horas.
- Gapssa aprueba o rechaza desde EspoCRM.
- Al rechazar, liberar inmediatamente el horario.
- Si no hay respuesta en 5 horas, caducar la solicitud, liberar el horario y notificar al cliente.
- Máximo de dos solicitudes pendientes simultáneas por cliente o correo.
- Implementar las transiciones con control de concurrencia para impedir reservas dobles.
- Todas las transiciones deben ser idempotentes y auditables.

### 7.6 Cancelación

- Con 24 horas o más de antelación: cancelación inmediata desde el portal.
- Con menos de 24 horas: crear una solicitud pendiente para Gapssa.
- Inicialmente no existen penalizaciones.
- Conservar historial, canal, fecha y motivo.

### 7.7 Reprogramación

- Mantener la cita original confirmada mientras se revisa el cambio.
- Bloquear el nuevo horario durante un máximo de 5 horas.
- Mostrar un mensaje previo que explique que la cita original se conserva.
- Si Gapssa aprueba, sustituir la fecha de forma transaccional.
- Si rechaza o caduca, liberar el nuevo horario y conservar la cita original.

## 8. Portal privado

### 8.1 V1

- Resumen de próximas citas.
- Historial básico autorizado.
- Detalle y estado de solicitudes.
- Cancelación y reprogramación según las reglas anteriores.
- Cuestionarios pendientes y completados.
- Consentimientos pendientes y firmados.
- Perfil y preferencias básicas.
- Solicitud de eliminación de cuenta.

### 8.2 Fases posteriores

- Fotografías y documentos marcados individual y explícitamente como visibles por la profesional.
- Descarga de todo archivo visible.
- Evolución y recomendaciones visibles.
- Menores y tutores.
- Lista de espera.
- Solicitud revisada de exportación de datos.
- Gestión granular de acceso profesional.
- Secciones económicas cuando FacturaScripts esté integrado.

No mostrar navegación ni placeholders de pagos, facturas, bonos o suscripciones hasta que la integración económica esté terminada.

## 9. Cuestionarios y consentimientos

### 9.1 Configuración

EspoCRM debe permitir crear o modificar sin programar:

- Formularios.
- Preguntas.
- Tipos de respuesta.
- Reglas de obligatoriedad.
- Tratamientos asociados.
- Requisitos de autorización del tutor.
- Versiones.
- Fecha de vigencia.
- Estado activo o retirado.

### 9.2 Consentimiento

- Firma dibujada en pantalla.
- Código de verificación enviado por correo.
- Conservar versión exacta del texto aceptado.
- Conservar firmante, fecha, hora, IP, agente de usuario y evidencia de verificación según lo permitido legalmente.
- Registrar revocación sin borrar el consentimiento histórico.
- Separar autorización de fotografías privadas y uso promocional.

### 9.3 Reglas de cita

- Un cliente puede solicitar cita aunque falten cuestionarios o consentimientos.
- Los pendientes deben aparecer claramente en el portal y en EspoCRM.
- Pueden completarse desde el móvil del cliente antes de la cita o presencialmente en el centro.
- No permitir iniciar el tratamiento si sigue pendiente un requisito obligatorio.

Los textos legales y de consentimiento iniciales serán genéricos y provisionales. No deben presentar como definitivas condiciones específicas de aparatología. Deben quedar claramente identificados para revisión posterior.

## 10. Menores, fase posterior

Diseñar el modelo desde el inicio, aunque no se active en la V1:

- El menor tendrá una cuenta independiente vinculada al tutor.
- El tutor no aprueba todas las citas.
- La necesidad de autorización se configura por tratamiento y consentimiento.
- Al alcanzar la mayoría de edad, el joven puede solicitar la independencia.
- La desvinculación no es automática: requiere confirmación del joven e identidad verificada.
- Registrar todas las vinculaciones, autorizaciones y desvinculaciones.

## 11. Fotografías y documentos, fase posterior

- En la primera etapa se almacenarán en el VPS.
- Usar un volumen privado fuera del directorio público.
- No servir archivos por URL permanente o predecible.
- Comprobar autenticación, autorización y visibilidad en cada descarga.
- Emitir accesos temporales.
- El contenido será interno por defecto.
- La profesional debe marcar individual y explícitamente cada fotografía, nota, resultado o recomendación visible.
- Si un archivo es visible, el cliente podrá visualizarlo y descargarlo.
- El cliente no subirá archivos en la V1.

## 12. Lista de espera, fase posterior

- El cliente indica tratamiento, profesional y franjas aceptables.
- Prioridad estrictamente cronológica entre solicitudes compatibles.
- Al liberarse un hueco, ofrecerlo durante 30 minutos a la primera persona compatible.
- Si no lo acepta, ofrecerlo a la siguiente.
- Aceptar el hueco no confirma automáticamente la cita.
- Debe crear una solicitud que requiere aprobación de Gapssa.

## 13. Comunicaciones

### 13.1 Correo en V1

- Usar SMTP de `gapssa.es`.
- Remitente inicial: `reservas@gapssa.es`.
- Plantillas multilingües.
- No incluir información sensible en el cuerpo del correo.
- Enlazar al portal para consultar detalles protegidos.

Eventos mínimos:

- Verificación de correo.
- Acceso sin contraseña.
- Solicitud recibida.
- Solicitud aprobada.
- Solicitud rechazada.
- Solicitud caducada.
- Cambio solicitado.
- Cambio aprobado o rechazado.
- Cancelación.
- Consentimiento pendiente.
- Código de firma.
- Recordatorio 24 horas antes.
- Recordatorio 2 horas antes.

### 13.2 Avisos internos

Las nuevas solicitudes deberán avisar a Gapssa por:

- Notificación en EspoCRM.
- Correo.
- WhatsApp cuando la integración esté activa.

### 13.3 WhatsApp, fase posterior inmediata

- Configurar WhatsApp Business Platform oficial de Meta.
- Integrar webhooks y plantillas mediante n8n.
- Separar comunicaciones operativas y comerciales.
- Las campañas solo se envían con consentimiento expreso, independiente y revocable.
- Preparar reintentos, idempotencia, estados de entrega y tratamiento de errores.

### 13.4 Preferencias

- El cliente puede aceptar o retirar por separado correo comercial y WhatsApp comercial.
- Los mensajes operativos esenciales de citas y seguridad permanecen activos mientras utilice el servicio.

## 14. Consulta general

Incluir un formulario público que:

- Solicite nombre, correo, teléfono, mensaje y consentimientos necesarios.
- Permita elegir respuesta por correo, llamada o WhatsApp.
- Permita indicar una franja preferida de contacto.
- Cree una consulta en EspoCRM.
- Evite duplicados mediante clave de idempotencia.
- Avise internamente por CRM y correo; WhatsApp se añadirá al activar la integración.

## 15. Privacidad y seguridad

- Aplicar privacidad por defecto y mínimo privilegio.
- En la V1, solo administración y la profesional asignada acceden a información sensible.
- No enviar datos sensibles a Umami, Google Calendar, correo o WhatsApp.
- No registrar cuerpos de cuestionarios, firmas, tokens o contraseñas en logs.
- Proteger formularios con límites de frecuencia y controles antiabuso.
- Usar cookies seguras, `HttpOnly`, `SameSite` apropiado y protección CSRF.
- Implementar cabeceras de seguridad y una CSP compatible con los servicios realmente utilizados.
- Validar archivos y entradas en servidor.
- Registrar cambios sensibles con valor anterior, nuevo valor, actor, canal, fecha y motivo cuando corresponda.
- Cifrar comunicaciones y datos sensibles según el diseño aprobado.
- Preparar procedimientos de rotación de secretos.

### 15.1 Eliminación y exportación

- Una solicitud de eliminación bloquea inmediatamente el acceso.
- Gapssa revisa qué información debe conservarse legalmente.
- Eliminar o anonimizar lo permitido y conservar únicamente lo obligatorio.
- La exportación automática no entra en la V1.
- Posteriormente, el cliente podrá solicitarla y Gapssa verificará manualmente la identidad antes de entregarla.

## 16. SEO, analítica y terceros

- SEO técnico multilingüe con `hreflang` y canonical correctos.
- Metadatos y Open Graph administrables.
- Datos estructurados adecuados para negocio local y servicios.
- Sitemap e indexación controlada.
- No indexar portal, autenticación, staging ni rutas privadas.
- Umami autoalojado, sin datos personales ni eventos sensibles.
- Publicaciones de Instagram seleccionadas manualmente desde Payload.
- Mostrar ubicación mediante imagen o mapa estático.
- Abrir Google Maps solo tras una acción explícita.
- Preparar textos y consentimiento de cookies conforme a los servicios finalmente activados.

## 17. Estrategia de implementación

### Fase 0 — Descubrimiento técnico y contratos

1. Auditar el repositorio y los cambios locales existentes.
2. Revisar el modelo real de EspoCRM y sus APIs.
3. Definir contratos de datos y estados.
4. Crear diagramas de secuencia de reserva, cancelación, reprogramación y firma.
5. Definir estrategia de errores, idempotencia y conciliación.
6. Elaborar migraciones y plan de reversión.

Entregable: documento técnico aprobado antes de implementar integraciones críticas.

### Fase 1 — Base de plataforma

1. Crear la aplicación Next.js en un módulo claro del monorepositorio.
2. Incorporar Payload CMS.
3. Añadir PostgreSQL y Redis al entorno local.
4. Implementar configuración validada y secretos por entorno.
5. Preparar Docker y comprobaciones de salud.
6. Añadir estructura de pruebas, lint y type-check.

### Fase 2 — Web pública y contenido

1. Crear sistema de diseño a partir de `gapssa1`.
2. Implementar layout, navegación, footer y selector de idioma.
3. Modelar páginas, tratamientos, testimonios, galería y SEO en Payload.
4. Construir páginas públicas y catálogo.
5. Implementar responsive y WCAG 2.2 AA.
6. Añadir Umami y exclusiones de privacidad.

### Fase 3 — Autenticación y portal base

1. Implementar correo y contraseña.
2. Implementar acceso por enlace o código.
3. Configurar SMTP.
4. Implementar sesiones de 30 minutos de inactividad.
5. Implementar verificación reforzada.
6. Implementar vinculación controlada con EspoCRM.
7. Crear estructura inicial de `/mi-cuenta`.

### Fase 4 — Reservas

1. Exponer catálogo operativo desde EspoCRM mediante la API privada.
2. Calcular disponibilidad en EspoCRM.
3. Implementar selección de profesional habilitada.
4. Implementar retención de invitado de 10 minutos.
5. Implementar bloqueo formal de 5 horas.
6. Implementar aprobación, rechazo y caducidad.
7. Implementar límite de dos solicitudes.
8. Implementar cancelación y reprogramación.
9. Implementar auditoría y conciliación.

### Fase 5 — Cuestionarios y consentimientos

1. Diseñar entidades versionadas en EspoCRM.
2. Construir formularios dinámicos accesibles.
3. Implementar firma dibujada.
4. Implementar verificación por correo.
5. Guardar evidencias y estados.
6. Mostrar pendientes en portal y CRM.

### Fase 6 — Calidad y validación

1. Ejecutar pruebas unitarias.
2. Ejecutar pruebas de integración.
3. Ejecutar pruebas end-to-end.
4. Verificar concurrencia en reservas.
5. Verificar accesibilidad.
6. Verificar responsive en móviles y escritorio.
7. Verificar los seis idiomas.
8. Revisar seguridad, privacidad y logs.
9. Probar backup, restauración y reversión.
10. Obtener aprobación funcional del propietario.

### Fase 7 — Producción

1. Preparar VPS y Plesk.
2. Configurar dominios, HTTPS, proxy inverso y redes privadas.
3. Crear bases y secretos de producción.
4. Desplegar sin datos ficticios.
5. Conectar exclusivamente con el EspoCRM real.
6. Ejecutar migraciones y pruebas de humo.
7. Habilitar monitorización y copias.
8. Documentar y comprobar la reversión.

## 18. Calendario orientativo

| Periodo | Objetivo |
|---|---|
| 5–9 de agosto | Arquitectura, contratos y base del entorno |
| 10–16 de agosto | Web pública, Payload, idiomas, catálogo y SEO |
| 17–23 de agosto | Autenticación, portal y reservas |
| 24–27 de agosto | Cuestionarios, consentimientos y seguridad |
| 28–30 de agosto | Pruebas, accesibilidad y correcciones |
| 31 de agosto | Validación local y paquete de despliegue |
| 1 de septiembre | V1 local operativa controlada |

El calendario es exigente. Priorizar los flujos críticos de la V1 y no adelantar funciones posteriores si pone en riesgo autenticación, reservas, privacidad o consentimientos.

## 19. Pruebas de aceptación mínimas

1. Navegar la web en los seis idiomas.
2. Consultar categorías y tratamientos.
3. Registrarse con correo y contraseña.
4. Entrar mediante código o enlace por correo.
5. Verificar cierre por inactividad.
6. Reservar como invitado y verificar el correo.
7. Liberar una retención no verificada después de 10 minutos.
8. Crear una solicitud verificada con bloqueo de 5 horas.
9. Aprobarla desde EspoCRM.
10. Rechazarla y liberar el horario.
11. Dejarla caducar y notificar al cliente.
12. Impedir más de dos solicitudes pendientes.
13. Impedir una doble reserva concurrente.
14. Cancelar con más de 24 horas.
15. Solicitar cancelación con menos de 24 horas.
16. Solicitar reprogramación conservando la cita original.
17. Mantener la cita original si la reprogramación caduca.
18. Completar un cuestionario.
19. Firmar un consentimiento con código por correo.
20. Conservar la versión exacta del consentimiento.
21. Impedir iniciar un tratamiento con requisito obligatorio pendiente.
22. Crear una consulta general en EspoCRM.
23. Comprobar que correo y analítica no contienen datos sensibles.
24. Comprobar que ninguna ruta privada es indexable.
25. Validar navegación por teclado, contraste y lector de pantalla.
26. Confirmar que los datos ficticios no se migran a producción.

## 20. Definición de terminado

Una función no está terminada hasta que:

- Cumple las reglas funcionales documentadas.
- Tiene autorización y validación de servidor.
- Es idempotente cuando integra sistemas.
- Gestiona errores y reintentos sin duplicar operaciones.
- Registra auditoría suficiente.
- Tiene pruebas proporcionales al riesgo.
- Es usable en móvil y accesible.
- Funciona en los seis idiomas cuando es visible al público.
- No filtra información sensible en logs, analítica o notificaciones.
- Está documentada.
- Tiene una forma conocida de reversión.

## 21. Decisiones pendientes que no deben inventarse

- Duraciones definitivas de los tratamientos.
- Precios, impuestos y suplementos.
- Teléfono y WhatsApp públicos.
- Cuenta de Instagram definitiva.
- Credenciales SMTP.
- Alta y aprobación de WhatsApp Business Platform.
- Textos legales definitivos.
- Condiciones específicas de tratamientos con aparatología.
- Vigencia concreta de cada consentimiento.
- Destino externo definitivo de las copias de seguridad.
- Reglas económicas, pagos, bonos, packs y suscripciones.
- Políticas futuras de penalización.

Preparar estos valores como configuración o datos administrables. No bloquear la estructura técnica con constantes de negocio provisionales.

## 22. Documentación obligatoria

Entregar y mantener:

- Arquitectura y diagramas.
- Instalación local.
- Variables de entorno y gestión de secretos.
- Modelos y contratos de datos.
- Configuración de Payload y EspoCRM.
- Estados y transiciones de reserva.
- Operación diaria para administración de Gapssa.
- Gestión de errores y conciliación.
- Ejecución de pruebas.
- Despliegue en VPS/Plesk.
- Copias y restauración.
- Actualización y migraciones.
- Reversión.
- Roadmap de funciones posteriores.

## 23. Instrucción inicial para Claude Code

No comenzar escribiendo toda la aplicación. Primero:

1. Leer `PROJECT_CONTEXT.md` y este documento.
2. Inspeccionar el repositorio, incluidos cambios no confirmados, sin modificarlos.
3. Revisar `gapssa1` como referencia visual.
4. Identificar el estado real de EspoCRM y sus entidades.
5. Proponer la estructura concreta del monorepositorio y los contratos API.
6. Señalar cualquier contradicción o bloqueo real.
7. Elaborar un plan de implementación incremental con tareas verificables.
8. Empezar la implementación solo después de validar que la propuesta respeta las fuentes de verdad, la privacidad y el alcance de la V1.
