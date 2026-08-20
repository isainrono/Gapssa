# Portal web, reservas y autenticación — plan de la V1

**Todo este archivo describe un plan, no código existente.** Fuente:
`/PLAN_DESARROLLO_WEB_PORTAL.md` (5 de agosto de 2026). Verificado el
5/8/2026: `apps/web`, `apps/cms`, `packages/contracts`, `integrations/n8n` e
`infra/docker` solo contienen `.gitkeep` — ver
[[02-arquitectura-e-integraciones]] §1. Marca todo lo de este archivo como
**[DOC]** (plan validado) salvo que se indique **[ND]** (decisión aplazada).
Objetivo de V1 operativa local: **1 de septiembre de 2026**. Despliegue a
VPS/Plesk solo tras aprobación explícita del propietario del proyecto.

## 0. Reglas de trabajo obligatorias antes de tocar este plan

- No inventar reglas de negocio que no estén en `PROJECT_CONTEXT.md` o en
  `PLAN_DESARROLLO_WEB_PORTAL.md`.
- Ante contradicción entre ambos documentos: **detener** la implementación
  afectada y pedir confirmación.
- No escribir directamente en bases de datos de otros sistemas.
- El navegador nunca accede directamente a EspoCRM, n8n o FacturaScripts.
- No exponer secretos al navegador ni guardarlos en el repositorio.
- No introducir datos reales en desarrollo o pruebas.
- No modificar ni eliminar cambios ajenos existentes en el repositorio.
- Personalizaciones como módulos separados del núcleo de EspoCRM/Payload/
  FacturaScripts, nunca dentro del núcleo.

## 1. Alcance de la V1 (1 de septiembre) [DOC]

### Incluido
Web pública responsive; identidad visual basada en `gapssa1` (ver §2); 6
idiomas desde el lanzamiento (español principal, catalán, inglés, italiano,
francés, portugués) con traducción inicial asistida sin revisión editorial
obligatoria; navegación/páginas públicas administrables; catálogo por
familias y ficha individual de tratamiento; SEO local y datos estructurados;
cuenta con correo/contraseña; acceso sin contraseña por enlace/código;
reserva como invitado con verificación por correo; portal privado en
`gapssa.es/mi-cuenta`; gestión básica de citas; aprobación manual de toda
solicitud; cuestionarios configurables desde EspoCRM; consentimientos
versionados con firma dibujada + código por correo; correo operativo vía SMTP
de `gapssa.es`, remitente `reservas@gapssa.es`; formularios accesibles, WCAG
2.2 AA; analítica básica con Umami sin datos personales/sensibles; pruebas
automáticas y funcionales; documentación operativa y técnica.

### Preparado arquitectónicamente pero desactivado tras la V1
Fotos/evolución del tratamiento; cuentas de menores vinculadas a tutores;
lista de espera; WhatsApp Business Platform; promociones por correo/WhatsApp;
permisos granulares por profesional; exportación de datos del cliente;
servicios a domicilio; valoraciones por videollamada; SMS; PWA instalable;
pagos/facturas/bonos/packs/membresías/suscripciones.

**Regla explícita**: estas funciones no deben aparecer como secciones vacías
en la V1 — ocultarlas mediante configuración o feature flags hasta estar
completas, nunca placeholders visibles.

## 2. Identidad visual [DOC]

`gapssa1` es **referencia visual**, no implementación final ni código para
copiar literalmente. Nombre visible: **GAPSSA by Nana**. Colores: crema,
dorado, marrón oscuro. Tipografías de referencia: Cormorant Garamond y Jost.
Sensación buscada: elegante, cálida, profesional, cercana. Mobile-first,
responsive, respeta `prefers-reduced-motion`, contraste y foco visibles,
navegación por teclado. Las imágenes de `gapssa1` pueden usarse tras verificar
licencia, y deben ser sustituibles desde Payload.

Estructura pública prevista: inicio, sobre Gapssa/Diana, familias de
servicios, ficha de tratamiento, proceso de atención, motivos para elegir
Gapssa, testimonios anonimizados, galería, selección manual de Instagram
desde Payload, contacto/consulta, reserva, acceso a "Mi cuenta", legales
provisionales.

