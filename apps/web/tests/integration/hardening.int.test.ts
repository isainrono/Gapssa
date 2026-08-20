import { beforeAll, describe, expect, it } from 'vitest'

import { api, assertNoSensitiveFields, login } from './client'

/**
 * Suite de integración reproducible del endurecimiento de Fase 1 (y, desde
 * "Colecciones de contenido (Fase 2)" más abajo, de las colecciones
 * públicas de Fase 2, que reutilizan el mismo control de acceso): arranca
 * (ver `global-setup.ts`) un `next dev` real contra una base de datos
 * Postgres aislada y creada para esta ejecución (nunca `gapssa_cms`), y la
 * destruye entera al terminar — incluso si una aserción falla, porque el
 * `DROP DATABASE` vive en el `teardown` que Vitest ejecuta siempre tras la
 * suite, no en un `afterEach` que un `throw` pueda saltarse. Por eso
 * ningún test de aquí abajo borra "a mano" lo que crea: no hace falta.
 *
 * Nunca toca EspoCRM ni el Postgres/administrador manual de desarrollo
 * (`gapssa_cms`): usa exclusivamente la base efímera que crea el setup.
 *
 * Los `describe` se ejecutan en el orden declarado (Vitest no paraleliza
 * `it`/`describe` dentro de un fichero por defecto, y
 * `vitest.integration.config.ts` fija además `fileParallelism: false`)
 * porque el estado es acumulativo a propósito: "Bootstrap" necesita una
 * base con cero usuarios, y los bloques siguientes reutilizan el admin y
 * el editor que "Bootstrap"/"Editor" crean.
 */

type UserBody = { email: string; id: number | string; role?: string }
type LoginBody = { token: string; user: UserBody }

const BOOTSTRAP_ADMIN = { email: 'bootstrap-admin@integration.test', password: 'Integration-Test-1234!' }
const SECOND_ADMIN = { email: 'second-admin@integration.test', password: 'Integration-Test-1234!' }
const THIRD_ADMIN = { email: 'third-admin@integration.test', password: 'Integration-Test-1234!' }
const EDITOR = { email: 'editor@integration.test', password: 'Integration-Test-1234!' }

let adminToken: string
let adminId: UserBody['id']
let editorToken: string
let editorId: UserBody['id']

describe('Bootstrap', () => {
  it('con cero usuarios, first-register crea el primer usuario', async () => {
    const { body, status } = await api.post('/api/users/first-register', {
      ...BOOTSTRAP_ADMIN,
      // Se envía a propósito un role distinto de admin: el hook debe
      // ignorarlo y forzar 'admin' de todas formas (protectAdminRoleOnChange).
      role: 'editor',
    })
    expect(status).toBe(200)
    assertNoSensitiveFields(body)

    const { user } = body as unknown as LoginBody
    expect(user.email).toBe(BOOTSTRAP_ADMIN.email)
    adminId = user.id
  })

  it('el primer usuario queda forzado a role=admin', async () => {
    adminToken = await login(BOOTSTRAP_ADMIN.email, BOOTSTRAP_ADMIN.password)
    const { body, status } = await api.get('/api/users/me', adminToken)
    expect(status).toBe(200)
    const { user } = body as unknown as { user: UserBody }
    expect(user.role).toBe('admin')
  })

  it('un segundo intento de first-register es rechazado', async () => {
    const { status } = await api.post('/api/users/first-register', {
      email: 'segundo-bootstrap@integration.test',
      password: 'Integration-Test-1234!',
    })
    expect(status).toBe(403)
  })
})

describe('Usuarios anónimos', () => {
  it('no pueden listar users', async () => {
    const { status } = await api.get('/api/users')
    expect(status).toBe(403)
  })

  it('no pueden leer un user', async () => {
    const { status } = await api.get(`/api/users/${adminId}`)
    expect(status).toBe(403)
  })

  it('no pueden crear users mediante REST', async () => {
    const { status } = await api.post('/api/users', {
      email: 'intruso@integration.test',
      password: 'Integration-Test-1234!',
    })
    expect(status).toBe(403)
  })

  it('no pueden actualizar users', async () => {
    const { status } = await api.patch(`/api/users/${adminId}`, { role: 'admin' })
    expect(status).toBe(403)
  })

  it('no pueden eliminar users', async () => {
    const { status } = await api.delete(`/api/users/${adminId}`)
    expect(status).toBe(403)
  })

  it('no obtienen información sensible en el rechazo', async () => {
    const { body } = await api.get(`/api/users/${adminId}`)
    assertNoSensitiveFields(body)
  })
})

