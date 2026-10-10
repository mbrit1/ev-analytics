import { describe, expect, it } from 'vitest'
import { createSpendingAxisTicks } from './sessionSpendingAxis'

/** Keeps the spending axis zero-based, compact and truthful for missing values. */
describe('createSpendingAxisTicks', () => {
  it('uses a zero start and evenly spaced rounded ticks through the maximum', () => {
    // Arrange
    const ordinaryValues = [0, 500, null, 0, 600, 0]
    const largerValues = [0, 1234]

    // Act
    const ordinaryTicks = createSpendingAxisTicks(ordinaryValues)
    const largerTicks = createSpendingAxisTicks(largerValues)

    // Assert
    expect(ordinaryTicks).toEqual([0, 200, 400, 600])
    expect(largerTicks).toEqual([0, 500, 1000, 1500])
  })

  it('keeps an all-zero series meaningful and excludes unavailable values from its range', () => {
    // Arrange
    const zeroValues = [0, 0, 0]
    const partiallyUnavailableValues = [null, 250, null]

    // Act
    const zeroTicks = createSpendingAxisTicks(zeroValues)
    const partialTicks = createSpendingAxisTicks(partiallyUnavailableValues)

    // Assert
    expect(zeroTicks).toEqual([0, 100, 200, 300])
    expect(partialTicks).toEqual([0, 100, 200, 300])
  })

  it('returns no numeric scale when every measurement is unavailable', () => {
    // Arrange
    const unavailableValues = [null, null]

    // Act
    const ticks = createSpendingAxisTicks(unavailableValues)

    // Assert
    expect(ticks).toEqual([])
    expect(createSpendingAxisTicks([])).toEqual([])
  })

  it('keeps tiny cent values distinct and generates rounded ticks for large values', () => {
    // Arrange
    const oneCentValues = [1]
    const twoCentValues = [2]
    const sevenCentValues = [7]
    const largeValues = [987654321]

    // Act
    const oneCentTicks = createSpendingAxisTicks(oneCentValues)
    const twoCentTicks = createSpendingAxisTicks(twoCentValues)
    const sevenCentTicks = createSpendingAxisTicks(sevenCentValues)
    const largeTicks = createSpendingAxisTicks(largeValues)

    // Assert
    expect(oneCentTicks).toEqual([0, 1])
    expect(twoCentTicks).toEqual([0, 1, 2])
    expect(sevenCentTicks).toEqual([0, 3, 6, 9])
    expect(new Set(largeTicks).size).toBe(largeTicks.length)
    expect(largeTicks[0]).toBe(0)
    expect(largeTicks.at(-1)).toBeGreaterThanOrEqual(largeValues[0]!)
    expect(new Set(largeTicks.slice(1).map((tick, index) => tick - largeTicks[index]!)).size).toBe(1)
  })
})
