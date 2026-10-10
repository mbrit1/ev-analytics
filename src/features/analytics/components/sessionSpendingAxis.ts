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
