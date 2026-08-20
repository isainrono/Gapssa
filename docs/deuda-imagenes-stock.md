## ✅ Deuda de las 10 imágenes: RESUELTA (2026-08-20) — Alternativa 1 implementada

Las 10 imágenes categoría B se sustituyeron por 10 fotografías nuevas con
página oficial, fotógrafo y perfil verificados uno a uno (categoría A).
`MEDIA_FILES`, `media.test.ts` y el seed ya operan sobre las 10 nuevas.
Detalle completo, tabla por imagen y metodología de verificación en
`apps/web/public/images/stock/ATTRIBUTION.md`. El resto de este documento
se conserva como registro histórico del bloqueo original y de las dos
alternativas evaluadas — ninguna acción pendiente en torno a estas 10
imágenes.

## ⏳ Asunto separado, todavía abierto — autorización pública de `equipo/diana.jpg`

No es parte de la deuda anterior (esa foto ya era categoría D desde el
principio, no B) y no se resuelve con la sustitución de las 10 imágenes de
stock. `equipo/diana.jpg` sigue sin autorización pública explícita
confirmada por Gapssa:

- fichero físico conservado en disco, sin borrar ni modificar;
- excluido de `MEDIA_FILES` (`apps/web/src/seed/media.ts`) — el seed no lo
  sube ni lo referencia;
- excluido de Git con una línea exacta en `.gitignore`
  (`/apps/web/public/images/equipo/diana.jpg`) — el resto de
  `apps/web/public/images/equipo/` sigue versionable con normalidad;
- la sección "Sobre Gapssa" usa un fallback visual neutro (fondo
  `--color-cream-alt` en `QuienSoySection.module.css`) mientras no haya
  foto;
- `media.test.ts` ya no exige su presencia (solo valida las entradas que
  sí están en `MEDIA_FILES`).

**Pendiente exclusivo:** confirmación personal y explícita de Gapssa de
que la fotografía puede publicarse. Solo entonces: retirar la línea del
`.gitignore`, volver a añadir la entrada a `MEDIA_FILES` y ejecutar el
seed de nuevo.

---

# Deuda: 10 imágenes de `apps/web/public/images/stock/` bloqueadas (categoría B)

Estado a 2026-08-19: las 10 imágenes de `public/images/stock/` quedan
clasificadas como **B** (origen Unsplash probable — la CDN responde con
una fotografía real y su perfil de color coincide exactamente con el
fichero local — pero fotógrafo y página oficial no verificables con los
medios de navegación de solo lectura autorizados). Detalle completo,
tabla por imagen y metodología de verificación en
`apps/web/public/images/stock/ATTRIBUTION.md`. Solo las categorías A
(origen y licencia oficial verificados) y D (contenido propio de Gapssa)
pueden versionarse — las 10 quedan **fuera** del manifiesto del Commit 2
hasta resolver este documento.

## Bloqueo concreto que esto produce

`apps/web/src/seed/media.ts` (`MEDIA_FILES`) lista las 10 imágenes B junto
con las 2 imágenes D (`logo.webp`, `diana.jpg`). Verificado empíricamente
en un clon aislado del manifiesto exacto de los commits 1+2 (sin las 10
imágenes B, con Postgres/Payload efímeros, sin tocar el repo real):

- `npm run test -w @gapssa/web` **falla** en `src/seed/media.test.ts` (la
  prueba de integridad nueva) — falta `stock/hero-centro.jpg` en disco.
- `npm run seed -w @gapssa/web` **crashea** con `ENOENT` en el mismo
  fichero — `seedMedia()` se ejecuta primero en `index.ts`, así que
  **ningún otro dato del seed llega a crearse** (ni tratamientos, ni
  familias, ni páginas legales, ni galería). Solo se crean 2 documentos
  `media` antes de fallar: `logo.webp` (id 1) y `diana.jpg` (id 2).
- `npm run build -w @gapssa/web` **no se ve afectado** — no depende de
  las imágenes ni de que el seed se haya ejecutado.

## Alcance real de las 10 imágenes en el seed (trazado en `src/seed/index.ts`)

| Uso | Claves involucradas |
|---|---|
| Hero de portada (`contenidoInicio`) | `hero-centro` (1) |
| Imagen de familia de tratamiento (`FAMILIA_IMAGEN_POR_SLUG`) | `masaje` → masajes, `tratamiento-reafirmante` → aparatología, `depilacion-facial` → depilación, `tratamiento-facial` → faciales, `manicura` → uñas, `hidratacion-facial` → pestañas/cejas (6) |
| Galería pública (`GALERIA_SEED`) | las 10, una entrada cada una |
| Sin uso fuera de galería | `radiofrecuencia-facial`, `pedicura`, `microdermoabrasion` (solo aparecen en la galería) |

`logo` y `diana` (categoría D, sí versionables) alimentan el logo global/OG
image por defecto y la foto de la página "Sobre Gapssa" respectivamente —
no dependen de esta decisión.

