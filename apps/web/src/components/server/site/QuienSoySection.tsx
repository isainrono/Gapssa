import Image from 'next/image'
import Link from 'next/link'

import { mediaAlt, mediaUrl } from '@/lib/content/media'
import type { ContenidoSobreGapssa } from '@/payload-types'

import { RevealOnScroll } from '@/components/client/RevealOnScroll'

import styles from './QuienSoySection.module.css'

type Props = {
  sobreGapssa: ContenidoSobreGapssa
  eyebrow: string
  cta?: { href: string; label: string }
}

/**
 * Reutilizado por la portada (teaser, con `cta`) y `/sobre-gapssa`
 * (versión completa, sin `cta`) — misma fuente de datos
 * (`contenido-sobre-gapssa`), sin duplicar el marcado en dos sitios.
 */
export function QuienSoySection({ sobreGapssa, eyebrow, cta }: Props) {
  const imgUrl = mediaUrl(sobreGapssa.bioImagen) || '/images/equipo/diana.jpg'
  const altText = mediaAlt(sobreGapssa.bioImagen) || 'Diana, fundadora y especialista en belleza de GAPSSA by Nana'

  return (
    <div className={styles.grid}>
      <RevealOnScroll className={styles.photo}>
        <Image src={imgUrl} alt={altText} fill sizes="(min-width: 900px) 40vw, 90vw" />
      </RevealOnScroll>
      <div className={styles.body}>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{sobreGapssa.bioTitulo}</h2>
        {sobreGapssa.bioTexto ? <p>{sobreGapssa.bioTexto}</p> : null}
        {sobreGapssa.bioCita ? <blockquote>&ldquo;{sobreGapssa.bioCita}&rdquo;</blockquote> : null}
        {sobreGapssa.bioBullets && sobreGapssa.bioBullets.length > 0 ? (
          <ul className={styles.bullets}>
            {sobreGapssa.bioBullets.map((bullet) => (
              <li key={bullet.id}>
                <span className={styles.bulletDot} />
                <span>{bullet.texto}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {cta ? (
          <Link href={cta.href} className={styles.ctaButton}>
            {cta.label}
          </Link>
        ) : null}
      </div>
    </div>
  )
}
