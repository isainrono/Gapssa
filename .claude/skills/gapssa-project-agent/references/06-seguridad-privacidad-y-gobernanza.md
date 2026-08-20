# Seguridad, privacidad y gobernanza del proyecto

Fuentes: `PROJECT_CONTEXT.md` §15.2, §7.3, `PLAN_DESARROLLO_WEB_PORTAL.md`
§6, §9, §11, §15, y `extensions/espocrm-google-calendar-sync/` (seguridad
verificada en código). Marca **[DOC]** = regla validada,
**[SRC]** = verificado en código del repo, **[ND]** = pendiente de decidir.

## 1. Principios transversales [DOC]

- Privacidad por defecto y **mínimo privilegio** en todo el sistema.
- Cada dato sensible tiene un único sistema responsable (ver tabla de
  fuentes de verdad, [[01-fuentes-de-verdad-y-reglas-negocio]] §3).
- Ninguna app escribe directamente en la base de datos de otra.
- Los secretos nunca se guardan en el repositorio ni se exponen al
  navegador.
- Todo dato sensible que cambia registra: valor anterior, valor nuevo, fecha,
  usuario o sistema, canal y motivo.

## 2. Seguridad de infraestructura (producción, objetivo) [DOC]

- Segundo factor obligatorio para usuarios internos.
- Cuentas personales, nunca compartidas.
- Bloqueo tras intentos fallidos.
- Cierre de sesiones inactivas.
- Auditoría de accesos y cambios sensibles.
- Secretos fuera del repositorio.
- n8n con permisos mínimos en cada API que consuma.

## 3. Seguridad del portal web (plan, no implementado) [DOC]

- Sesión cerrada tras 30 minutos de inactividad; rotación y revocación
  segura de sesiones.
- Contraseñas con algoritmo moderno y parámetros seguros (no especifica
  cuál — no asumas bcrypt/argon2 concretos sin confirmarlo cuando llegue el
  momento de implementar).
- Límites de intentos por IP, cuenta y operación.
- No revelar si una dirección de correo existe durante recuperación/acceso.
- Auditoría de inicios de sesión y acciones sensibles.
- Cookies seguras, `HttpOnly`, `SameSite` apropiado, protección CSRF.
- Cabeceras de seguridad y una CSP acorde a los servicios realmente usados
  (no una CSP genérica copiada de otro proyecto).
- Validar archivos y entradas **en servidor**, nunca confiar solo en
  validación de cliente.
- No enviar datos sensibles a Umami, Google Calendar, correo o WhatsApp.
- No registrar cuerpos de cuestionarios, firmas, tokens ni contraseñas en
  logs.
- Límites de frecuencia y controles antiabuso en formularios públicos.
- Cifrar comunicaciones y datos sensibles según el diseño aprobado; preparar
  rotación de secretos.

## 4. Eliminación y exportación de datos [DOC]

- Una solicitud de eliminación bloquea el acceso de inmediato.
- Gapssa revisa manualmente qué información debe conservarse legalmente
  antes de eliminar/anonimizar.
- La exportación automática **no** entra en la V1; después, el cliente podrá
  solicitarla con verificación manual de identidad por Gapssa.

## 5. Consentimientos y datos de salud (CRM) [DOC]

- Cuestionario general de salud actualizable; consentimiento por familia o
  tipo de tratamiento; nueva confirmación si cambia tratamiento, protocolo,
  riesgos o estado de salud.
- Se registra versión, fecha, firmante, alcance y revocación de cada
  consentimiento — la revocación **no borra** el consentimiento histórico.
- Permisos separados para fotos privadas vs. uso promocional.
- El cliente decide el alcance de acceso de los profesionales a su ficha;
  se admite autorización puntual a un sustituto.
- La gestoría accede al área económica/fiscal/laboral del ERP pero **nunca**
  a cuestionarios, fotos, consentimientos ni notas sensibles del CRM — es
  una frontera de acceso explícita, no una convención implícita.

## 6. Seguridad verificada en código: extensión Google Calendar Sync [SRC]

Referencia concreta de cómo se implementa "secreto nunca en el repo" en este
proyecto — úsala como patrón al diseñar credenciales de otras integraciones
(n8n, FacturaScripts, SMTP):

- `clientId`/`clientSecret`/tokens nunca en código ni Git.
- `clientSecret` guardado con nivel de config `internal`: la API de EspoCRM
  nunca lo devuelve.
- `accessToken`/`refreshToken` cifrados con `Espo\Core\Utils\Crypt` y
  bloqueados a nivel de API vía `entityAcl.fields.forbidden` — no basta con
  cifrar en BD, también hay que impedir que la API los sirva.