describe('Editor', () => {
  beforeAll(async () => {
    const { body, status } = await api.post(
      '/api/users',
      { ...EDITOR, role: 'editor' },
      adminToken,
    )
    expect(status).toBe(201)
    editorId = (body.doc as UserBody).id
    editorToken = await login(EDITOR.email, EDITOR.password)
  })

  it('puede autenticarse y usar /api/users/me', async () => {
    const { body, status } = await api.get('/api/users/me', editorToken)
    expect(status).toBe(200)
    const { user } = body as unknown as { user: UserBody }
    expect(user.email).toBe(EDITOR.email)
    expect(user.role).toBe('editor')
    assertNoSensitiveFields(body)
  })

  it('solo puede leer su propia ficha', async () => {
    const own = await api.get(`/api/users/${editorId}`, editorToken)
    expect(own.status).toBe(200)
  })

  it('no puede enumerar otros usuarios', async () => {
    const list = await api.get('/api/users', editorToken)
    expect(list.status).toBe(200)
    const docs = list.body.docs as UserBody[]
    expect(docs.map((doc) => doc.id)).toEqual([editorId])
  })

  it('no puede leer la ficha de otro usuario', async () => {
    const { status } = await api.get(`/api/users/${adminId}`, editorToken)
    expect(status).toBe(403)
  })

  it('no puede crear usuarios', async () => {
    const { status } = await api.post(
      '/api/users',
      { email: 'otro-editor@integration.test', password: 'Integration-Test-1234!' },
      editorToken,
    )
    expect(status).toBe(403)
  })

  it('no puede cambiar su role ni elevarse a admin', async () => {
    const { status } = await api.patch(`/api/users/${editorId}`, { role: 'admin' }, editorToken)
    expect(status).toBe(403)
  })

  it('no puede eliminar usuarios', async () => {
    const { status } = await api.delete(`/api/users/${editorId}`, editorToken)
    expect(status).toBe(403)
  })
})

describe('Protección del último administrador', () => {
  let secondAdminId: UserBody['id']

  it('admin puede crear otro admin', async () => {
    const { body, status } = await api.post(
      '/api/users',
      { ...SECOND_ADMIN, role: 'admin' },
      adminToken,
    )
    expect(status).toBe(201)
    secondAdminId = (body.doc as UserBody).id
  })

  it('con dos administradores, puede degradar uno a editor', async () => {
    const { status } = await api.patch(`/api/users/${secondAdminId}`, { role: 'editor' }, adminToken)
    expect(status).toBe(200)
  })

  it('no puede degradar al último administrador restante', async () => {
    const { body, status } = await api.patch(`/api/users/${adminId}`, { role: 'editor' }, adminToken)
    expect(status).toBe(403)
    expect(JSON.stringify(body)).toMatch(/último administrador/)
  })

  it('no puede eliminar al último administrador restante', async () => {
    const { body, status } = await api.delete(`/api/users/${adminId}`, adminToken)
    expect(status).toBe(403)
    expect(JSON.stringify(body)).toMatch(/último administrador/)
  })

  it('con dos administradores, puede eliminar uno', async () => {
    const promote = await api.patch(`/api/users/${secondAdminId}`, { role: 'admin' }, adminToken)
    expect(promote.status).toBe(200)

    const { status } = await api.delete(`/api/users/${secondAdminId}`, adminToken)
    expect(status).toBe(200)
  })

  /**
   * Prueba de la carrera real (no solo del caso secuencial de arriba): con
   * exactamente dos administradores, cada uno intenta degradar al OTRO al
   * mismo tiempo (`Promise.all`, no una tras otra) — así el chequeo "¿es
   * admin quien pide esto?" de cada petición se resuelve contra un
   * administrador que sigue siendo admin en ese instante, sin importar el
   * orden real de ejecución, y la única variable en juego es el bloqueo de
   * `lockAdminRowsForUpdate` (`collections/hooks/protectAdminRole.ts`).
   * Con ese bloqueo, el resultado es determinista: una transacción
   * confirma primero y la otra, al desbloquearse, relee el estado ya
   * actualizado y se rechaza — nunca las dos a la vez. Sin el bloqueo (la
   * versión anterior de este hook, un `count` suelto) este test sería
   * intermitente: fallaría solo alguna de cada varias ejecuciones,
   * exactamente el tipo de fallo que un test puramente secuencial nunca
   * detecta.
   */
  it('dos peticiones concurrentes degradando a los dos únicos administradores: como mucho una gana', async () => {
    const created = await api.post('/api/users', { ...THIRD_ADMIN, role: 'admin' }, adminToken)
    expect(created.status).toBe(201)
    const thirdAdminId = (created.body.doc as UserBody).id
    const thirdAdminToken = await login(THIRD_ADMIN.email, THIRD_ADMIN.password)

    const [a, b] = await Promise.all([
      api.patch(`/api/users/${thirdAdminId}`, { role: 'editor' }, adminToken),
      api.patch(`/api/users/${adminId}`, { role: 'editor' }, thirdAdminToken),
    ])

    expect([a.status, b.status].sort()).toEqual([200, 403])

    const survivorToken = a.status === 200 ? adminToken : thirdAdminToken
    const list = await api.get('/api/users', survivorToken)
    expect(list.status).toBe(200)
    const remainingAdmins = (list.body.docs as UserBody[]).filter((user) => user.role === 'admin')
    expect(remainingAdmins).toHaveLength(1)
  })
})