---

## Alternativa 1 — Sustituir las 10 por imágenes con procedencia verificable

**Qué implica:** localizar 10 fotografías de stock equivalentes (mismo
encuadre temático: interior de centro, tratamiento facial, manicura,
masaje, depilación facial, radiofrecuencia, hidratación facial, tratamiento
reafirmante, pedicura, microdermoabrasión) cuya página oficial en Unsplash
(u otro banco con licencia igual de permisiva: Pexels, Pixabay) resuelva
de verdad, con fotógrafo y perfil verificables — es decir, que lleguen a
categoría A real, no repetir el mismo problema con otro ID sin verificar.

**Lista exacta de páginas/autores propuestos:** **no incluida en esta
entrega** — encontrar 10 fotos concretas con URL oficial verificable es
en sí mismo un trabajo de búsqueda/curación editorial (mismo tipo de
navegación ya intentada sin éxito para las 10 actuales), no algo que deba
decidirse unilateralmente sin tu criterio sobre estilo/composición
aceptable para la marca. Si apruebas esta alternativa, el siguiente paso
sería una ronda de búsqueda dedicada (o que Gapssa aporte una selección)
antes de tocar ningún fichero.

**Impacto visual:** ninguno respecto al diseño actual — mismo número de
huecos (hero, 6 familias, galería de 10), mismo criterio editorial
("fotografía de stock genérica de ambiente/tratamiento... hasta que
Gapssa aporte fotografía propia", ya documentado en `ATTRIBUTION.md`).
Cambiaría únicamente el contenido concreto de cada foto.

**Reversibilidad:** alta — no toca código, solo los 10 archivos de imagen
y `ATTRIBUTION.md`.

---

## Alternativa 2 — Eliminar las 10 entradas de `media.ts` y adaptar el seed

**Qué implica, archivo por archivo:**

1. `apps/web/src/seed/media.ts`: quitar las 10 entradas B de `MEDIA_FILES`
   (quedan solo `logo` y `diana`).
2. `apps/web/src/seed/index.ts`:
   - línea 96 (`heroImagen: mediaIds['hero-centro']`) → `heroImagen`
     pasaría a `undefined`; hay que confirmar si el campo admite
     `undefined`/es opcional en el schema de Payload (`ContenidoInicio`)
     o si hace falta un valor por defecto explícito.
   - `FAMILIA_IMAGEN_POR_SLUG` (6 entradas) → mismas dos opciones:
     dejar `imagen: undefined` (si el campo lo admite) o quitar el mapeo
     y aceptar que las 6 familias queden sin imagen.
   - `GALERIA_SEED`/`seedGaleria` → las 10 entradas de galería dejan de
     tener imagen fuente; la opción honesta es no sembrar ninguna galería
     todavía (`summary.galeria = []` o similar), nunca simular una imagen
     que no existe.
3. `apps/web/src/seed/data/galeria.ts`: si se opta por no sembrar galería,
   quedaría con 0 entradas activas hasta que existan imágenes reales.

**Comportamiento visual de fallback (a decidir, no implementado):**
- Hero de portada: o bien un color/gradiente de marca sin foto, o un
  componente que oculte el bloque de imagen si `heroImagen` es nulo —
  cuál de los dos depende de cómo esté hecho el componente de portada
  (`apps/web/src/app/(frontend)/[locale]/page.tsx` y afines), no
  investigado en detalle en esta ronda.
- Familias de tratamiento (6 de ellas): mismo dilema — placeholder visual
  vs. ocultar la imagen en la tarjeta de familia.
- Galería pública: la sección quedaría vacía (0 elementos) hasta que
  Gapssa aporte fotografía propia — probablemente la opción más honesta
  a corto plazo, pero visualmente notoria en la página `/es/sobre-gapssa`
  o donde se renderice.

**Impacto en la web pública:** portada, 6 tarjetas de familia de
tratamiento y la galería completa pierden imagen hasta que Gapssa aporte
material propio — un cambio de apariencia visible para cualquier visitante,
no solo un detalle interno.

**Reversibilidad:** media — revertible sin pérdida de datos (basta con
volver a añadir las entradas a `media.ts`/`index.ts` cuando existan
imágenes válidas), pero toca código de producción (`index.ts`, posiblemente
componentes de página), no solo archivos de imagen.

---

## Decisión pendiente

Ninguna de las dos alternativas se ha implementado. `MEDIA_FILES` sigue
listando las 12 entradas originales; `src/seed/media.test.ts` sigue
fallando honestamente contra el estado real del árbol de trabajo cuando
se valida sin las 10 imágenes B presentes (ver
`apps/web/public/images/stock/ATTRIBUTION.md` para el detalle de la
clasificación). El Commit 2, tal como está propuesto ahora mismo, **no
puede incluir `apps/web/src/seed/media.test.ts` en verde** hasta que se
resuelva esta decisión — se documenta como bloqueo conocido, no se oculta
ni se manipula el test para que pase igualmente.
