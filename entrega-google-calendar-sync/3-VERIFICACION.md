# 3 · Verificación

Diez minutos que evitan sorpresas. Usa una cita de prueba y, si puedes, un
calendario de Google de pruebas.

Los trabajos se procesan cada minuto, así que tras cada acción espera ~1 minuto
antes de mirar Google.

## A · La extensión responde

- [ ] Administración → Google Calendar Sync → **Cuentas de Google** abre sin
      error y muestra **Calendario Business**.
- [ ] La cuenta está en estado **Activa** con el correo de Google visible.
- [ ] El campo **Calendario sincronizado** tiene el calendario elegido.

Si el listado da 404, falta el *rebuild*: Administración → Rebuild.

## B · Alta de cita

- [ ] Crea una cita en el CRM con fecha futura y una hora concreta.
- [ ] Al cabo de un minuto, aparece en Google Calendar.
- [ ] Aparece **una sola vez**.
- [ ] La hora es correcta (comprueba la zona horaria del CRM en
      Administración → Ajustes).
- [ ] El título y la descripción coinciden.

## C · Modificación

- [ ] Cambia la fecha y la hora de esa cita en el CRM.
- [ ] El **mismo evento** se mueve en Google. No aparece uno nuevo.

Este es el punto que más importa: si aparecen dos eventos, el emparejamiento
está roto. Revisa el log antes de seguir.

## D · Cancelación

- [ ] Cambia el estado de la cita a **No realizada**.
- [ ] El evento **desaparece** de Google.
- [ ] La cita **sigue existiendo** en el CRM con su historial.

Esta es la política definida: el calendario es un espejo de la agenda viva; el
historial vive en el CRM.

## E · Resistencia a fallos

- [ ] Con la cuenta desconectada temporalmente (⋮ → Desconectar), crea o
      modifica una cita.
- [ ] La cita **se guarda igualmente** en el CRM, sin errores para el usuario.
- [ ] Vuelve a conectar la cuenta. En unos minutos, el evento aparece en Google
      sin duplicarse.

Es la prueba de que un fallo de red con Google nunca bloquea el trabajo diario.

## F · Persistencia

- [ ] Reinicia el servidor o los contenedores.
- [ ] La cuenta sigue **Activa** y una cita nueva se sigue exportando.

## G · Privacidad

- [ ] Abre un evento en Google y confirma que **no** contiene teléfono, correo
      del cliente, notas médicas ni datos sensibles.

El evento solo lleva título, descripción, fechas y un identificador interno.
Todo lo que aparezca ahí es lo que el personal haya escrito en el título o la
descripción de la cita: conviene acordar con el equipo qué se escribe.

## Si algo falla

Mira el campo **Último error** de la ficha de la cuenta: contiene el mensaje
exacto devuelto por Google con su fecha.

| Síntoma | Causa habitual |
|---|---|
| No se exporta nada | Cron parado, o no se eligió calendario |
| 404 al abrir el listado | Falta Rebuild |
| `redirect_uri_mismatch` | La URI del CRM y la de Google no coinciden |
| `invalid_grant` a los 7 días | La app OAuth sigue en modo *Testing*; publícala |
| Eventos duplicados | Dos CRM sincronizando el mismo calendario |

El detalle técnico está en `4-MANTENIMIENTO.md`.
