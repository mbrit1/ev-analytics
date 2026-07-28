import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PaidTariffSwitchDialog } from './PaidTariffSwitchDialog';

const renderDialog = (overrides: Partial<React.ComponentProps<typeof PaidTariffSwitchDialog>> = {}) => render(
  <PaidTariffSwitchDialog
    providerName="Ionity"
    incumbentName="Current Tariff"
    candidateStart={new Date('2026-08-15T00:00:00.000Z')}
    isPending={false}
    onCancel={vi.fn()}
    onConfirm={vi.fn()}
    {...overrides}
  />,
);

/** Verifies keyboard and focus behavior for the paid-tariff replacement dialog. */
describe('PaidTariffSwitchDialog', () => {
  it('focuses Cancel initially and links the explanatory copy', () => {
    // Arrange: Render the dialog from a focused trigger.
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    // Act: Open the dialog.
    renderDialog();

    // Assert: Cancel receives focus and the description is linked.
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-describedby', 'paid-tariff-switch-description');
    trigger.remove();
  });

  it('cancels on Escape only when not pending and restores the prior focus', async () => {
    // Arrange: Render a cancelable dialog from a focused trigger.
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const onCancel = vi.fn();
    const { rerender, unmount } = renderDialog({ onCancel });

    // Act: Escape while idle, then verify pending Escape is ignored.
    await userEvent.setup().keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    rerender(
      <PaidTariffSwitchDialog
        providerName="Ionity"
        incumbentName="Current Tariff"
        candidateStart={new Date('2026-08-15T00:00:00.000Z')}
        isPending
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );
    await userEvent.setup().keyboard('{Escape}');

    // Assert: Pending state blocks Escape, and unmount restores focus.
    expect(onCancel).toHaveBeenCalledTimes(1);
    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it('contains Tab focus within enabled actions', async () => {
    // Arrange: Render idle dialog with Cancel initially focused.
    renderDialog();
    const user = userEvent.setup();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: /confirm switch/i });

    // Act: Cycle forwards and backwards at the action boundaries.
    expect(cancel).toHaveFocus();
    await user.tab();
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab({ shift: true });

    // Assert: Shift+Tab from first wraps to last.
    expect(confirm).toHaveFocus();
  });
});
