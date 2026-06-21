import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { TariffVersionHistorySheet } from './TariffVersionHistorySheet';
import type { ChargingPlan } from '../../../infra/db';
import type { LogicalTariff } from '../model/logicalTariffs';

const utc = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

const buildPlan = (overrides: Partial<ChargingPlan> = {}): ChargingPlan => ({
  id: overrides.id ?? 'plan-1',
  user_id: overrides.user_id ?? 'user-1',
  provider_id: overrides.provider_id ?? 'provider-1',
  name: overrides.name ?? 'Lidl',
  valid_from: overrides.valid_from ?? utc('2026-01-01'),
  valid_to: overrides.valid_to ?? null,
  ac_price_per_kwh: overrides.ac_price_per_kwh,
  dc_price_per_kwh: overrides.dc_price_per_kwh,
  roaming_ac_price_per_kwh: overrides.roaming_ac_price_per_kwh,
  roaming_dc_price_per_kwh: overrides.roaming_dc_price_per_kwh,
  monthly_base_fee: overrides.monthly_base_fee ?? 0,
  session_fee: overrides.session_fee ?? 0,
  affiliation: overrides.affiliation,
  notes: overrides.notes,
  created_at: overrides.created_at ?? utc('2026-01-01'),
  updated_at: overrides.updated_at ?? utc('2026-01-01'),
  deleted_at: overrides.deleted_at,
});

const logicalTariff: LogicalTariff = {
  key: 'p1::lidl',
  providerId: 'p1',
  name: 'Lidl',
  versions: [],
  currentVersion: null,
  nextVersion: null,
  history: [
    {
      plan: buildPlan({
        id: 'promo',
        valid_from: utc('2026-08-10'),
        valid_to: utc('2026-09-01'),
        ac_price_per_kwh: 19,
        dc_price_per_kwh: 29,
        roaming_ac_price_per_kwh: 39,
        roaming_dc_price_per_kwh: 49,
        monthly_base_fee: 199,
        session_fee: 99,
      }),
      labels: ['Promotion', 'Current'],
      startDate: '2026-08-10',
      endDateInclusive: '2026-08-31',
    },
    {
      plan: buildPlan({
        id: 'restore',
        valid_from: utc('2026-09-01'),
        ac_price_per_kwh: 29,
        dc_price_per_kwh: 39,
        monthly_base_fee: 0,
        session_fee: 0,
      }),
      labels: ['Restored', 'Scheduled'],
      startDate: '2026-09-01',
      endDateInclusive: null,
    },
  ],
};

/**
 * Test suite for the tariff version history sheet.
 *
 * Verifies chronological history rows, labels, inclusive ranges, and close behavior.
 */
describe('TariffVersionHistorySheet', () => {
  it('renders chronological rows with labels, date ranges, and all price fields', () => {
    // Arrange: Render a logical tariff history with promotion and restoration rows.
    render(
      <TariffVersionHistorySheet
        logicalTariff={logicalTariff}
        providerName="Ionity"
        onClose={vi.fn()}
      />,
    );

    // Act: Read the visible history sheet content.

    // Assert: Rows show their labels, ranges, and configured prices and fees.
    expect(screen.getByRole('heading', { name: /tariff history/i })).toBeInTheDocument();
    expect(screen.getAllByText('Promotion')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Restored')[0]).toBeInTheDocument();
    expect(screen.getByText('2026-08-10 - 2026-08-31')).toBeInTheDocument();
    expect(screen.getByText('2026-09-01 - Ongoing')).toBeInTheDocument();
    expect(screen.getByText('0,19 €')).toBeInTheDocument();
    expect(screen.getByText('1,99 €')).toBeInTheDocument();
    expect(screen.getByText('0,99 €')).toBeInTheDocument();
  });

  it('closes from the dismiss action', async () => {
    // Arrange: Render the history sheet with a close spy.
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <TariffVersionHistorySheet
        logicalTariff={logicalTariff}
        providerName="Ionity"
        onClose={onClose}
      />,
    );

    // Act: Trigger the explicit close button.
    await user.click(screen.getByRole('button', { name: /close tariff history/i }));

    // Assert: The close handler runs once.
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
