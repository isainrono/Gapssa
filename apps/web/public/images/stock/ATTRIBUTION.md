# Procedencia de las imágenes de `stock/`

## Categoría A — origen y licencia oficial verificados (2026-08-20)

Las 10 imágenes se descargaron directamente el 2026-08-20 desde el punto de
descarga oficial de Unsplash (`unsplash.com/photos/<ID>/download`, que
redirige a `images.unsplash.com`), sin necesidad de credenciales. Para cada
una se verificó, en solitario y con navegación de solo lectura:

- que la página oficial `unsplash.com/photos/<slug>-<ID>` resuelve con
  HTTP 200 y muestra fotógrafo y foto;
- que el perfil oficial del fotógrafo (`unsplash.com/@<usuario>`) resuelve
  con HTTP 200;
- que la página de la foto indica explícitamente "Free to use under the
  Unsplash License" (se descartaron todos los resultados marcados como
  Unsplash+ / Getty Images premium, que no están cubiertos por la licencia
  libre);
- correspondencia visual razonable entre la foto y el uso asignado
  (comprobada imagen por imagen, no solo por el título/alt del buscador);
- ausencia de menores, de contenido "antes/después" y de resultados
  clínicos garantizados;
- ausencia de logotipos, marcas de terceros o texto incrustado legible.

Dos rondas de descarga: en la primera pasada, 3 de las 10 candidatas
inicialmente seleccionadas (`tratamiento-facial`, `depilacion-facial`,
`radiofrecuencia-facial`) y 2 más marginales (`hero-centro`,
`tratamiento-reafirmante`) se descartaron tras inspección visual directa
del fichero descargado por mostrar marca de tercero grabada en una
herramienta ("PHIACADEMY"), una cuchilla de afeitar con texto de marca
parcial junto a una técnica no correspondiente a depilación de salón, un
dispositivo con marca muy visible ("BONiTA Korea"), texto de pared
reflejado en un espejo, y una escena de estiramiento asistido al aire
libre (no un tratamiento de spa), respectivamente. Se sustituyeron por
alternativas nuevas antes de aceptar el lote — el buscador/IA de apoyo
describía correctamente licencia y fotógrafo, pero no siempre detalles
finos como texto incrustado o marcas visibles, así que la verificación
definitiva de cada imagen fue inspección visual directa del fichero, no
solo la descripción de la página.

