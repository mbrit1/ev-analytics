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

  it('uses a body portal above the dock and isolates page interaction while open', () => {
    // Arrange: Preserve an app root, dock, scroll position, and invoking action before confirmation opens.
    const appRoot = document.createElement('main');
    const dock = document.createElement('nav');
    const trigger = document.createElement('button');
    dock.setAttribute('aria-label', 'Primary mobile actions');
    document.body.append(appRoot, dock, trigger);
    document.body.style.overflow = 'scroll';
    trigger.focus();

    let unmount: (() => void) | undefined;
    try {
      // Act: Open the destructive confirmation.
      ({ unmount } = render(
        <DeleteLogicalTariffDialog
          logicalTariffLabel="Ionity Lidl"
          isDeleting={false}
          onConfirm={vi.fn().mockResolvedValue(undefined)}
          onCancel={vi.fn()}
        />,
      ));
      const dialog = screen.getByRole('dialog', { name: /delete tariff/i });
      const portalContainer = dialog.closest<HTMLElement>('[data-delete-logical-tariff-dialog]');
      const modalLayer = dialog.closest<HTMLElement>('.fixed');

      // Assert: The dialog owns the body-level modal layer, page isolation, and scroll lock.
      expect(portalContainer).not.toBeNull();
      expect(portalContainer).toHaveAttribute('data-delete-logical-tariff-dialog', 'true');
      expect(portalContainer?.parentElement).toBe(document.body);
      expect(modalLayer).toHaveClass('z-50');
      expect(appRoot).toHaveAttribute('inert', '');
      expect(dock).toHaveAttribute('inert', '');
      expect(document.body.style.overflow).toBe('hidden');
    } finally {
      unmount?.();
      expect(appRoot).not.toHaveAttribute('inert');
      expect(dock).not.toHaveAttribute('inert');
      expect(document.body.style.overflow).toBe('scroll');
      appRoot.remove();
      dock.remove();
      trigger.remove();
    }
  });

  it('focuses a neutral Cancel action, traps focus, dismisses with Escape, and restores the trigger', async () => {
    // Arrange: Open the dialog from a focused action trigger.
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    const { unmount } = render(
      <DeleteLogicalTariffDialog
        logicalTariffLabel="Ionity Lidl"
        isDeleting={false}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
        onCancel={onCancel}
      />,
    );
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: /delete complete tariff/i });

    try {
      // Act: Traverse the modal boundary and use the keyboard dismissal path.
      expect(cancel).toHaveFocus();
      await user.tab();
      expect(confirm).toHaveFocus();
      await user.tab();
      expect(cancel).toHaveFocus();
      await user.keyboard('{Escape}');

      // Assert: Cancellation is neutral, keyboard-accessible, and restores its invoking control.
      expect(cancel).toHaveClass('bg-secondary/10');
      expect(cancel).not.toHaveClass('bg-accent');
      expect(onCancel).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
      expect(trigger).toHaveFocus();
      trigger.remove();
    }
  });

  it('keeps the destructive action neutral-cancelled and blocks a second write after controlled pending state begins', async () => {
    // Arrange: Let the parent switch the dialog to its controlled pending state after one request.
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <DeleteLogicalTariffDialog
        logicalTariffLabel="Ionity Lidl"
        isDeleting={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    // Act: Start one deletion, then attempt another after the owner reports pending state.
    await user.click(screen.getByRole('button', { name: /delete complete tariff/i }));
    view.rerender(
      <DeleteLogicalTariffDialog
        logicalTariffLabel="Ionity Lidl"
        isDeleting
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole('button', { name: /delete complete tariff/i }));

    // Assert: Parent-owned pending state prevents duplicate destructive requests without recasting Cancel as danger.
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass('bg-secondary/10');
  });
});
