import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatUtcDate } from '../model/logicalTariffs';
import { useUtcToday } from './useUtcToday';

/**
 * Test suite for the UTC calendar-day hook.
 *
 * Verifies date-derived tariff state refreshes without requiring a plan write.
 */
describe('useUtcToday', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('updates after UTC midnight', () => {
    // Arrange: Freeze time just before UTC midnight before mounting the hook.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-14T23:59:59.000Z'));

    // Act: Render the hook and advance past the next UTC day boundary.
    const { result } = renderHook(() => useUtcToday());
    expect(formatUtcDate(result.current)).toBe('2026-08-14');

    act(() => {
      vi.advanceTimersByTime(1_100);
    });

    // Assert: The hook rolls forward to the next UTC calendar day.
    expect(formatUtcDate(result.current)).toBe('2026-08-15');
  });
});
