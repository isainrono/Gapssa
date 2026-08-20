import type { ContenidoSobreGapssa } from '@/payload-types'

import { DiferenciadorIcon } from '@/components/server/icons/DiferenciadorIcon'

import { SectionHeading } from './SectionHeading'
import styles from './DiferenciadoresSection.module.css'

type Props = {
  items: NonNullable<ContenidoSobreGapssa['diferenciadores']>
  eyebrow: string
  title: string
}

/** Sección de fondo oscuro — se incluye a sí misma como `<section>` con padding, no solo el grid. */
export function DiferenciadoresSection({ items, eyebrow, title }: Props) {
  if (items.length === 0) {
    return null
  }
  return (
    <section className={`section ${styles.section}`}>
      <div className="container">
        <SectionHeading eyebrow={eyebrow} title={title} dark />
        <div className={styles.grid}>
          {items.map((item) => (
            <div key={item.id} className={styles.card}>
              <DiferenciadorIcon icono={item.iconoClave} />
              <h3>{item.titulo}</h3>
              <p>{item.descripcion}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
