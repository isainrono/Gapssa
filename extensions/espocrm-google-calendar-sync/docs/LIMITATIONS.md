# Limitaciones conocidas — Fase 1

1. **Solo salida (Espo → Google).** Nada se importa desde Google. Los cambios
   hechos directamente en el calendario Business no se propagan al CRM y serán
   sobrescritos en el siguiente push de esa cita. El pull bidireccional para
   cuentas User es la fase 2.

2. **Sin exportación del histórico.** Las citas anteriores a la conexión de la
   cuenta Business solo se exportan si se modifican después.

3. **Recurrencia no soportada.** Las citas de EspoCRM no generan eventos
   recurrentes en Google (una cita = un evento).

4. **Latencia de hasta ~1 minuto** (cola de jobs procesada por el cron) y de
   hasta 5 minutos para reintentos tras un fallo (barrido).

5. **Invitados no sincronizados.** El evento de Google no incluye asistentes
   (deliberado: las invitaciones a clientes siguen saliendo por el correo del
   CRM; añadir attendees haría que Google enviara sus propias invitaciones).
   Tampoco se envía teléfono ni ningún dato del cliente más allá de lo que el
   personal escriba en título/descripción de la cita.

6. **Ventana de reintento de 14 días.** Si la cuenta está en Error más de 14
   días, las citas modificadas antes de esa ventana no se reintentan
   automáticamente (se reexportan al modificarse de nuevo).

7. **El borrado de vínculos huérfanos no es proactivo.** Si un push de borrado
   falla repetidamente y la cita ya no existe, el evento puede quedar en Google
   hasta el siguiente barrido con cuenta operativa.

8. **Un solo calendario Business.** Multi-centro o multi-calendario de salida
   queda fuera de alcance.

9. **El callback OAuth exige sesión de administrador** en el mismo navegador.
   Es intencional (seguridad), pero implica que no se puede conectar la cuenta
   desde un enlace externo.

10. **App OAuth en modo Testing**: refresh tokens caducan a los 7 días (límite
    de Google, no de la extensión). Publicar la app lo resuelve
    (`GOOGLE_CLOUD_SETUP.md`, paso 11).

11. **`make gcs-status` consulta la BD directamente** (solo lectura); si
    cambian los nombres internos de tablas en futuras versiones de EspoCRM,
    habrá que ajustarlo.

12. **Construir el ZIP requiere Docker y red la primera vez.** `vendor/` no se
    versiona: se reconstruye desde `composer.lock` con `make gcs-deps`, que usa
    la imagen `composer:2`. Sin red no se pueden descargar los paquetes,
    aunque el lock garantiza que las versiones son siempre las mismas. El ZIP
    ya construido sí es instalable sin red.

13. **Precedencia de clases en runtime.** El ZIP incluye su propia Guzzle,
    Monolog, phpseclib y PSR, pero si EspoCRM ya cargó esas clases en la misma
    petición, PHP usa las suyas (una clase solo se carga una vez). Las
    versiones son compatibles, así que no hay impacto práctico; el aislamiento
    total exigiría `php-scoper`. Detalle en `VENDOR.md`.

14. **Solo el servicio Calendar.** `apiclient-services` se recorta
    automáticamente con el script oficial de Google; usar cualquier otra API
    requeriría añadir su servicio en `extra."google/apiclient-services"` y
    regenerar el lock.

15. **Las dependencias sugeridas hay que declararlas.** `google/apiclient` y
    `google/auth` usan paquetes que solo listan como `suggest` (hoy
    `phpseclib/phpseclib`; podrían añadir otros al actualizar). Si una futura
    versión introduce otro `suggest` usado en runtime,
    `tools/check-dependencies.php` no lo detectará salvo que se añada su clase
    a la lista de comprobación. Revisa el diff del lock al ejecutar
    `make gcs-lock`.

16. **Cambiar `composer.json` obliga a refirmar el lock.** `make gcs-deps`
    aborta si detecta que el lock no coincide (`composer validate --strict`).
    Si cambiaron las dependencias, `make gcs-lock`; si solo metadatos (`name`,
    `description`), `make gcs-relock`, que refresca la firma sin mover ninguna
    versión. Es deliberado: nunca se instala algo distinto de lo registrado.

17. **Una instancia, un calendario.** Dos EspoCRM distintos no deben
    sincronizar contra el mismo calendario de Google: los identificadores de
    cita (`espoMeetingId`) de una instancia no significan nada en la otra y las
    exportaciones se pisarían. Ver `DEPLOY_OTHER_INSTANCE.md`.

18. **Solo inglés y español.** Añadir un idioma es copiar
    `Resources/i18n/en_US/` y traducir; `tests/i18n_test.php` avisa de lo que
    falte. Los mensajes del log están siempre en inglés, por diseño.

19. **El título del evento incluye el nombre del cliente.** Es un dato personal
    que sale del CRM hacia Google. Es el objetivo de la función, pero conviene
    tenerlo presente al valorar la privacidad del calendario y con quién se
    comparte. No se envía ningún otro dato del contacto.

20. **Máximo 10 contactos en el título.** Tope defensivo de
    `ContactNameResolver` para que el asunto no crezca sin límite. Si una cita
    tuviera más, se incluyen los 10 primeros por orden alfabético.

21. **Renombrar un contacto reexporta como mucho 200 citas.** El hook
    `Hooks/Contact/GcsContactRename` encola las más recientes y futuras
    (`dateStart DESC`). Si el contacto tuviera más, las antiguas conservan el
    título anterior: es históricamente fiel y evita inundar la cola y la cuota
    de la API por un cambio menor. El aviso queda en el log.

    Corrección respecto a la v1.1.0 de este documento: se afirmaba que el
    barrido de 14 días acabaría corrigiendo el título. **Es falso.** El barrido
    filtra por `Meeting.modifiedAt`, que no cambia al editar un Contact, así que
    la cita nunca se seleccionaba. De ahí este hook.

22. **Un error del ORM al leer los contactos hace fallar la sincronización de
    esa cita**, a propósito. `ContactNameResolver` no captura excepciones: el
    fallo llega a `SyncService`, que lo registra en la cuenta y deja que el
    trabajo se reintente. La alternativa —seguir y exportar el evento sin el
    nombre del cliente— escondería un fallo real dando el trabajo por bueno.

23. **El orden de los nombres es alfabético**, insensible a mayúsculas y sin
    depender del locale del servidor. No es el orden en que se vincularon los
    contactos, que la base de datos no garantiza de forma reproducible.
