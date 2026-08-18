import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RetireLogicalTariffDialog } from './RetireLogicalTariffDialog';

const finalActiveDate = new Date('2026-08-16T00:00:00.000Z');

const renderDialog = (
  overrides: Partial<React.ComponentProps<typeof RetireLogicalTariffDialog>> = {},
) => render(
  <RetireLogicalTariffDialog
    logicalTariffLabel="Ionity Lidl"
    finalActiveDate={finalActiveDate}
    isPending={false}
    onCancel={vi.fn()}
    onConfirm={vi.fn()}
    {...overrides}
  />,
);

/**
 * Test suite for the tariff retirement confirmation dialog.
 *
 * Verifies inclusive-date disclosure, historical immutability, and accessible
 * modal behavior before the retirement mutation is exposed to the overview.
 */
describe('RetireLogicalTariffDialog', () => {
  it('explains the inclusive final date, same-day coverage, future cancellation, and immutability', () => {
    // Arrange: Render a current tariff with future scheduled changes.
    renderDialog();

    // Act: Read the confirmation surface before taking action.
    const dialog = screen.getByRole('dialog', { name: /retire tariff/i });

    // Assert: The user receives the complete irreversible-retirement disclosure.
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription(/final active date is 2026-08-16/i);
    expect(screen.getByText(/sessions on 2026-08-16 remain covered/i)).toBeInTheDocument();
    expect(screen.getByText(/future scheduled versions and promotions will be cancelled/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot be reversed by editing the historical tariff/i)).toBeInTheDocument();
  });

  it('focuses Cancel, traps Tab navigation, and restores the invoking control when closed', async () => {
    // Arrange: Open the dialog from a focusable overflow-menu trigger.
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const user = userEvent.setup();
    const { unmount } = renderDialog();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: /retire tariff/i });

    // Act: Cycle focus forwards then backwards between the enabled actions.
    expect(cancel).toHaveFocus();
    await user.tab();
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
    unmount();

    // Assert: Focus starts and remains in the modal, then returns to its trigger.
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it('isolates the app while open and restores body state after closing', () => {
    // Arrange: Preserve existing app and scroll state before opening the modal.
    const appRoot = document.createElement('main');
    document.body.appendChild(appRoot);
    document.body.style.overflow = 'scroll';

    // Act: Mount then unmount the portalled confirmation surface.
    const { unmount } = renderDialog();
    expect(appRoot).toHaveAttribute('inert', '');
    expect(document.body.style.overflow).toBe('hidden');
    unmount();

    // Assert: The surrounding app is available again with its original scroll state.
    expect(appRoot).not.toHaveAttribute('inert');
    expect(document.body.style.overflow).toBe('scroll');
    appRoot.remove();
  });

  it('cancels with Escape and the Cancel action', async () => {
    // Arrange: Render an idle dialog with a cancel callback.
    const onCancel = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onCancel });

    // Act: Use both supported non-destructive dismissal paths.
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    // Assert: Both interactions request cancellation.
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('prevents a second retirement confirmation while the first is pending', async () => {
    // Arrange: Render the pending state after a confirmation request has started.
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    renderDialog({ isPending: true, onConfirm });
    const confirm = screen.getByRole('button', { name: /retiring tariff/i });

    // Act: Attempt to activate the disabled confirmation action twice.
    await user.click(confirm);
    await user.click(confirm);

    // Assert: Pending state makes duplicate mutation requests impossible.
    expect(confirm).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('keeps the dialog open and announces a service failure', () => {
    // Arrange: Render a retirement request rejected by the domain service.
    renderDialog({ error: 'The tariff changed after confirmation. Please review it again.' });

    // Act: Locate the accessible failure message.
    const alert = screen.getByRole('alert');

    // Assert: The user can recover without losing the confirmation context.
    expect(alert).toHaveTextContent('The tariff changed after confirmation. Please review it again.');
    expect(screen.getByRole('dialog', { name: /retire tariff/i })).toBeInTheDocument();
  });
});
