# Deuda técnica: la suite de integración no es robusta a orden de test aleatorio

Detectado 2026-08-19, durante el preflight de versionado (no corregido a
propósito — fuera del alcance de ese checkpoint, registrado aquí para
revisión explícita antes del cierre de la V1).

## Qué se observó

`apps/web/tests/integration/**/*.int.test.ts` (35 ficheros, 331 tests):

| Configuración | Resultado |
|---|---|
| Orden normal (por defecto) | ✅ 331/331 |
| 1 worker (`--maxWorkers=1`), orden normal | ✅ 331/331 |
| Orden de ficheros estable, orden de `it()` aleatorio dentro de cada fichero (`--sequence.shuffle.tests=true`), **solo** los 3 ficheros corregidos en esta ronda (`emailLookupHmacRotation.int.test.ts`, `booking.otpOutbox.int.test.ts`, `booking.sweepRecovery.int.test.ts`) | ✅ 24/24 |
| Igual que arriba, pero sobre **toda** la suite | ❌ 28 fallos (en 1 fichero) |
| Orden de ficheros y de tests ambos aleatorios (`--sequence.shuffle=true`), toda la suite | ❌ 33 fallos (en 3 ficheros) |

## Causa aparente

Varios ficheros de la suite (no identificados uno a uno en esta ronda)
encadenan `it()` dentro de un mismo `describe` asumiendo que el test
anterior ya dejó cierto estado en la base de datos compartida o en el
servidor `next dev` real de la suite — un patrón narrativo válido para
probar flujos con estado (p. ej. una reserva que avanza de
`pending_verification` a `verification_processing` a `confirmed` a lo
largo de varios `it()` sucesivos), pero que rompe si Vitest reordena esos
`it()` al azar dentro del fichero.

No se ha identificado el fichero exacto con 28 fallos concentrados (la
investigación se detuvo ahí, según lo acordado) — es el primer paso de
cualquier trabajo futuro sobre esto.

## Por qué no es un bloqueo de este checkpoint

- El orden **real** con el que corre la suite (`npm run test:integration`,
  sin flags de shuffle) es el orden estable de siempre — 331/331 en verde,
  reproducido varias veces.
- Los 3 ficheros que sí se tocaron en esta ronda (los que tenían los 4
  fallos originales) son robustos incluso bajo shuffle — no es su
  fragilidad la que aparece aquí.
- El código de producción no se modificó para esta comprobación en
  ningún caso — es exclusivamente un rasgo de diseño de tests
  preexistente.

## Por qué debe revisarse antes de cerrar la V1

- Cualquier futura migración a un runner que paralelice/reordene tests
  por defecto (o a `vitest --sequence.shuffle` en CI para detectar
  fugas de estado entre tests) rompería la suite sin que sea un bug de
  producto real.
- La dependencia de orden implícito dentro de un `describe` es frágil
  ante refactors futuros del propio fichero de test (mover un `it()` de
  sitio silenciosamente cambia el comportamiento).

## Qué NO se ha hecho (a propósito)

- No se ha identificado el/los fichero(s) exacto(s) con los 28-33 fallos.
- No se ha tocado ningún test ajeno a los 3 ya corregidos.
- No se ha cambiado ninguna regla de negocio.
- No se ha añadido `sequence.shuffle` a la configuración real de CI/scripts.

## Próximo paso sugerido (no ejecutado)

Ejecutar `npx vitest run --config vitest.integration.config.ts --sequence.shuffle.tests=true` con `--reporter=verbose` sobre la suite completa, aislar el/los fichero(s) con más fallos, y decidir caso por caso si:
(a) el test narrativo se reescribe para ser autocontenido (crear su propio
estado en un `beforeEach`, no heredarlo del `it()` anterior), o
(b) se marca explícitamente como "requiere orden secuencial" y se excluye
de cualquier ejecución con shuffle futura.
