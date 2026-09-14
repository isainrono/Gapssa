import fs from 'node:fs'
import path from 'node:path'

import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { MEDIA_FILES, PUBLIC_IMAGES_DIR, mimeTypeFor } from './media'

/**
 * Integridad del manifiesto de `seedMedia` (MEDIA_FILES) — puramente
 * filesystem/forma, sin tocar Payload/Postgres. No afirma nada sobre
 * licencia/procedencia de cada imagen (eso vive en
 * `public/images/stock/ATTRIBUTION.md`): una entrada puede pasar este test
 * y seguir bloqueada para commit por razones de licencia.
 *
 * Refleja el estado real del árbol de trabajo tal cual está ahora — si
 * algún fichero de `stock/` queda excluido del working tree en el futuro
 * (p. ej. tras aceptar la Alternativa 2 de docs/deuda-imagenes-stock.md),
 * este test empezará a fallar por diseño: es la señal de que `media.ts`
 * también necesita actualizarse, nunca algo que deba silenciarse.
 */

const EXTENSIONES_ADMITIDAS = new Set(['.jpg', '.jpeg', '.webp'])

describe('MEDIA_FILES — integridad del manifiesto de seed', () => {
  it('no está vacío', () => {
    expect(MEDIA_FILES.length).toBeGreaterThan(0)
  })

  it('cada entrada tiene una clave (key) no vacía', () => {
    for (const file of MEDIA_FILES) {
      expect(file.key.trim().length).toBeGreaterThan(0)
    }
  })

  it('ninguna clave (key) se repite', () => {
    const keys = MEDIA_FILES.map((f) => f.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('ningún nombre de archivo (basename) se repite — seedMedia deduplica por filename', () => {
    const basenames = MEDIA_FILES.map((f) => path.basename(f.relativePath))
    expect(new Set(basenames).size).toBe(basenames.length)
  })

  it('ninguna ruta relativa escapa de PUBLIC_IMAGES_DIR (sin ../, sin ruta absoluta)', () => {
    for (const file of MEDIA_FILES) {
      expect(path.isAbsolute(file.relativePath)).toBe(false)
      const resolved = path.resolve(PUBLIC_IMAGES_DIR, file.relativePath)
      const relativeFromRoot = path.relative(PUBLIC_IMAGES_DIR, resolved)
      expect(relativeFromRoot.startsWith('..')).toBe(false)
      expect(path.isAbsolute(relativeFromRoot)).toBe(false)
    }
  })

  it('cada extensión está entre las admitidas por mimeTypeFor (.jpg/.jpeg/.webp)', () => {
    for (const file of MEDIA_FILES) {
      const ext = path.extname(file.relativePath).toLowerCase()
      expect(EXTENSIONES_ADMITIDAS.has(ext)).toBe(true)
    }
  })

  it('mimeTypeFor() nunca devuelve un tipo distinto de image/jpeg o image/webp para estas rutas', () => {
    for (const file of MEDIA_FILES) {
      expect(['image/jpeg', 'image/webp']).toContain(mimeTypeFor(file.relativePath))
    }
  })

  it('el fichero existe realmente en disco', () => {
    for (const file of MEDIA_FILES) {
      const absolutePath = path.join(PUBLIC_IMAGES_DIR, file.relativePath)
      expect(fs.existsSync(absolutePath), `falta ${file.relativePath} (key=${file.key})`).toBe(true)
    }
  })

  it('el fichero es un archivo regular (nunca un directorio ni un symlink)', () => {
    for (const file of MEDIA_FILES) {
      const absolutePath = path.join(PUBLIC_IMAGES_DIR, file.relativePath)
      if (!fs.existsSync(absolutePath)) continue // ya reportado por el test anterior
      const stat = fs.lstatSync(absolutePath)
      expect(stat.isFile(), `${file.relativePath} no es un archivo regular`).toBe(true)
      expect(stat.isSymbolicLink(), `${file.relativePath} es un symlink`).toBe(false)
    }
  })

  it('el fichero no está vacío (tamaño > 0 bytes)', () => {
    for (const file of MEDIA_FILES) {
      const absolutePath = path.join(PUBLIC_IMAGES_DIR, file.relativePath)
      if (!fs.existsSync(absolutePath)) continue // ya reportado por el test anterior
      const stat = fs.statSync(absolutePath)
      expect(stat.size, `${file.relativePath} tiene 0 bytes`).toBeGreaterThan(0)
    }
  })

  it('altPorLocale trae texto no vacío en los 6 locales', () => {
    for (const file of MEDIA_FILES) {
      for (const [locale, text] of Object.entries(file.altPorLocale)) {
        expect(text.trim().length, `${file.key}.altPorLocale.${locale} vacío`).toBeGreaterThan(0)
      }
    }
  })

  it('ninguna entrada apunta a la cuarentena local ni a apps/web/media/', () => {
    // apps/web/media/ es almacenamiento de subidas de Payload (ignorado por
    // Git); apps/web/media/quarantine-stock-unverified/ es el respaldo local
    // de las imágenes categoría B retiradas (docs/deuda-imagenes-stock.md).
    // Ninguna de las dos debe alimentar nunca el seed.
    const mediaDirAbsoluto = path.resolve(PUBLIC_IMAGES_DIR, '..', '..', 'media')
    for (const file of MEDIA_FILES) {
      expect(file.relativePath, `${file.key} referencia quarantine-stock-unverified`).not.toContain('quarantine')
      const absolutePath = path.resolve(PUBLIC_IMAGES_DIR, file.relativePath)
      const relativeToMedia = path.relative(mediaDirAbsoluto, absolutePath)
      expect(relativeToMedia.startsWith('..'), `${file.key} resuelve dentro de apps/web/media/`).toBe(true)
    }
  })

  it('logo y retrato de equipo solo se exigen si están autorizados en el manifiesto (MEDIA_FILES)', () => {
    // 'diana' (equipo/diana.jpg) se excluye a propósito hasta confirmar
    // autorización pública explícita — ver docs/deuda-imagenes-stock.md.
    // Este test documenta la invariante: nada obliga a que 'diana' exista
    // en MEDIA_FILES, y el resto de tests de este fichero solo iteran sobre
    // las entradas que sí están en el manifiesto.
    const keys = MEDIA_FILES.map((f) => f.key)
    expect(keys).toContain('logo')
    if (keys.includes('diana')) {
      const diana = MEDIA_FILES.find((f) => f.key === 'diana')!
      const absolutePath = path.join(PUBLIC_IMAGES_DIR, diana.relativePath)
      expect(fs.existsSync(absolutePath), 'diana está en MEDIA_FILES pero falta en disco').toBe(true)
    }
  })

  describe('contenido real del fichero (sharp + firma binaria)', () => {
    const MIN_DIM = 200
    const MAX_DIM = 8000

    function leerFirma(absolutePath: string): Buffer {
      const fd = fs.openSync(absolutePath, 'r')
      const buffer = Buffer.alloc(12)
      fs.readSync(fd, buffer, 0, 12, 0)
      fs.closeSync(fd)
      return buffer
    }

    function esJpegPorFirma(buffer: Buffer): boolean {
      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
    }

    function esWebpPorFirma(buffer: Buffer): boolean {
      return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
    }

    for (const file of MEDIA_FILES) {
      const absolutePath = path.join(PUBLIC_IMAGES_DIR, file.relativePath)
      if (!fs.existsSync(absolutePath)) continue // ya reportado por el test de existencia

      it(`${file.key}: la firma binaria coincide con mimeTypeFor() (no es HTML/SVG/contenido corrupto)`, () => {
        const firma = leerFirma(absolutePath)
        const mime = mimeTypeFor(file.relativePath)
        if (mime === 'image/jpeg') {
          expect(esJpegPorFirma(firma), `${file.key}: no empieza con la firma JPEG (FF D8 FF)`).toBe(true)
        } else {
          expect(esWebpPorFirma(firma), `${file.key}: no tiene la firma RIFF/WEBP`).toBe(true)
        }
      })

      it(`${file.key}: sharp lee el formato real y coincide con la extensión`, async () => {
        const metadata = await sharp(absolutePath).metadata()
        const extensionEsperada = mimeTypeFor(file.relativePath) === 'image/jpeg' ? 'jpeg' : 'webp'
        expect(metadata.format, `${file.key}: sharp reporta formato '${metadata.format}'`).toBe(extensionEsperada)
      })

      it(`${file.key}: dimensiones dentro de un rango razonable (${MIN_DIM}-${MAX_DIM}px)`, async () => {
        const metadata = await sharp(absolutePath).metadata()
        expect(metadata.width, `${file.key}: ancho fuera de rango`).toBeGreaterThanOrEqual(MIN_DIM)
        expect(metadata.width, `${file.key}: ancho fuera de rango`).toBeLessThanOrEqual(MAX_DIM)
        expect(metadata.height, `${file.key}: alto fuera de rango`).toBeGreaterThanOrEqual(MIN_DIM)
        expect(metadata.height, `${file.key}: alto fuera de rango`).toBeLessThanOrEqual(MAX_DIM)
      })
    }
  })
})
