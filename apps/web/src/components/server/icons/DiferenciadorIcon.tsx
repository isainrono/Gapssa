import type { IconoDiferenciador } from '@/globals/ContenidoSobreGapssa'

type Props = {
  icono: IconoDiferenciador
  className?: string
}

/**
 * Iconos de línea propios (no una librería de iconos) para los 6
 * diferenciadores configurables — trazo consistente (`currentColor`,
 * `stroke-width: 1.2`) igual que el resto del sistema de diseño.
 */
export function DiferenciadorIcon({ icono, className }: Props) {
  const props = { width: 40, height: 40, viewBox: '0 0 40 40', fill: 'none', className, 'aria-hidden': true } as const
  const stroke = { stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

  switch (icono) {
    case 'atencion-personalizada':
      return (
        <svg {...props}>
          <circle cx="20" cy="15" r="6" {...stroke} />
          <path d="M6 36c0-7.2 6.3-12.6 14-12.6S34 28.8 34 36" {...stroke} />
        </svg>
      )
    case 'productos-premium':
      return (
        <svg {...props}>
          <path d="M20 5l3.4 10.6H34l-9 6.6 3.4 10.6L20 26.2l-8.4 6.6 3.4-10.6-9-6.6h10.6z" {...stroke} />
        </svg>
      )
    case 'experiencia-avalada':
      return (
        <svg {...props}>
          <rect x="8" y="5" width="24" height="30" rx="2" {...stroke} />
          <path d="M14 14h12M14 20h12M14 26h7" {...stroke} />
        </svg>
      )
    case 'cuidado-con-carino':
      return (
        <svg {...props}>
          <path d="M20 34S6 24.5 6 14a8 8 0 0114-6.5A8 8 0 0134 14c0 10.5-14 20-14 20z" {...stroke} />
        </svg>
      )
    case 'resultados-naturales':
      return (
        <svg {...props}>
          <circle cx="20" cy="20" r="13" {...stroke} />
          <path d="M13 20l5 5 9-11" {...stroke} />
        </svg>
      )
    case 'seguimiento-individual':
      return (
        <svg {...props}>
          <circle cx="20" cy="20" r="14" {...stroke} />
          <path d="M20 12v8l6 3" {...stroke} />
        </svg>
      )
    default:
      return (
        <svg {...props}>
          <circle cx="20" cy="20" r="13" {...stroke} />
        </svg>
      )
  }
}
