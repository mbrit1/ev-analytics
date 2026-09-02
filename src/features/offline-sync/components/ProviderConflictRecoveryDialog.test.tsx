import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderConflictRecoveryDialog } from './ProviderConflictRecoveryDialog';

type DialogProps = ComponentProps<typeof ProviderConflictRecoveryDialog>;

const readyState: DialogProps['state'] = {
  kind: 'ready',
  stagedProviderName: 'Ionity',
  canonicalProviderName: 'Ionity Germany',
  summary: {
    chargingPlanCount: 2,
    selectionCount: 1,
    sessionCount: 3,
    outboxCount: 4,
  },
};

const renderDialog = (overrides: Partial<DialogProps> = {}) => {
  const props: DialogProps = {
    state: readyState,
    isPending: false,
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
    onAcknowledge: vi.fn(),
    ...overrides,
  };

  return {
    ...render(<ProviderConflictRecoveryDialog {...props} />),
    props,
  };
};

afterEach(() => {
  document.querySelectorAll('[data-provider-conflict-test-trigger]').forEach((element) => element.remove());
});

/**
 * Defines the recovery-dialog user contract before Task 14 implements its UI.
 *
 * These RED tests intentionally exercise the no-op scaffold so future dialog
 * behavior must satisfy every recovery, safety, and accessibility state.
 */