describe('Contenido', () => {
  let publishedId: string
  let draftId: string

  it('editor puede crear contenido (como borrador)', async () => {
    const { body, status } = await api.post(
      '/api/verificacion-contenido',
      { titulo: 'Borrador de integración', _status: 'draft' },
      editorToken,
    )
    expect(status).toBe(201)
    draftId = (body.doc as { id: string }).id
  })

  it('editor puede actualizar contenido existente', async () => {
    const { body, status } = await api.patch(
      `/api/verificacion-contenido/${draftId}`,
      { titulo: 'Borrador de integración (editado)' },
      editorToken,
    )
    expect(status).toBe(200)
    expect((body.doc as { titulo: string }).titulo).toBe('Borrador de integración (editado)')
  })

  it('editor puede crear contenido ya publicado', async () => {
    const { body, status } = await api.post(
      '/api/verificacion-contenido',
      { titulo: 'Publicado de integración', _status: 'published' },
      editorToken,
    )
    expect(status).toBe(201)
    publishedId = (body.doc as { id: string }).id
  })

  it('anónimo puede leer contenido published', async () => {
    const { body, status } = await api.get(`/api/verificacion-contenido/${publishedId}`)
    expect(status).toBe(200)
    expect(body.titulo).toBe('Publicado de integración')
  })

  it('anónimo no puede leer contenido draft', async () => {
    const { status } = await api.get(`/api/verificacion-contenido/${draftId}`)
    expect(status).toBe(404)
  })

  it('anónimo no puede crear, actualizar ni borrar contenido', async () => {
    const create = await api.post('/api/verificacion-contenido', { titulo: 'Intruso', _status: 'published' })
    expect(create.status).toBe(403)

    const update = await api.patch(`/api/verificacion-contenido/${publishedId}`, { titulo: 'Hackeado' })
    expect(update.status).toBe(403)

    const del = await api.delete(`/api/verificacion-contenido/${publishedId}`)
    expect(del.status).toBe(403)
  })

  it('editor no puede eliminar contenido (reservado a admin)', async () => {
    const { status } = await api.delete(`/api/verificacion-contenido/${publishedId}`, editorToken)
    expect(status).toBe(403)
  })

  it('admin puede eliminar contenido', async () => {
    const { status } = await api.delete(`/api/verificacion-contenido/${draftId}`, adminToken)
    expect(status).toBe(200)
  })
})

const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

/**
 * Convención REST de Payload para `multipart/form-data`: los campos que no
 * son el archivo van como un único JSON en `_payload`, no como campos de
 * formulario sueltos (`node_modules/payload/dist/utilities/upload.js`).
 */