Ficha individual de tratamiento (campos a preparar): nombre, familia,
descripción comercial, beneficios, duración, precio o "pendiente",
profesionales habilitadas, requisitos previos, contraindicaciones generales,
FAQ, imágenes, SEO, estado publicable, botón de reserva. Reparto de
propiedad: descripción/SEO → Payload; duración/habilitación
profesional/definición operativa → EspoCRM; precio → FacturaScripts (futuro).

## 3. Autenticación y vinculación con EspoCRM [DOC]

### Métodos de acceso
Correo+contraseña; enlace o código temporal por correo sin contraseña;
recuperación segura; verificación adicional por correo para acciones
sensibles.

### Reglas
- Cerrar sesión tras **30 minutos** de inactividad.
- Rotar y revocar sesiones de forma segura.
- Contraseñas con algoritmo moderno y parámetros seguros.
- Límites de intentos por IP, cuenta y operación.
- No revelar si una dirección existe durante recuperación o acceso.
- Auditoría de inicios de sesión y acciones sensibles.
- Preparar estructura para 2FA futuro.

### Vinculación de identidad
EspoCRM es propietario de la ficha del cliente. Una cuenta web nueva debe
vincularse a un `Contact` de EspoCRM. Si el correo verificado coincide con
una ficha existente, **no mostrar automáticamente** información histórica:
crear una solicitud de vinculación para revisión manual de Gapssa. Las
coincidencias dudosas **nunca** se fusionan automáticamente. Hasta aprobar la
vinculación, la cuenta opera como nueva pero sin acceso a citas, fotos,
documentos o histórico de la ficha candidata.

## 4. Disponibilidad y reservas [DOC] — reglas exactas, no las reinventes

### Fuente de disponibilidad
EspoCRM es la agenda central y fuente de verdad; Google Calendar es
complementario. **La web nunca decide disponibilidad usando solo Google
Calendar.** Citas, descansos, vacaciones, bloqueos y eventos importados a
EspoCRM deben impedir ofrecer ese horario. Sin margen extra entre citas: la
duración del tratamiento ya incluye preparación y transición.

### Horario y ventana
Horario inicial configurable: lunes–sábado 09:00–21:00, domingo cerrado.
Antelación mínima **2 horas**, máxima **60 días**. Solo atención presencial
en el centro en la V1. Dirección: Carrer de Gayarre 24, 08014 Barcelona.

### Selección
Orden del flujo: tratamiento → profesional → fecha → horario disponible.
Mostrar solo profesionales habilitadas para el tratamiento (relación
configurable desde EspoCRM).

### Reserva como invitado
Campos obligatorios: nombre, apellidos, teléfono, correo. Reglas exactas:

1. Enviar enlace/código de verificación por correo.
2. Retener el horario provisionalmente **10 minutos** mientras se verifica.
3. Si no se verifica, liberar el horario automáticamente.
4. Tras verificar, crear la solicitud formal y comenzar el bloqueo de
   **5 horas**.

### Solicitud y aprobación
Toda reserva requiere aprobación manual de Gapssa. Una solicitud verificada
bloquea el horario hasta **5 horas**. Gapssa aprueba/rechaza desde EspoCRM.
Al rechazar, liberar el horario de inmediato. Sin respuesta en 5 horas: la
solicitud caduca, se libera el horario, se notifica al cliente. **Máximo dos
solicitudes pendientes simultáneas por cliente o correo.** Transiciones con
control de concurrencia para impedir reservas dobles; todas idempotentes y
auditables.

### Cancelación
≥24 horas de antelación: cancelación inmediata desde el portal. <24 horas:
crea solicitud pendiente para Gapssa. Sin penalizaciones inicialmente [ND].
Conservar historial, canal, fecha, motivo.

### Reprogramación
La cita original permanece confirmada mientras se revisa el cambio. El nuevo
horario se bloquea hasta 5 horas. Mostrar aviso de que la cita original se
conserva. Si Gapssa aprueba, sustituye la fecha de forma transaccional. Si
rechaza o caduca, libera el nuevo horario y conserva la original.

## 5. Portal privado (`/mi-cuenta`) [DOC]

