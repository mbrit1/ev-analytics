import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { DeleteLogicalTariffDialog } from './DeleteLogicalTariffDialog';

/**
 * Test suite for the logical tariff deletion confirmation dialog.
 *
 * Verifies required warning copy, explicit confirmation, cancellation, and rejection handling.
 */
describe('DeleteLogicalTariffDialog', () => {
  it('renders the required warning copy and confirms only through the destructive action', async () => {
    // Arrange: Render the confirmation dialog with working handlers.
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <DeleteLogicalTariffDialog
        logicalTariffLabel="Ionity Lidl"
        isDeleting={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    // Act: Inspect the warning and confirm deletion.
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText(/all scheduled changes and promotions/i)).toBeInTheDocument();
    expect(screen.getByText(/historical charging sessions will keep their saved prices/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /delete complete tariff/i }));

    // Assert: The destructive action calls the confirm handler.
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('keeps the dialog open and shows a root alert when deletion rejects', async () => {
    // Arrange: Render the dialog with a rejecting delete callback.
    const user = userEvent.setup();
    render(
      <DeleteLogicalTariffDialog
        logicalTariffLabel="Ionity Lidl"
        isDeleting={false}
        onConfirm={vi.fn().mockRejectedValue(new Error('Deletion failed'))}
        onCancel={vi.fn()}
      />,
    );

    // Act: Attempt the deletion and wait for the rejection path.
    await user.click(screen.getByRole('button', { name: /delete complete tariff/i }));

    // Assert: The dialog remains mounted and surfaces the root alert.
    expect(await screen.findByRole('alert')).toHaveTextContent('Deletion failed');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
