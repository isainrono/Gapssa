# Vulnerabilidad transitiva: `undici` vía `payload@3.87.0`

Registrado durante el endurecimiento de Fase 1 (revisión de
`docs/contratos-portal-v1.md`). Actualizar esta ficha, no borrarla, cuando
cambie el estado.

## Paquete afectado

- **Paquete**: `undici`
- **Versión instalada**: `7.28.0`
- **Rango vulnerable reportado**: `7.0.0 - 7.28.0` (incluye la instalada)
- **Versión que corrige**: `7.29.0` (disponible en el registro de npm)

## Cadena de dependencia exacta

```
gapssa (raíz)
└─ @gapssa/web
   └─ payload@3.87.0
      └─ undici@7.28.0   <- dependencia directa de payload, versión exacta fijada (sin rango)
```

Verificado con `npm ls undici`. `payload/package.json` fija
`"undici": "7.28.0"` (versión exacta, no un rango `^`/`~`): npm no puede
resolver un patch más nuevo sin que Payload cambie su propio
`package.json`.

`jsdom` (nuestra propia devDependency, usada por Vitest) también depende de
`undici` (`^7.25.0`) y queda deduplicado a la misma copia cuando ambos
rangos son compatibles.

## Severidad

**High** (la más alta de las 5 advisories que arrastra este rango):

| Advisory | Severidad |
|---|---|
| [GHSA-4cwx-7wf7-3272](https://github.com/advisories/GHSA-4cwx-7wf7-3272) — cross-user info disclosure y crash por directivas de caché degeneradas | **High** |
| [GHSA-8xcm-r25x-g524](https://github.com/advisories/GHSA-8xcm-r25x-g524) — desincronización de respuesta vía retry interceptor | Moderate |
| [GHSA-m8rv-5g2x-5cg5](https://github.com/advisories/GHSA-m8rv-5g2x-5cg5) — CRLF injection vía propiedad `type` de un body tipo blob | Moderate |
| [GHSA-jr45-8vmc-qm54](https://github.com/advisories/GHSA-jr45-8vmc-qm54) — info disclosure por espacios alrededor del `=` en `Cache-Control` | Moderate |
| [GHSA-v3r7-h72x-cjcm](https://github.com/advisories/GHSA-v3r7-h72x-cjcm) — inyección de atributos de cookie vía `domain`/`setCookie` sin sanear | Moderate |

## ¿Afecta al runtime que usamos?

`undici` es el cliente HTTP interno de `payload`. Las 5 advisories son
explotables cuando `undici` se usa **como cliente saliente** contra un
servidor que puede influir en las cabeceras/respuesta (interceptores de
caché/retry, cabeceras `Cache-Control`/`Set-Cookie` no confiables) o cuando
procesa un body tipo blob con un `type` no saneado.

En la configuración actual de Fase 1:

- No hay adaptador de correo configurado (`No email adapter provided. Email
  will be written to console` — log real de `next dev`), así que Payload no
  hace llamadas salientes por ese camino.
- No hay plugins ni integraciones externas configuradas (`plugins` vacío,
  sin webhooks).
- El único tráfico HTTP real en Fase 1 es entrante (el propio `/admin` y
  las rutas de Payload), no saliente hacia servidores de terceros.

**Conclusión**: el código vulnerable está presente pero el camino de
explotación (undici como cliente contra un servidor que devuelve cabeceras
adversariales) no está activo con la configuración actual. Es un riesgo
latente, no uno que se esté ejercitando hoy — no es lo mismo que "no hay
riesgo". Si Fase 2+ añade un adaptador de correo, webhooks salientes, o
cualquier integración donde Payload haga peticiones HTTP salientes hacia un
host no totalmente controlado por Gapssa, este riesgo pasa a ser activo y
hay que revisar el estado de esta ficha antes de activarlo.

## Por qué no existe una actualización compatible ahora mismo

`payload@3.87.0` es la versión estable más reciente publicada (verificado
en el registro de npm en la fecha de esta revisión) y fija `undici` a
`7.28.0` exacto. No hay una versión más nueva de `payload` que actualice
esa dependencia todavía.

## Intento de mitigación probado (y por qué se revirtió)

Se probó un `overrides` de npm en el `package.json` raíz
(`{"undici": "7.29.0"}`) para forzar la versión corregida. Resultado
verificado con `npm ls undici` tras `npm install`:

- La copia de `jsdom` (nuestra devDependency, uso solo en tests) **sí**
  aceptó el override, a `7.29.0`.
- La copia de `payload` **no** se movió de `7.28.0` — algo en el árbol de
  dependencias publicado de Payload la mantiene fija incluso con el
  override activo.

Como el override no protegía la copia que realmente importa (la de
`payload`, la única con un camino de código relevante) y solo añadía una
instalación inconsistente (dos versiones de `undici` convivientes sin
beneficio real), se revirtió. No se ha forzado ningún override que
degrade o arriesgue romper Payload.

## Mitigaciones temporales aplicadas

- Ninguna integración saliente configurada todavía (ver arriba): el mayor
  mitigante real hoy es no ejercitar el código vulnerable.
- Cuando se configure correo/webhooks/integraciones salientes (Fase 2+),
  revisar primero si ya existe una versión de `payload` con `undici`
  actualizado antes de activarlas.

## Criterio de revisión

Revisar esta ficha:
1. En cada actualización de `payload` (`npm view payload version`) — si la
   nueva versión sube `undici` por encima de `7.28.0`, el problema
   desaparece solo.
2. Antes de activar cualquier integración saliente real (correo, webhooks,
   llamadas a APIs externas) en Payload.
3. Cada vez que se ejecute `npm audit` como parte de una validación de
   fase — mantener esta ficha sincronizada con el resultado real, no con
   lo que decía la última vez.
