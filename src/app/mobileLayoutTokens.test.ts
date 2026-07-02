/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Test suite for the shared mobile layout spacing tokens.
 *
 * Verifies the floating dock and contextual action keep their compact spacing
 * contract while preserving token-based content clearance formulas.
 */
describe('mobile layout tokens', () => {
  it('keeps the dock, accessory pill, and content reserve on the compact spacing scale', () => {
    // Arrange: Load the shared CSS token source that drives the mobile layout stack.
    const indexCss = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

    // Act: Inspect the tuned token values and formula composition.

    // Assert: The dock stack stays compact without removing the reserve formulas.
    expect(indexCss).toContain('--mobile-dock-lift: 10px;')
    expect(indexCss).toContain('--mobile-context-action-gap: 12px;')
    expect(indexCss).toContain('--mobile-content-bottom-clearance: 20px;')
    expect(indexCss).toContain('--mobile-context-action-bottom: calc(var(--mobile-nav-dock-bottom) + var(--mobile-nav-dock-height) + var(--mobile-context-action-gap));')
    expect(indexCss).toContain('--mobile-content-clearance-with-action: calc(')
    expect(indexCss).toContain('--mobile-content-clearance-dock-only: calc(')
  })
})
