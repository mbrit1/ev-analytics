import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TariffVersionActionMenu } from './TariffVersionActionMenu';

/**
 * Test suite for the tariff version action menu.
 *
 * Verifies required menu labels, action callbacks, and governed control sizing.
 */
describe('TariffVersionActionMenu', () => {
  it('renders the remaining overflow actions and triggers each callback', async () => {
    // Arrange: Render the menu with spies for each remaining action.
    const onPromotion = vi.fn();
    const onDelete = vi.fn();
    const user = userEvent.setup();

    render(
      <TariffVersionActionMenu
        label="Ionity Lidl"
        onPromotion={onPromotion}
        onDelete={onDelete}
      />,
    );

    // Act: Open the menu and trigger each action.
    await user.click(screen.getByRole('button', { name: /tariff actions for ionity lidl/i }));
    await user.click(screen.getByRole('button', { name: /run temporary promotion/i }));
    await user.click(screen.getByRole('button', { name: /tariff actions for ionity lidl/i }));
    await user.click(screen.getByRole('button', { name: /delete tariff/i }));

    // Assert: The remaining actions are reachable and invoke their handlers.
    expect(onPromotion).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /edit details/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /change price permanently/i })).not.toBeInTheDocument();
  });

  it('uses governed surface tokens and 44px minimum controls', () => {
    // Arrange: Render the action menu without interacting.
    render(
      <TariffVersionActionMenu
        label="Ionity Lidl"
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

  it('closes when focus or pointer interaction moves outside the menu', async () => {
    // Arrange: Render the action menu next to another focusable page control.
    const user = userEvent.setup();
    render(
      <div>
        <TariffVersionActionMenu
          label="Ionity Lidl"
          onPromotion={vi.fn()}
          onDelete={vi.fn()}
        />
        <button type="button">Outside control</button>
      </div>
    );

    // Act: Open the menu, move focus outside, reopen it, then click elsewhere on the page.
    await user.click(screen.getByRole('button', { name: /tariff actions for ionity lidl/i }));
    expect(screen.getByRole('button', { name: /run temporary promotion/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /outside control/i }));
    await user.click(screen.getByRole('button', { name: /tariff actions for ionity lidl/i }));
    expect(screen.getByRole('button', { name: /delete tariff/i })).toBeInTheDocument();
    await user.click(document.body);

    // Assert: The menu surface is dismissed after outside focus and outside pointer interaction.
    expect(screen.queryByRole('button', { name: /run temporary promotion/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete tariff/i })).not.toBeInTheDocument();
  });
});
