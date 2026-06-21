import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { TariffVersionActionMenu } from './TariffVersionActionMenu';

/**
 * Test suite for the tariff version action menu.
 *
 * Verifies required menu labels, action callbacks, and governed control sizing.
 */
describe('TariffVersionActionMenu', () => {
  it('renders the four required menu actions and triggers each callback', async () => {
    // Arrange: Render the menu with spies for each required action.
    const onEditDetails = vi.fn();
    const onPermanentChange = vi.fn();
    const onPromotion = vi.fn();
    const onDelete = vi.fn();
    const user = userEvent.setup();

    render(
      <TariffVersionActionMenu
        label="Ionity Lidl"
        onEditDetails={onEditDetails}
        onPermanentChange={onPermanentChange}
        onPromotion={onPromotion}
        onDelete={onDelete}
      />,
    );

    // Act: Open the menu and trigger each action.
    await user.click(screen.getByRole('button', { name: /tariff actions for ionity lidl/i }));
    await user.click(screen.getByRole('button', { name: /edit details/i }));
    await user.click(screen.getByRole('button', { name: /tariff actions for ionity lidl/i }));
    await user.click(screen.getByRole('button', { name: /change price permanently/i }));
    await user.click(screen.getByRole('button', { name: /tariff actions for ionity lidl/i }));
    await user.click(screen.getByRole('button', { name: /run temporary promotion/i }));
    await user.click(screen.getByRole('button', { name: /tariff actions for ionity lidl/i }));
    await user.click(screen.getByRole('button', { name: /delete tariff/i }));

    // Assert: All required labels are reachable and invoke their handlers.
    expect(onEditDetails).toHaveBeenCalledTimes(1);
    expect(onPermanentChange).toHaveBeenCalledTimes(1);
    expect(onPromotion).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('uses governed surface tokens and 44px minimum controls', () => {
    // Arrange: Render the action menu without interacting.
    render(
      <TariffVersionActionMenu
        label="Ionity Lidl"
        onEditDetails={vi.fn()}
        onPermanentChange={vi.fn()}
        onPromotion={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    // Act: Inspect the trigger classes.
    const trigger = screen.getByRole('button', { name: /tariff actions for ionity lidl/i });

    // Assert: The trigger uses governed styling hooks and touch-target sizing.
    expect(trigger.className).toContain('bg-surface');
    expect(trigger.className).toContain('border-secondary/10');
    expect(trigger.className).toContain('text-primary');
    expect(trigger.className).toContain('min-h-[44px]');
  });
});