| Archivo | Uso | Fotógrafo | Página oficial de la foto | Perfil oficial | Licencia | Fecha de verificación | Categoría |
|---|---|---|---|---|---|---|---|
| `hero-centro.jpg` | Hero del centro | Barney Goodman | [unsplash.com/photos/…-_Fy7Kq0w6OI](https://unsplash.com/photos/a-modern-hair-salon-interior-with-stylish-chairs-and-mirrors-_Fy7Kq0w6OI) | [@bgoodpic](https://unsplash.com/@bgoodpic) | Unsplash License | 2026-08-20 | **A** |
| `tratamiento-facial.jpg` | Tratamiento facial | Rosa Rafael | [unsplash.com/photos/…-Pe9IXUuC6QU](https://unsplash.com/photos/woman-receiving-facial-mask-treatment-at-spa-Pe9IXUuC6QU) | [@rosarafael](https://unsplash.com/@rosarafael) | Unsplash License | 2026-08-20 | **A** |
| `manicura.jpg` | Manicura | Kevin kevin | [unsplash.com/photos/…-WIo3zAWqUeQ](https://unsplash.com/photos/a-womans-hands-with-a-manicured-manicure-WIo3zAWqUeQ) | [@0x00kevin](https://unsplash.com/@0x00kevin) | Unsplash License | 2026-08-20 | **A** |
| `masaje.jpg` | Masaje | Paige Madison | [unsplash.com/photos/…-0d6R1iCh1SE](https://unsplash.com/photos/hand-resting-on-persons-lower-back-during-massage-0d6R1iCh1SE) | [@paigecowen](https://unsplash.com/@paigecowen) | Unsplash License | 2026-08-20 | **A** |
| `depilacion-facial.jpg` | Depilación facial | Alexander Mass | [unsplash.com/photos/…-vgZ6cm-kldY](https://unsplash.com/photos/a-woman-in-a-white-shirt-is-holding-a-string-vgZ6cm-kldY) | [@alexandermassph](https://unsplash.com/@alexandermassph) | Unsplash License | 2026-08-20 | **A** |
| `radiofrecuencia-facial.jpg` | Radiofrecuencia facial | Content Pixie | [unsplash.com/photos/…-j1WYUNgLbOk](https://unsplash.com/photos/white-face-massager-j1WYUNgLbOk) | [@contentpixie](https://unsplash.com/@contentpixie) | Unsplash License | 2026-08-20 | **A** |
| `hidratacion-facial.jpg` | Hidratación facial | Kelsey Curtis | [unsplash.com/photos/…-kD9qprR6HBI](https://unsplash.com/photos/white-cream-smear-on-beige-surface-kD9qprR6HBI) | [@kelseycurtis](https://unsplash.com/@kelseycurtis) | Unsplash License | 2026-08-20 | **A** |
| `tratamiento-reafirmante.jpg` | Tratamiento corporal reafirmante | Taylor Heery | [unsplash.com/photos/…-_TyrA1RUaiI](https://unsplash.com/photos/a-woman-laying-on-a-bed-with-hot-stones-on-her-back-_TyrA1RUaiI) | [@taylorheeryphoto](https://unsplash.com/@taylorheeryphoto) | Unsplash License | 2026-08-20 | **A** |
| `pedicura.jpg` | Pedicura | Konstantin Shmatov | [unsplash.com/photos/WBuwkanEPiM](https://unsplash.com/photos/WBuwkanEPiM) | [@shmatov](https://unsplash.com/@shmatov) | Unsplash License | 2026-08-20 | **A** |
| `microdermoabrasion.jpg` | Cuidado facial avanzado (galería) | kimia kazemi | [unsplash.com/photos/…-u93nTfWqR9w](https://unsplash.com/photos/a-woman-getting-a-facial-mask-on-her-face-u93nTfWqR9w) | [@kimick](https://unsplash.com/@kimick) | Unsplash License | 2026-08-20 | **A** |

Licencia: [Unsplash License](https://unsplash.com/license) — uso comercial y
no comercial libre, sin necesidad de permiso ni atribución obligatoria; no
se pueden vender copias sin modificar ni usarse para componer un servicio
competidor de Unsplash. Esta tabla documenta la atribución de forma
voluntaria, no porque la licencia lo exija.

**Nota editorial sobre `radiofrecuencia-facial.jpg` y `tratamiento-reafirmante.jpg`:**
como ocurre con el resto de imágenes de `stock/`, son fotografía genérica
de ambiente/tratamiento, no una foto del equipo o protocolo real de
Gapssa. `radiofrecuencia-facial.jpg` muestra un dispositivo de masaje
facial genérico (no un equipo de radiofrecuencia identificable) — se eligió
por ser la representación visual disponible más cercana sin marca de
tercero visible, igual que el resto de imágenes de esta carpeta hasta que
Gapssa aporte fotografía propia del tratamiento.

Todos los ficheros procesados localmente tras la descarga: conversión a
perfil de color sRGB, ancho máximo 2000 px, formato JPEG, sin metadata EXIF
de cámara/GPS (eliminada por el propio proceso de recodificación).

## Procesamiento técnico aplicado a las 10 imágenes

- Descarga desde `unsplash.com/photos/<ID>/download` (redirige a
  `images.unsplash.com`), validando HTTP 200 y `Content-Type: image/jpeg`
  antes de aceptar cualquier fichero.
- Verificación de tipo real con `file` (rechazo de HTML/SVG/contenido no
  JPEG) y de dimensiones mínimas.
- Conversión de perfil de color a sRGB (`sips -m "sRGB Profile.icc"`),
  redimensionado a un ancho máximo de 2000 px cuando el original lo
  superaba, recodificación a JPEG calidad 84.
- Sustitución atómica (fichero temporal + `mv`) manteniendo el nombre
  original de cada archivo para no romper `MEDIA_FILES`.

## Historial — las 10 imágenes anteriores (categoría B, retiradas)

Hasta 2026-08-19, `stock/` contenía otras 10 imágenes (mismos nombres de
archivo) descargadas el 6 de agosto de 2026 de `images.unsplash.com`, cuya
página oficial de Unsplash nunca pudo localizarse (dos rondas de
verificación documentadas en el historial de este repositorio): la CDN
respondía con una fotografía real y el perfil de color coincidía con el
fichero local, pero ni el fotógrafo ni la página `unsplash.com/photos/…`
de cada foto eran verificables. Quedaron clasificadas como **B** y nunca
llegaron a incluirse en ningún commit. **No se mantienen esas URLs ni esos
IDs como fuente válida** — fueron sustituidas por completo por las 10
fotografías de la tabla anterior, con página, fotógrafo y perfil
verificados uno a uno. Copia de respaldo local de los 10 archivos B
retirados (nunca versionada) en
`apps/web/media/quarantine-stock-unverified/` — ver `.gitignore`.

## Otras imágenes de `public/images/` — categoría D (contenido propio de Gapssa)

- `marca/logo.webp`: copia sin editar de `gapssa1/unnamed.webp` (activo
  propio de Gapssa) — SHA-256 idéntico byte a byte entre ambos ficheros,
  verificado. **Categoría D — versionable.**
- `equipo/diana.jpg`: fotografía propia de Diana aportada por Gapssa
  (`gapssa1/WhatsApp Image 2026-06-25 at 13.31.12.jpeg`). **Contenido
  propio — autorización pública pendiente de confirmación explícita del
  cliente.** No incluida en el Commit 2 hasta recibir esa confirmación;
  ver detalle y fallback en `docs/deuda-imagenes-stock.md`.

## Subida a Payload

Estos ficheros se suben a la colección `media` de Payload mediante el
script de seed (`src/seed/`), que genera además `alt` text localizado por
imagen — no se referencian directamente por ruta estática desde los
componentes de página (siempre a través de un documento `media`).