describe('ProviderConflictRecoveryDialog', () => {
  it('renders a named loading dialog while the safe recovery review is loading', () => {
    // Arrange: Start the read-only recovery review.
    renderDialog({ state: { kind: 'loading' } });

    // Act: Locate the progress surface.
    const dialog = screen.getByRole('dialog', { name: 'Resolve provider conflict' });

    // Assert: Loading explains that no local data has changed.
    expect(dialog).toHaveTextContent('Reviewing provider conflict');
    expect(dialog).toHaveTextContent('No changes have been made');
  });

  it('shows the ready provider match, affected-data counts, and safe confirmation summary', () => {
    // Arrange: Receive a reviewed graph that can be reconciled safely.
    renderDialog();

    // Act: Read the reviewed recovery summary.
    const dialog = screen.getByRole('dialog', { name: 'Resolve provider conflict' });

    // Assert: The user sees the provider identities, all affected counts, and retained history.
    expect(dialog).toHaveTextContent('Ionity');
    expect(dialog).toHaveTextContent('Ionity Germany');
    expect(dialog).toHaveTextContent('2 charging plans');
    expect(dialog).toHaveTextContent('1 selection');
    expect(dialog).toHaveTextContent('3 sessions');
    expect(dialog).toHaveTextContent('4 pending mutations');
    expect(dialog).toHaveTextContent('Tariffs, sessions, and historical prices will be retained');
  });

  it('cancels a ready review without requesting recovery confirmation', async () => {
    // Arrange: Present a safe reviewed recovery with cancellation available.
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onCancel, onConfirm });

    // Act: Cancel instead of accepting the provider replacement.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    // Assert: Cancellation does not request a graph mutation.
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('requires explicit safe confirmation before using the existing provider', async () => {
    // Arrange: Present a safe reviewed recovery.
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onConfirm });

    // Act: Explicitly accept the reviewed provider replacement.
    await user.click(screen.getByRole('button', { name: 'Use existing provider' }));

    // Assert: Only an explicit confirmation requests reconciliation.
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('keeps the recovery view open with actionable retryable-error guidance', () => {
    // Arrange: Fail the remote preflight without changing local data.
    renderDialog({
      state: {
        kind: 'retryable-error',
        message: 'Could not reach the provider service. Check your connection and try again.',
      },
    });

    // Act: Locate the announced retryable error.
    const alert = screen.getByRole('alert');

    // Assert: The error is actionable and the recovery view remains available.
    expect(alert).toHaveTextContent('Could not reach the provider service');
    expect(screen.getByRole('dialog', { name: 'Resolve provider conflict' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry review' })).toBeInTheDocument();
  });

  it('blocks tariff ambiguity with Tariffs guidance and no automatic repair promise', () => {
    // Arrange: Find an overlapping tariff timeline during the read-only review.
    renderDialog({
      state: {
        kind: 'blocked',
        reason: 'tariff-ambiguity',
        message: 'Ionity Flex overlaps from 2026-01-01 to 2026-06-30.',
      },
    });

    // Act: Read the blocked-recovery guidance.
    const dialog = screen.getByRole('dialog', { name: 'Resolve provider conflict' });

    // Assert: The user is directed to repair tariff history deliberately.
    expect(dialog).toHaveTextContent('Ionity Flex overlaps from 2026-01-01 to 2026-06-30');
    expect(dialog).toHaveTextContent('Tariffs');
    expect(dialog).toHaveTextContent('repair dates or tariff identity before retrying');
    expect(dialog).not.toHaveTextContent(/automatic(?:ally)? repair/i);
  });

  it('requires a fresh review when the reviewed graph is stale', () => {
    // Arrange: Let local or remote facts change after preparation.
    renderDialog({
      state: {
        kind: 'stale-review',
        message: 'Your data changed while you were reviewing it. Review the provider conflict again before confirming.',
      },
    });

    // Act: Read the stale-review state.
    const alert = screen.getByRole('alert');

    // Assert: Confirmation is withheld until a new review completes.
    expect(alert).toHaveTextContent('Your data changed while you were reviewing it');
    expect(screen.getByRole('button', { name: 'Review again' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use existing provider' })).not.toBeInTheDocument();
  });

  it('reports success and waits for explicit acknowledgement before closing', async () => {
    // Arrange: Complete the local atomic reconciliation.
    const onAcknowledge = vi.fn();
    const user = userEvent.setup();
    renderDialog({ state: { kind: 'success' }, onAcknowledge });

    // Act: Acknowledge the completed recovery.
    await user.click(screen.getByRole('button', { name: 'Done' }));

    // Assert: The success state is explicit and close acknowledgement is deliberate.
    expect(screen.getByRole('status')).toHaveTextContent('Provider conflict resolved');
    expect(onAcknowledge).toHaveBeenCalledOnce();
  });

  it.each([
    {
      reason: 'no-canonical-match' as const,
      message: 'The matching provider is no longer available remotely. Sync normally and try again.',
      guidance: 'Sync normally and try again',
    },
    {
      reason: 'multiple-canonical-matches' as const,
      message: 'More than one matching provider was found. Resolve this provider integrity issue before retrying.',
      guidance: 'Resolve this provider integrity issue before retrying',
    },
    {
      reason: 'malformed-graph' as const,
      message: 'Recovery cannot safely continue because related local data is incomplete.',
      guidance: 'Recovery cannot safely continue',
    },
  ])('shows actionable $reason guidance without confirming or writing', async ({ reason, message, guidance }) => {
    // Arrange: Receive a blocked preflight result that must not mutate local data.
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    renderDialog({ state: { kind: 'blocked', reason, message }, onConfirm });

    // Act: Read the blocked state and attempt the unavailable confirmation path.
    const dialog = screen.getByRole('dialog', { name: 'Resolve provider conflict' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    // Assert: Each failure explains its next step and cannot request a write.
    expect(dialog).toHaveTextContent(guidance);
    expect(dialog).toHaveTextContent('No changes have been made');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByText(/edit (?:the )?database/i)).not.toBeInTheDocument();
  });

  it('keeps explicit confirmation available when the staged provider has no references', () => {
    // Arrange: Review a safe graph containing only the staged provider and terminal item.
    renderDialog({
      state: {
        kind: 'ready',
        stagedProviderName: 'Ionity',
        canonicalProviderName: 'Ionity Germany',
        summary: {
          chargingPlanCount: 0,
          selectionCount: 0,
          sessionCount: 0,
          outboxCount: 1,
        },
      },
    });

    // Act: Locate the explicit confirmation action.
    const confirm = screen.getByRole('button', { name: 'Use existing provider' });

    // Assert: No-reference recovery remains deliberate rather than automatic.
    expect(confirm).toBeEnabled();
    expect(screen.getByText('0 charging plans')).toBeInTheDocument();
    expect(screen.getByText('0 selections')).toBeInTheDocument();
    expect(screen.getByText('0 sessions')).toBeInTheDocument();
  });

  it('focuses Cancel initially, contains Tab navigation, and restores the invoking control', async () => {
    // Arrange: Open the dialog from a focusable global recovery trigger.
    const trigger = document.createElement('button');
    trigger.dataset.providerConflictTestTrigger = 'true';
    document.body.appendChild(trigger);
    trigger.focus();
    const user = userEvent.setup();
    const { unmount } = renderDialog();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Use existing provider' });

    // Act: Cycle focus at both dialog-action boundaries and close the dialog.
    expect(cancel).toHaveFocus();
    await user.tab();
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
    unmount();

    // Assert: Closing restores focus to the invoking global control.
    expect(trigger).toHaveFocus();
  });

  it('dismisses on Escape only while idle and blocks dismissal while confirmation is pending', async () => {
    // Arrange: Start from an idle dialog, then enter the non-dismissible pending state.
    const onCancel = vi.fn();
    const user = userEvent.setup();
    const { rerender } = renderDialog({ onCancel });

    // Act: Dismiss the idle dialog, then press Escape while the write is pending or already succeeded.
    await user.keyboard('{Escape}');
    rerender(
      <ProviderConflictRecoveryDialog
        state={readyState}
        isPending
        onCancel={onCancel}
        onConfirm={vi.fn()}
        onAcknowledge={vi.fn()}
      />,
    );
    await user.keyboard('{Escape}');
    rerender(
      <ProviderConflictRecoveryDialog
        state={{ kind: 'success' }}
        isPending={false}
        onCancel={onCancel}
        onConfirm={vi.fn()}
        onAcknowledge={vi.fn()}
      />,
    );
    await user.keyboard('{Escape}');

    // Assert: Escape respects pending and explicit-success acknowledgement boundaries.
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('prevents dismissal and duplicate confirmation while the local transaction is pending', async () => {
    // Arrange: Render the write-in-progress state.
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    renderDialog({ isPending: true, onCancel, onConfirm });

    // Act: Attempt both dismissal and duplicate confirmation.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const confirm = screen.getByRole('button', { name: 'Using existing provider' });
    await user.click(confirm);
    await user.click(confirm);

    // Assert: Pending actions cannot close the view or request another write.
    expect(screen.getByRole('dialog', { name: 'Resolve provider conflict' })).toBeInTheDocument();
    expect(confirm).toBeDisabled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('exposes a labelled modal dialog with 44px-minimum action controls', () => {
    // Arrange: Open the safe confirmation state.
    renderDialog();

    // Act: Locate the accessible dialog and its actions.
    const dialog = screen.getByRole('dialog', { name: 'Resolve provider conflict' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Use existing provider' });

    // Assert: The dialog is named and both one-handed actions meet the touch-target minimum.
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(cancel).toHaveClass('min-h-[44px]');
    expect(confirm).toHaveClass('min-h-[44px]');
  });
});
