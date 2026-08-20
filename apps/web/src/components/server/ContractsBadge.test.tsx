import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ContractsBadge } from './ContractsBadge'

describe('ContractsBadge', () => {
  it('renderiza los valores reales importados desde @gapssa/contracts', () => {
    render(<ContractsBadge />)

    const badge = screen.getByTestId('contracts-badge')
    expect(badge.textContent).toContain('10 min')
    expect(badge.textContent).toContain('5 h')
  })
})
