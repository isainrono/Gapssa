'use client'

import { useEffect, useRef, useState } from 'react'

type Props = {
  children: React.ReactNode
  className?: string
}

/**
 * Animación discreta de aparición al hacer scroll. Bajo
 * `prefers-reduced-motion: reduce`, `--motion-reveal-distance` y
 * `--motion-slow` se anulan en `tokens.css` — este componente no necesita
 * ninguna rama JS para el caso reducido, el CSS ya no mueve ni retrasa
 * nada. Si `IntersectionObserver` no está disponible, se muestra
 * directamente sin animación (nunca contenido oculto para siempre).
 */
export function RevealOnScroll({ children, className }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -10% 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} className={[className, 'reveal', visible ? 'revealVisible' : ''].filter(Boolean).join(' ')}>
      {children}
    </div>
  )
}