### V1
Resumen de próximas citas; historial básico autorizado; detalle/estado de
solicitudes; cancelación y reprogramación según §4; cuestionarios
pendientes/completados; consentimientos pendientes/firmados; perfil y
preferencias básicas; solicitud de eliminación de cuenta.

### Fases posteriores
Fotos/documentos marcados individual y explícitamente visibles por la
profesional, con descarga; evolución y recomendaciones visibles; menores y
tutores; lista de espera; exportación de datos revisada manualmente; gestión
granular de acceso profesional; secciones económicas cuando FacturaScripts
esté integrado. **No mostrar** navegación ni placeholders de pagos, facturas,
bonos o suscripciones hasta que la integración económica esté terminada.

## 6. Cuestionarios y consentimientos [DOC]

EspoCRM debe permitir crear/modificar sin programar: formularios, preguntas,
tipos de respuesta, reglas de obligatoriedad, tratamientos asociados,
requisito de autorización del tutor, versiones, vigencia, estado
activo/retirado.

Consentimiento: firma dibujada en pantalla + código de verificación por
correo; conservar versión exacta del texto aceptado; conservar firmante,
fecha, hora, IP, user-agent y evidencia de verificación según lo permitido
legalmente; registrar revocación sin borrar el histórico; separar
autorización de fotos privadas vs. uso promocional.

Reglas de cita: un cliente puede solicitar cita aunque falten cuestionarios o
consentimientos; los pendientes deben verse claramente en portal y CRM;
pueden completarse desde el móvil antes de la cita o presencialmente; **no
permitir iniciar el tratamiento** si sigue pendiente un requisito
obligatorio. Los textos legales iniciales son genéricos y provisionales,
identificados claramente para revisión posterior.

## 7. Menores (fase posterior, diseñar desde el inicio) [DOC]

Cuenta independiente vinculada al tutor; el tutor no aprueba todas las citas
(se configura por tratamiento y consentimiento); al alcanzar la mayoría de
edad el joven puede solicitar independencia — **no automática**, requiere
confirmación e identidad verificada; registrar todas las vinculaciones,
autorizaciones y desvinculaciones.

## 8. Fotografías y documentos (fase posterior) [DOC]

Almacenamiento inicial en el VPS, volumen privado fuera del directorio
público; **no** servir por URL permanente o predecible; comprobar
autenticación/autorización/visibilidad en cada descarga; accesos temporales;
contenido interno por defecto; la profesional marca individual y
explícitamente cada elemento como visible; el cliente no sube archivos en la
V1.

## 9. Lista de espera (fase posterior) [DOC]

Cliente indica tratamiento, profesional y franjas aceptables; prioridad
estrictamente cronológica; al liberarse un hueco, ofrecerlo 30 minutos a la
primera persona compatible, luego a la siguiente; aceptar el hueco **no**
confirma automáticamente la cita — crea una solicitud que requiere
aprobación de Gapssa.

## 10. Comunicaciones [DOC]

Correo V1: SMTP de `gapssa.es`, remitente `reservas@gapssa.es`, plantillas
multilingües, sin información sensible en el cuerpo (enlazar al portal).
Eventos mínimos: verificación de correo, acceso sin contraseña, solicitud
recibida/aprobada/rechazada/caducada, cambio solicitado/aprobado/rechazado,
cancelación, consentimiento pendiente, código de firma, recordatorio 24h y 2h
antes. Avisos internos de nuevas solicitudes: EspoCRM + correo (+ WhatsApp
cuando esté activo). WhatsApp (fase posterior inmediata): WhatsApp Business
Platform oficial de Meta, webhooks/plantillas vía n8n, campañas solo con
consentimiento expreso e independiente, reintentos e idempotencia.

## 11. Consulta general [DOC]

Formulario público: nombre, correo, teléfono, mensaje, consentimientos;
elegir respuesta por correo/llamada/WhatsApp; franja preferida; crea consulta
en EspoCRM; evita duplicados con clave de idempotencia; avisa por CRM y
correo (WhatsApp al activarse).

## 12. Privacidad, seguridad, SEO — ver también [[06-seguridad-privacidad-y-gobernanza]]