function onePixelPngForm(alt: string): FormData {
  const form = new FormData()
  form.append('_payload', JSON.stringify({ alt }))
  form.append('file', new Blob([Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64')], { type: 'image/png' }), 'integration-test.png')
  return form
}

/**
 * `media` (Fase 2): lectura pública real (activos de marketing, no datos
 * sensibles — `Media.ts`), a diferencia de todas las demás colecciones de
 * esta suite. Escritura reservada a admin/editor igual que el resto.
 * `mediaId` se reutiliza más abajo para `galeria` (su campo `imagen` es
 * obligatorio).
 */
let mediaId: string

describe('Media (Fase 2)', () => {
  it('editor puede subir un archivo (multipart real)', async () => {
    const { status, body } = await api.upload('/api/media', onePixelPngForm('Imagen de integración'), editorToken)
    expect(status).toBe(201)
    mediaId = (body.doc as { id: string }).id
  })

  it('anónimo puede leer media (activos públicos, no un dato sensible)', async () => {
    const { status } = await api.get('/api/media')
    expect(status).toBe(200)
  })

  it('anónimo no puede crear media', async () => {
    const { status } = await api.upload('/api/media', onePixelPngForm('Intruso'))
    expect(status).toBe(403)
  })

  it('anónimo no puede eliminar media', async () => {
    const { status } = await api.delete(`/api/media/${mediaId}`)
    expect(status).toBe(403)
  })
})

/**
 * `familias-tratamiento`, `tratamientos`, `testimonios`, `galeria`,
 * `paginas-legales` (Fase 2) comparten literalmente `publicContentAccess`
 * (`collections/access/content.ts`) — la matriz completa de acceso ya
 * queda probada arriba contra `verificacion-contenido`, que usa la misma
 * función. Aquí se comprueba que cada colección nueva está realmente
 * conectada a ese control (no solo declarada) y el comportamiento propio
 * de Fase 2 que ninguna prueba anterior cubre: recuperación de campos
 * localizados por `locale` y que un borrador nunca aparece en un listado
 * público, colección por colección.
 */
describe('Colecciones de contenido (Fase 2)', () => {
  let familiaId: string

  it('editor crea una familia con título distinto por idioma', async () => {
    const created = await api.post(
      '/api/familias-tratamiento',
      {
        slug: 'integracion-familia',
        titulo: 'Familia de integración',
        orden: 999,
        visible: true,
        _status: 'published',
      },
      editorToken,
    )
    expect(created.status).toBe(201)
    familiaId = (created.body.doc as { id: string }).id

    const translated = await api.patch(
      `/api/familias-tratamiento/${familiaId}?locale=en`,
      { titulo: 'Integration family' },
      editorToken,
    )
    expect(translated.status).toBe(200)
  })

  it('cada idioma devuelve su propio título', async () => {
    const es = await api.get(`/api/familias-tratamiento/${familiaId}?locale=es`)
    expect(es.body.titulo).toBe('Familia de integración')

    const en = await api.get(`/api/familias-tratamiento/${familiaId}?locale=en`)
    expect(en.body.titulo).toBe('Integration family')
  })

  it('anónimo lee la familia publicada', async () => {
    const { status } = await api.get(`/api/familias-tratamiento/${familiaId}`)
    expect(status).toBe(200)
  })

  it('anónimo no puede crear ni eliminar familias', async () => {
    const create = await api.post('/api/familias-tratamiento', { slug: 'intruso', titulo: 'Intruso', orden: 0 })
    expect(create.status).toBe(403)

    const del = await api.delete(`/api/familias-tratamiento/${familiaId}`)
    expect(del.status).toBe(403)
  })

  it('editor no puede eliminar una familia (reservado a admin)', async () => {
    const { status } = await api.delete(`/api/familias-tratamiento/${familiaId}`, editorToken)
    expect(status).toBe(403)
  })

  it('un tratamiento en borrador no aparece en el listado público', async () => {
    const draft = await api.post(
      '/api/tratamientos',
      {
        slug: 'integracion-tratamiento-borrador',
        familia: familiaId,
        titulo: 'Tratamiento borrador de integración',
        indicadorPrecio: 'consultar',
        visible: true,
        destacado: false,
        orden: 0,
        _status: 'draft',
      },
      editorToken,
    )
    expect(draft.status).toBe(201)
    const draftId = (draft.body.doc as { id: string }).id

    const anonList = await api.get('/api/tratamientos?limit=200')
    const ids = (anonList.body.docs as { id: string }[]).map((doc) => doc.id)
    expect(ids).not.toContain(draftId)

    const anonRead = await api.get(`/api/tratamientos/${draftId}`)
    expect(anonRead.status).toBe(404)
  })

  it.each([
    // `autorizacionRegistrada: true`: sin ella, `requireAutorizacionParaPublicar`
    // (`collections/hooks/testimonioAuthorization.ts`, revisión 2 de Fase 2)
    // rechaza publicar/hacer visible un testimonio — ese comportamiento se
    // prueba aparte, en el describe "Autorización de testimonios" más abajo.
    // Aquí el objetivo es la matriz de acceso genérica (crear/leer/eliminar),
    // igual que para `galeria`.
    ['testimonios', () => ({ texto: 'Texto de integración', autor: 'Integración T.', orden: 0, autorizacionRegistrada: true })],
    // `imagen` se resuelve en ejecución, no al registrar la tabla: `mediaId`
    // solo existe una vez que ha corrido "Media (Fase 2)" (bloque anterior
    // en este mismo fichero, ejecución secuencial garantizada).
    ['galeria', () => ({ alt: 'Alt de integración', categoria: 'Integración', orden: 0, imagen: mediaId })],
  ] as const)('%s: editor crea publicado, anónimo lo lee y no puede eliminarlo', async (collection, buildExtra) => {
    const created = await api.post(`/api/${collection}`, { ...buildExtra(), visible: true, _status: 'published' }, editorToken)
    expect(created.status).toBe(201)
    const id = (created.body.doc as { id: string }).id

    const anonRead = await api.get(`/api/${collection}/${id}`)
    expect(anonRead.status).toBe(200)

    const anonDelete = await api.delete(`/api/${collection}/${id}`)
    expect(anonDelete.status).toBe(403)

    const adminDelete = await api.delete(`/api/${collection}/${id}`, adminToken)
    expect(adminDelete.status).toBe(200)
  })

  it('paginas-legales: anónimo lee, no puede escribir; admin elimina', async () => {
    // `tipo` es único en el esquema y esta base efímera es compartida con
    // `seed.int.test.ts` (fileParallelism: false, pero sin orden de
    // ficheros garantizado) — si el seed ya creó "aviso-legal" antes, se
    // limpia primero para que esta prueba sea determinista sin importar el
    // orden real de ejecución de los ficheros.
    const existing = await api.get('/api/paginas-legales?where[tipo][equals]=aviso-legal&limit=1')
    const existingDoc = (existing.body.docs as { id: string }[] | undefined)?.[0]
    if (existingDoc) {
      await api.delete(`/api/paginas-legales/${existingDoc.id}`, adminToken)
    }

    const created = await api.post(
      '/api/paginas-legales',
      {
        tipo: 'aviso-legal',
        titulo: 'Aviso legal de integración',
        contenido: 'Texto de prueba.',
        version: '0.1',
        fecha: new Date().toISOString(),
        estado: 'provisional',
        seoNoIndex: true,
        _status: 'published',
      },
      editorToken,
    )
    expect(created.status).toBe(201)
    const id = (created.body.doc as { id: string }).id

    const anonRead = await api.get(`/api/paginas-legales/${id}`)
    expect(anonRead.status).toBe(200)

    const anonWrite = await api.patch(`/api/paginas-legales/${id}`, { titulo: 'Hackeado' })
    expect(anonWrite.status).toBe(403)

    const adminDelete = await api.delete(`/api/paginas-legales/${id}`, adminToken)
    expect(adminDelete.status).toBe(200)
  })
})

/**
 * `requireAutorizacionParaPublicar` (`collections/hooks/testimonioAuthorization.ts`,
 * revisión 2 de Fase 2): un testimonio nunca debe llegar a la web pública
 * sin `autorizacionRegistrada: true`, ni siquiera por accidente (marcarlo
 * visible u olvidarlo en borrador). El hook corre en el servidor sobre
 * cualquier escritura real — no una simulación de su lógica pura
 * (`testimonioAuthorization.test.ts` ya cubre eso), sino la API real.
 */
describe('Autorización de testimonios', () => {
  it('editor no puede crear un testimonio visible sin autorización', async () => {
    const { status, body } = await api.post(
      '/api/testimonios',
      { texto: 'Sin autorización', autor: 'Sin A.', orden: 0, autorizacionRegistrada: false, visible: true, _status: 'draft' },
      editorToken,
    )
    expect(status).toBe(400)
    expect(JSON.stringify(body)).toMatch(/autorizacionRegistrada/)
  })

  it('editor no puede publicar un testimonio sin autorización, aunque no esté marcado visible', async () => {
    const { status } = await api.post(
      '/api/testimonios',
      { texto: 'Sin autorización', autor: 'Sin A.', orden: 0, autorizacionRegistrada: false, visible: false, _status: 'published' },
      editorToken,
    )
    expect(status).toBe(400)
  })

  it('editor SÍ puede crear un testimonio de ejemplo en borrador, no visible y sin autorización (el patrón del seed)', async () => {
    const { status, body } = await api.post(
      '/api/testimonios',
      { texto: 'Ejemplo de desarrollo', autor: 'Ejemplo E.', orden: 0, autorizacionRegistrada: false, visible: false, _status: 'draft' },
      editorToken,
    )
    expect(status).toBe(201)
    const id = (body.doc as { id: string }).id

    // Nunca alcanzable por la web pública en este estado.
    const anonRead = await api.get(`/api/testimonios/${id}`)
    expect(anonRead.status).toBe(404)

    await api.delete(`/api/testimonios/${id}`, adminToken)
  })

  it('editor no puede hacer visible por PATCH un testimonio existente sin autorización', async () => {
    const created = await api.post(
      '/api/testimonios',
      { texto: 'Pendiente de autorización', autor: 'Pendiente P.', orden: 0, autorizacionRegistrada: false, visible: false, _status: 'draft' },
      editorToken,
    )
    expect(created.status).toBe(201)
    const id = (created.body.doc as { id: string }).id

    const patch = await api.patch(`/api/testimonios/${id}`, { visible: true }, editorToken)
    expect(patch.status).toBe(400)

    await api.delete(`/api/testimonios/${id}`, adminToken)
  })

  it('con autorizacionRegistrada:true, sí puede publicarse y hacerse visible, y la web pública lo devuelve', async () => {
    const created = await api.post(
      '/api/testimonios',
      { texto: 'Autorizado de verdad', autor: 'Autorizada A.', orden: 0, autorizacionRegistrada: true, visible: true, _status: 'published' },
      editorToken,
    )
    expect(created.status).toBe(201)
    const id = (created.body.doc as { id: string }).id

    const publicRead = await api.get(
      `/api/testimonios?where[and][0][_status][equals]=published&where[and][1][visible][equals]=true&where[and][2][autorizacionRegistrada][equals]=true`,
    )
    const ids = (publicRead.body.docs as { id: string }[]).map((doc) => doc.id)
    expect(ids).toContain(id)

    await api.delete(`/api/testimonios/${id}`, adminToken)
  })

  it('un testimonio de ejemplo sin autorización (borrador, no visible) nunca aparece en la consulta pública', async () => {
    const created = await api.post(
      '/api/testimonios',
      { texto: 'Ejemplo nunca público', autor: 'Nunca N.', orden: 0, autorizacionRegistrada: false, visible: false, _status: 'draft' },
      editorToken,
    )
    expect(created.status).toBe(201)
    const id = (created.body.doc as { id: string }).id

    const publicRead = await api.get(
      `/api/testimonios?where[and][0][_status][equals]=published&where[and][1][visible][equals]=true&where[and][2][autorizacionRegistrada][equals]=true`,
    )
    const ids = (publicRead.body.docs as { id: string }[]).map((doc) => doc.id)
    expect(ids).not.toContain(id)

    await api.delete(`/api/testimonios/${id}`, adminToken)
  })
})