- El `state` de OAuth es aleatorio, de un solo uso, validado con
  `hash_equals` (comparación segura frente a timing attacks).
- Solo administradores pueden configurar y conectar la cuenta.
- Scopes mínimos pedidos: `calendar.events` +
  `calendar.calendarlist.readonly`, nunca el scope completo `calendar`.
- A un sistema externo (Google) solo se envía el mínimo dato operativo
  necesario: título, descripción, fechas, id interno — nunca teléfono,
  correo ni identificadores del contacto.
- Ningún log contiene tokens; los mensajes de log van siempre en inglés por
  diseño, y `ContactNameResolver` deja fallar la operación en vez de ocultar
  un error del ORM silenciosamente (ver
  [[03-espocrm-modelo-y-extension-gcs]] §5.2).

Patrón a replicar: **cifrar + bloquear en ACL + no loguear + scope mínimo +
mínimo dato transferido**, no solo una de estas medidas.

## 7. Reglas de integración (auditoría e idempotencia) [DOC]

Aplican a toda integración entre sistemas del proyecto — ver detalle en
[[02-arquitectura-e-integraciones]] §5:

- Cada envío lleva clave de idempotencia; los reintentos no crean
  duplicados.
- Una interrupción deja la operación en espera, nunca la descarta.
- Las eliminaciones se modelan como estados/anulaciones con historial, no
  como borrado físico salvo excepción justificada.
- Las discrepancias no se corrigen silenciosamente: la conciliación diaria
  debe detectarlas y exponerlas.

## 8. Gobernanza del proyecto: reglas de trabajo obligatorias [DOC]

Estas reglas, de `PLAN_DESARROLLO_WEB_PORTAL.md` §2, aplican a cualquier
tarea de implementación en el monorepo, no solo al portal:

- No inventar reglas de negocio que no estén en `PROJECT_CONTEXT.md` o en el
  plan de portal.
- Ante contradicción entre ambos documentos, **detener** la implementación
  afectada y pedir confirmación explícita.
- Mantener EspoCRM como fuente de verdad de clientes, profesionales,
  tratamientos, disponibilidad, citas, cuestionarios y consentimientos.
- Mantener Payload CMS como fuente de verdad del contenido editorial y
  multilingüe.
- Mantener FacturaScripts como futura fuente de verdad de precios,
  impuestos, pagos y facturas.
- Integrar sistemas mediante APIs, eventos o jobs asíncronos idempotentes,
  nunca escritura directa entre bases de datos.
- Next.js debe ser la única capa BFF que autentica, autoriza y valida.
- No introducir datos reales en desarrollo o pruebas.
- No modificar ni eliminar cambios ajenos existentes en el repositorio sin
  entender antes qué son (aplica en particular a `gapssa1/`, que es material
  de referencia del propietario, no descartable).
- Implementar por módulos, evitando personalizaciones dentro del núcleo de
  cada plataforma.
- Documentar decisiones técnicas relevantes y procedimientos de
  instalación/actualización/reversión — el patrón a seguir es el de
  `extensions/espocrm-google-calendar-sync/docs/DECISIONS.md`.

## 9. Criterio obligatorio antes de implementar algo nuevo [DOC]

Repetido aquí porque es la herramienta de gobernanza más usada en este
proyecto — responde las 8 preguntas antes de escribir código:

1. ¿Qué proceso de negocio resuelve?
2. ¿Qué sistema es propietario del dato?
3. ¿Qué otros sistemas necesitan copia o referencia?
4. ¿Contiene información sensible, fiscal o laboral?
5. ¿Qué sucede si la integración falla?
6. ¿Cómo se evita duplicar la operación?
7. ¿Qué debe quedar auditado?
8. ¿Cómo se prueba y se revierte?

## 10. Qué no debes inventar (resumen transversal) [ND]

No decidas por tu cuenta: precios/impuestos/suplementos, condiciones de
bonos/packs/membresías, política de cancelación/penalización, matriz método
de depilación × zona, qué tratamientos requieren valoración/cuestionario/
consentimiento específico, vigencia de consentimientos, zonas de cobertura a
domicilio, horario habitual definitivo, reglas de fidelización, plazos de
facturación empresarial, destino externo de backups, teléfono/WhatsApp/
Instagram públicos definitivos, credenciales SMTP, textos legales
definitivos, algoritmo concreto de hashing de contraseñas. Si una tarea
depende de uno de estos valores, trátalo como configuración/dato
administrable pendiente y dilo explícitamente en vez de rellenarlo — ver
lista completa por área en [[01-fuentes-de-verdad-y-reglas-negocio]] §14 y
[[04-portal-web-reservas-plan]] §15.
