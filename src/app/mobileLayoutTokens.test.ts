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
    expect(indexCss).toContain('--mobile-dock-lift: 6px;')
    expect(indexCss).toContain('--mobile-context-action-gap: 12px;')
    expect(indexCss).toContain('--mobile-content-bottom-clearance: 20px;')
    expect(indexCss).toContain('--mobile-context-action-bottom: calc(var(--mobile-nav-dock-bottom) + var(--mobile-nav-dock-height) + var(--mobile-context-action-gap));')
    expect(indexCss).toContain('--mobile-content-clearance-with-action: calc(')
    expect(indexCss).toContain('--mobile-content-clearance-dock-only: calc(')
  })

  it('anchors every reservation to the shared dock and safe-area geometry', () => {
    // Arrange: Load the CSS source that declares the mobile layout contract.
    const indexCss = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

    // Act: Read the declarations used by the dock and each content consumer.

    // Assert: Consumers share one dock height, safe-area-aware bottom edge, and stack formulas.
    expect(indexCss).toContain('--safe-area-bottom: env(safe-area-inset-bottom, 0px);')
    expect(indexCss).toContain('--mobile-dock-height: 76px;')
    expect(indexCss).toContain('--mobile-nav-dock-height: var(--mobile-dock-height);')
    expect(indexCss).toContain('--mobile-nav-dock-bottom: calc(var(--safe-area-bottom) + var(--mobile-dock-lift));')
    expect(indexCss).toMatch(
      /--mobile-content-clearance-dock-only: calc\(\s*var\(--mobile-nav-dock-bottom\)\s*\+ var\(--mobile-nav-dock-height\)\s*\+ var\(--mobile-content-bottom-clearance\)\s*\);/,
    )
    expect(indexCss).toMatch(
      /--mobile-content-clearance-with-action: calc\(\s*var\(--mobile-nav-dock-bottom\)\s*\+ var\(--mobile-nav-dock-height\)\s*\+ var\(--mobile-context-action-gap\)\s*\+ var\(--mobile-context-action-height\)\s*\+ var\(--mobile-content-bottom-clearance\)\s*\);/,
    )
  })
})
