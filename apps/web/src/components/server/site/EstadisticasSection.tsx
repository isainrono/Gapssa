import type { ContenidoSobreGapssa } from '@/payload-types'

import styles from './EstadisticasSection.module.css'

type Props = {
  estadisticas: NonNullable<ContenidoSobreGapssa['estadisticas']>
}

/** Vacío por defecto (`ContenidoSobreGapssa.ts`) — no se muestra nada hasta que Gapssa confirme cifras reales. */
export function EstadisticasSection({ estadisticas }: Props) {
  if (estadisticas.length === 0) {
    return null
  }
  return (
    <div className={styles.row}>
      {estadisticas.map((item) => (
        <div key={item.id} className={styles.item}>
          <p className={styles.valor}>{item.valor}</p>
          <p className={styles.etiqueta}>{item.etiqueta}</p>
        </div>
      ))}
    </div>
  )
}
