/**
 * Valida un destino de redirección ("volver a X tras iniciar sesión")
 * para impedir un open redirect (`PLAN_DESARROLLO_WEB_PORTAL.md` §15:
 * "validación estricta de redirecciones"). Función pura, sin
 * dependencias de Next.js — usable tanto en rutas API como en
 * componentes.
 *
 * Estrategia: resolver el candidato contra un origen fijo arbitrario y
 * comprobar que el origen resultante no cambió. Cualquier candidato que
 * incluya un esquema (`https://evil.com`), sea protocol-relative
 * (`//evil.com`) o use el truco de barra invertida (`/\evil.com`, que
 * algunos navegadores normalizan como `//evil.com`) resuelve a un origen
 * distinto y se rechaza — más robusto que una lista de prefijos
 * prohibidos, porque no depende de anticipar cada variante.
 */
const SAFE_RESOLUTION_BASE = 'http://internal.invalid'

export function sanitizeRedirectTarget(candidate: string | null | undefined, fallback: string): string {
  if (!candidate || candidate.trim().length === 0) {
    return fallback
  }

  if (!candidate.startsWith('/') || candidate.startsWith('//')) {
    return fallback
  }

   
  if (/[\x00-\x1f]/.test(candidate)) {
    return fallback
  }

  try {
    const resolved = new URL(candidate, SAFE_RESOLUTION_BASE)
    if (resolved.origin !== SAFE_RESOLUTION_BASE) {
      return fallback
    }
  } catch {
    return fallback
  }

  return candidate
}