Privacidad por defecto y mínimo privilegio; en V1 solo administración y la
profesional asignada acceden a información sensible; nada sensible a Umami,
Google Calendar, correo o WhatsApp; no registrar cuerpos de cuestionarios,
firmas, tokens o contraseñas en logs; límites de frecuencia y antiabuso en
formularios; cookies seguras `HttpOnly`/`SameSite`, CSRF, cabeceras de
seguridad, CSP acorde a los servicios realmente usados; validar archivos y
entradas en servidor. SEO multilingüe con `hreflang`/canonical, Open Graph,
datos estructurados, sitemap; **no indexar** portal, auth, staging ni rutas
privadas; Umami autoalojado sin datos personales.

## 13. Fases de implementación (Fase 0 a Fase 7) [DOC]

0. Descubrimiento técnico y contratos (auditar repo, revisar modelo real de
   EspoCRM y APIs, definir contratos de datos/estados, diagramas de
   secuencia, estrategia de errores/idempotencia/conciliación, migraciones y
   reversión). **Entregable: documento técnico aprobado antes de implementar
   integraciones críticas.**
1. Base de plataforma: Next.js en un módulo del monorepo, Payload, PostgreSQL
   y Redis en local, configuración/secretos por entorno, Docker y health
   checks, estructura de pruebas/lint/type-check.
2. Web pública y contenido: sistema de diseño desde `gapssa1`, layout/nav/
   footer/selector de idioma, páginas/tratamientos/testimonios/galería/SEO en
   Payload, responsive y WCAG 2.2 AA, Umami con exclusiones de privacidad.
3. Autenticación y portal base: correo+contraseña, acceso por enlace/código,
   SMTP, sesiones de 30 min, verificación reforzada, vinculación con EspoCRM,
   estructura inicial de `/mi-cuenta`.
4. Reservas: catálogo operativo desde EspoCRM vía API privada, disponibilidad
   calculada en EspoCRM, selección de profesional habilitada, retención de
   invitado 10 min, bloqueo formal 5h, aprobación/rechazo/caducidad, límite
   de 2 solicitudes, cancelación/reprogramación, auditoría y conciliación.
5. Cuestionarios y consentimientos: entidades versionadas en EspoCRM,
   formularios dinámicos accesibles, firma dibujada, verificación por correo,
   evidencias y estados, pendientes visibles en portal y CRM.
6. Calidad y validación: unitarias, integración, end-to-end, concurrencia de
   reservas, accesibilidad, responsive, los 6 idiomas, seguridad/privacidad/
   logs, backup/restauración/reversión, aprobación funcional del propietario.
7. Producción: VPS y Plesk, dominios/HTTPS/proxy inverso/redes privadas,
   bases y secretos de producción, despliegue sin datos ficticios, conexión
   solo al EspoCRM real, migraciones y smoke tests, monitorización y copias,
   documentar y comprobar reversión.

No adelantar fases posteriores si eso pone en riesgo autenticación, reservas,
privacidad o consentimientos de la V1 — el calendario es exigente (ver
[[05-infraestructura-y-operacion]] §Calendario orientativo).

## 14. Definición de terminado [DOC]

Una función no está terminada hasta que: cumple las reglas funcionales
documentadas · tiene autorización y validación de servidor · es idempotente
cuando integra sistemas · gestiona errores/reintentos sin duplicar · registra
auditoría suficiente · tiene pruebas proporcionales al riesgo · es usable en
móvil y accesible · funciona en los 6 idiomas si es pública · no filtra datos
sensibles en logs/analítica/notificaciones · está documentada · tiene forma
conocida de reversión.

## 15. Decisiones pendientes que no deben inventarse en el portal [ND]

Duraciones definitivas de tratamientos · precios/impuestos/suplementos ·
teléfono y WhatsApp públicos · cuenta de Instagram definitiva · credenciales
SMTP · alta/aprobación de WhatsApp Business Platform · textos legales
definitivos · condiciones específicas de tratamientos con aparatología ·
vigencia de cada consentimiento · destino externo de backups · reglas
económicas/pagos/bonos/packs/suscripciones · políticas de penalización
futuras. Prepáralos como configuración/datos administrables, nunca como
constantes de negocio en el código.
