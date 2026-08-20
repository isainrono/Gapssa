'use client'

import { useState } from 'react'

import type { Testimonio } from '@/payload-types'

import styles from './TestimonialsCarousel.module.css'

type Props = {
  testimonios: Testimonio[]
  anteriorLabel: string
  siguienteLabel: string
  irATestimonioLabel: string
}

/**
 * Sin autoplay a propósito: un carrusel que avanza solo incumple WCAG
 * 2.2.2 (Pause, Stop, Hide) salvo que se ofrezca control de pausa. Con
 * solo controles manuales (flechas + puntos, todos con `aria-label`), el
 * requisito no aplica y no hace falta gestionar pausa/reanudación.
 */
export function TestimonialsCarousel({ testimonios, anteriorLabel, siguienteLabel, irATestimonioLabel }: Props) {
  const [index, setIndex] = useState(0)
  const actual = testimonios[index]
  const total = testimonios.length

  if (!actual || total === 0) {
    return null
  }

  return (
    <div className={styles.wrapper}>
      <p className={styles.quote}>&ldquo;{actual.texto}&rdquo;</p>
      <div className={styles.author}>
        <span className={styles.authorLine} />
        <span>{actual.autor}</span>
        <span className={styles.authorLine} />
      </div>

      {total > 1 ? (
        <div className={styles.controls}>
          <button
            type="button"
            className={styles.arrowButton}
            aria-label={anteriorLabel}
            onClick={() => setIndex((current) => (current - 1 + total) % total)}
          >
            ‹
          </button>
          <div className={styles.dots}>
            {testimonios.map((testimonio, dotIndex) => (
              <button
                key={testimonio.id}
                type="button"
                className={`${styles.dot} ${dotIndex === index ? styles.dotActive : ''}`}
                aria-label={`${irATestimonioLabel} ${dotIndex + 1}`}
                aria-current={dotIndex === index}
                onClick={() => setIndex(dotIndex)}
              />
            ))}
          </div>
          <button
            type="button"
            className={styles.arrowButton}
            aria-label={siguienteLabel}
            onClick={() => setIndex((current) => (current + 1) % total)}
          >
            ›
          </button>
        </div>
      ) : null}
    </div>
  )
}
