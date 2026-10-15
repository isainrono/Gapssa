import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const FOTOS_DIR = path.resolve('fotos')
const IMAGES_DIR = path.resolve('apps/web/public/images')

// Mapeo exhaustivo de archivos en fotos/ hacia su destino en apps/web/public/images/
const MAPPING = [
  // Faciales
  { src: 'limpiezaFacialProfunda.jpg', dest: 'faciales/limpieza-facial-profunda.jpeg' },
  { src: 'MesoterapiaFacial.jpg', dest: 'faciales/mesoterapia-estetica.jpeg' },
  { src: 'Micronedeedling.jpg', dest: 'faciales/microneedling.jpeg' },
  { src: 'RadiofrecuenciaFacial.jpg', dest: 'faciales/radiofrecuencia-facial.jpeg' },
  { src: 'Peeling PRX.jpg', dest: 'faciales/peeling-prx.jpeg' },
  { src: 'Skinpen.jpeg', dest: 'faciales/skinpen.jpeg' },
  { src: 'TratamientosFaciales.jpg', dest: 'faciales/tratamientos-faciales.jpeg' },

  // Pestañas y cejas
  { src: 'Lifting de pestañas.jpg', dest: 'pestanas-cejas/lifting-pestanas-tinte.jpeg' },

  // Depilación facial y corporal
  { src: 'DepilacionMentonCera.jpg', dest: 'depilacion/depilacion-menton.jpeg' },
  { src: 'DepilacionPatillasCera.jpg', dest: 'depilacion/depilacion-patillas.jpeg' },
  { src: 'MediosBrazosCera.jpg', dest: 'depilacion/depilacion-medio-brazo.jpeg' },
  { src: 'PechoCera.jpg', dest: 'depilacion/depilacion-pecho.jpeg' },
  { src: 'GluteosCera.jpg', dest: 'depilacion/depilacion-gluteos.jpeg' },
  { src: 'InglesBrasilenasCera.jpg', dest: 'depilacion/depilacion-ingles-brasilenas.jpeg' },
  { src: 'InglesNormales.jpeg', dest: 'depilacion/depilacion-ingles-normales.jpeg' },
  { src: 'InglesIntegralCera.jpg', dest: 'depilacion/depilacion-ingles-integrales.jpeg' },

  // Centro / Instalaciones
  { src: 'centro.jpeg', dest: 'marca/centro.jpeg' },
  { src: 'centro.jpeg', dest: 'stock/hero-centro.jpg' },

  // Depilación láser
  { src: 'InglesLaser.jpg', dest: 'depilacion-laser/laser-ingles-integrales.jpeg' },
  { src: 'GluteosLaser.jpg', dest: 'depilacion-laser/laser-gluteos.jpeg' },
  { src: 'DepilacionLaser.jpg', dest: 'depilacion-laser/depilacion-laser.jpeg' },

  // Uñas / Manos y pies
  { src: 'ParafinaDeManos.jpg', dest: 'unas/parafina-manos.jpeg' },
  { src: 'pedicuraExpress.jpg', dest: 'unas/pedicura-express.jpeg' },
  { src: 'uñas.jpg', dest: 'unas/unas.jpeg' },

  // Masajes y corporal
  { src: 'MasajeDeportivo.jpg', dest: 'masajes/masaje-deportivo.jpeg' },
  { src: 'DrenajePrenatal.jpg', dest: 'masajes/masaje-prenatal.jpeg' },
  { src: 'MasajeAromaterapia.jpg', dest: 'masajes/masaje-aromaterapia.jpeg' },
  { src: 'MasajePiernasCansadas.jpg', dest: 'masajes/masaje-piernas-cansadas.jpeg' },
  { src: 'MasajePiedrasCalientes.jpg', dest: 'masajes/masaje-piedras-calientes.jpeg' },
  { src: 'DrenajeManual.jpg', dest: 'masajes/drenaje-manual.jpeg' },
  { src: 'Presoterapia.jpg', dest: 'masajes/presoterapia.jpeg' },
  { src: 'PresoterapiaMasaje.jpg', dest: 'masajes/presoterapia-masaje.jpeg' },
  { src: 'LipolaserRadiofrecuencia.jpg', dest: 'masajes/lipolaser-radiofrecuencia.jpeg' },
  { src: 'Vacum.jpg', dest: 'masajes/vacum.jpeg' },
  { src: 'LaserFisio.jpg', dest: 'masajes/laser-fisio-dolor.jpeg' },
]

async function processAll() {
  const dirFiles = fs.readdirSync(FOTOS_DIR)

  for (const item of MAPPING) {
    // Normalizar para lidiar con combinaciones Unicode (e.g. ñ vs n+~)
    const foundName = dirFiles.find(
      (f) => f.normalize('NFC') === item.src.normalize('NFC') || f.normalize('NFD') === item.src.normalize('NFD')
    )

    if (!foundName) {
      console.error(`❌ No se encontró en fotos/: ${item.src}`)
      continue
    }

    const srcPath = path.join(FOTOS_DIR, foundName)
    const destPath = path.join(IMAGES_DIR, item.dest)
    fs.mkdirSync(path.dirname(destPath), { recursive: true })

    await sharp(srcPath)
      .rotate() // Respeta la orientación EXIF de las cámaras Samsung
      .jpeg({ quality: 90, mozjpeg: true })
      .toFile(destPath)

    const stat = fs.statSync(destPath)
    console.log(`✅ Procesado: ${foundName} -> ${item.dest} (${Math.round(stat.size / 1024)} KB)`)
  }
}

processAll().catch((err) => {
  console.error(err)
  process.exit(1)
})
