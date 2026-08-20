import type { ContenidoSobreGapssa } from '@/payload-types'

import { SectionHeading } from './SectionHeading'
import styles from './ProcesoSection.module.css'

type Props = {
  pasos: NonNullable<ContenidoSobreGapssa['proceso']>
  eyebrow: string
  title: string
}

export function ProcesoSection({ pasos, eyebrow, title }: Props) {
  if (pasos.length === 0) {
    return null
  }
  return (
    <>
      <SectionHeading eyebrow={eyebrow} title={title} />
      <div className={styles.grid}>
        {pasos.map((paso) => (
          <div key={paso.id} className={styles.step}>
            <div className={styles.circle}>{String(paso.numero).padStart(2, '0')}</div>
            <h3>{paso.titulo}</h3>
            <p>{paso.descripcion}</p>
          </div>
        ))}
      </div>
    </>
  )
}
