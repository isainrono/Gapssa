import type { AccessArgs } from 'payload'
import { describe, expect, it } from 'vitest'

import { isAdmin, isAdminOrEditor, isAdminOrReadingSelf, onlyAdminCanSetField } from './roles'

/**
 * `AccessArgs['req']` es `PayloadRequest`, un tipo enorme (conexión DB,
 * i18n, headers…) que ningún helper de `roles.ts` lee salvo `req.user`.
 * Construir uno real aquí acoplaría estas pruebas a la forma interna de
 * Payload sin aportar nada; se castea un objeto mínimo en su lugar, igual
 * que haría cualquier caller real de estas funciones de acceso.
 */
function args(user: Record<string, unknown> | null, id?: number | string): AccessArgs {
  return { id, req: { user } } as unknown as AccessArgs
}

/** `onlyAdminCanSetField` es `FieldAccess`, no `Access` — mismo `req.user`, forma distinta de argumentos. */
function fieldArgs(user: Record<string, unknown> | null): Parameters<typeof onlyAdminCanSetField>[0] {
  return { req: { user } } as unknown as Parameters<typeof onlyAdminCanSetField>[0]
}

const admin = { collection: 'users', id: 1, role: 'admin' }
const editor = { collection: 'users', id: 2, role: 'editor' }

describe('isAdminOrEditor', () => {
  it('autoriza a un admin', () => {
    expect(isAdminOrEditor(args(admin))).toBe(true)
  })

  it('autoriza a un editor', () => {
    expect(isAdminOrEditor(args(editor))).toBe(true)
  })

  it('rechaza a un usuario anónimo (sin req.user)', () => {
    expect(isAdminOrEditor(args(null))).toBe(false)
  })

  it('rechaza a un usuario autenticado de otra colección', () => {
    expect(isAdminOrEditor(args({ collection: 'clientes-portal', id: 9, role: 'admin' }))).toBe(false)
  })

  it('rechaza a un usuario interno sin role (undefined)', () => {
    expect(isAdminOrEditor(args({ collection: 'users', id: 3 }))).toBe(false)
  })

  it('rechaza a un usuario interno con role null', () => {
    expect(isAdminOrEditor(args({ collection: 'users', id: 3, role: null }))).toBe(false)
  })

  it('rechaza a un usuario interno con role vacío', () => {
    expect(isAdminOrEditor(args({ collection: 'users', id: 3, role: '' }))).toBe(false)
  })

  it('rechaza un role desconocido', () => {
    expect(isAdminOrEditor(args({ collection: 'users', id: 3, role: 'superadmin' }))).toBe(false)
  })
})

describe('isAdmin', () => {
  it('autoriza a un admin', () => {
    expect(isAdmin(args(admin))).toBe(true)
  })

  it('rechaza a un editor', () => {
    expect(isAdmin(args(editor))).toBe(false)
  })

  it('rechaza a un usuario anónimo', () => {
    expect(isAdmin(args(null))).toBe(false)
  })

  it('rechaza un role desconocido', () => {
    expect(isAdmin(args({ collection: 'users', id: 3, role: 'superadmin' }))).toBe(false)
  })
})

describe('isAdminOrReadingSelf', () => {
  it('editor puede leer su propia ficha', () => {
    expect(isAdminOrReadingSelf(args(editor, editor.id))).toBe(true)
  })

  it('editor no puede leer otra ficha', () => {
    expect(isAdminOrReadingSelf(args(editor, admin.id))).toBe(false)
  })

  it('admin puede leer cualquier ficha', () => {
    expect(isAdminOrReadingSelf(args(admin, editor.id))).toBe(true)
  })

  it('admin puede leer sin id (listado, filtra por su propio criterio)', () => {
    expect(isAdminOrReadingSelf(args(admin))).toBe(true)
  })

  it('rechaza a un usuario anónimo', () => {
    expect(isAdminOrReadingSelf(args(null, 1))).toBe(false)
  })

  it('un usuario interno sin role válido no puede leer ni su propia ficha', () => {
    const sinRole = { collection: 'users', id: 5 }
    expect(isAdminOrReadingSelf(args(sinRole, 5))).toBe(false)
  })

  it('editor sin id explícito recibe un filtro por su propio id, no acceso total', () => {
    const result = isAdminOrReadingSelf(args(editor))
    expect(result).toEqual({ id: { equals: editor.id } })
  })
})

describe('onlyAdminCanSetField', () => {
  it('permite a un admin fijar el campo role', () => {
    expect(onlyAdminCanSetField(fieldArgs(admin))).toBe(true)
  })

  it('rechaza a un editor', () => {
    expect(onlyAdminCanSetField(fieldArgs(editor))).toBe(false)
  })

  it('rechaza a un usuario sin role', () => {
    expect(onlyAdminCanSetField(fieldArgs({ collection: 'users', id: 5 }))).toBe(false)
  })
})
