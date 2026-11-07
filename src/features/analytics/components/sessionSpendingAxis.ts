/** Creates a compact zero-based EUR scale while ignoring unavailable measurements. */
export function createSpendingAxisTicks(values: readonly (number | null)[]): number[] {
  const availableValues = values.filter((value): value is number => value !== null)
  if (availableValues.length === 0) return []

  const maximum = Math.max(0, ...availableValues)
  if (maximum === 0) return [0, 100, 200, 300]

  const rawStepEuros = maximum / 100 / 3
  const magnitude = 10 ** Math.floor(Math.log10(rawStepEuros))
  const normalized = rawStepEuros / magnitude
  const niceFactor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10
  const stepCents = Math.max(1, Math.ceil(niceFactor * magnitude * 100))
  const upperBound = Math.ceil(maximum / stepCents) * stepCents

  return Array.from({ length: Math.round(upperBound / stepCents) + 1 }, (_, index) => Math.round(index * stepCents))
}

/** Creates a zero-based kWh scale with labels that remain distinct at two decimals. */
export function createEnergyAxisTicks(values: readonly (number | null)[]): number[] {
  const availableValues = values.filter((value): value is number => value !== null)
  if (availableValues.length === 0) return []

  const maximum = Math.max(0, ...availableValues)
  if (maximum === 0) return [0, 0.1, 0.2, 0.3]

  const rawStep = maximum / 3
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const normalized = rawStep / magnitude
  const niceFactor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  const step = Math.max(0.01, niceFactor * magnitude)
  const upperBound = Math.ceil(maximum / step) * step
  const count = Math.round(upperBound / step)

  return Array.from({ length: count + 1 }, (_, index) => Number((index * step).toPrecision(12)))
}

/** Creates a zero-based fractional EUR/kWh scale with suitable rounded ticks. */
export function createPriceAxisTicks(values: readonly (number | null)[]): number[] {
  const availableValues = values.filter((value): value is number => value !== null)
  if (availableValues.length === 0) return []

  const maximum = Math.max(0, ...availableValues)
  if (maximum === 0) return [0, 0.1, 0.2, 0.3]

  const rawStep = maximum / 3
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const normalized = rawStep / magnitude
  const niceFactor = normalized <= 1.5 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10
  const step = Math.max(0.01, niceFactor * magnitude)
  const upperBound = Math.ceil(maximum / step) * step
  const count = Math.round(upperBound / step)

  return Array.from({ length: count + 1 }, (_, index) => Number((index * step).toPrecision(12)))
}
