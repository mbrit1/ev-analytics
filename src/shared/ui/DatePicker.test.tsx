import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DatePicker } from './DatePicker';

/**
 * Test suite for the shared app-controlled DatePicker.
 *
 * Verifies staged calendar selection, optional empty values, min/max
 * constraints, accessible errors, and keyboard behavior without relying on
 * browser-native date input rendering.
 */
describe('DatePicker', () => {
  function getPickerMonth(): string {
    const monthHeading = screen.getByTestId('date-picker-month');
    const month = monthHeading.getAttribute('data-month');
    if (!month) {
      throw new Error('Date picker month heading is missing data-month');
    }
    return month;
  }

  function movePickerToMonth(targetDate: string): void {
    const targetMonth = targetDate.slice(0, 7);
    let guard = 0;

    while (getPickerMonth() !== targetMonth) {
      if (guard > 48) {
        throw new Error(`Could not navigate date picker to ${targetMonth}`);
      }
      const currentMonth = getPickerMonth();
      fireEvent.click(screen.getByRole('button', {
        name: currentMonth.localeCompare(targetMonth) < 0 ? /next month/i : /previous month/i,
      }));
      guard += 1;
    }
  }

  function formatPickerLabel(date: string): string {
    const [year, month, day] = date.split('-');
    return `${day}.${month}.${year}`;
  }

  function chooseDate(date: string): void {
    movePickerToMonth(date);
    fireEvent.click(screen.getByRole('button', { name: `Choose ${formatPickerLabel(date)}` }));
  }

  it('renders a required selected date and commits a staged date only after confirmation', () => {
    // Arrange: Render a controlled required date picker with a current value.
    const onChange = vi.fn();
    render(
      <DatePicker
        label="Valid From"
        value="2026-03-05"
        onChange={onChange}
        required
        requiredIndicator
      />
    );

    // Act: Open the picker and select another day without confirming.
    fireEvent.click(screen.getByRole('button', { name: /valid from/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose 12.03.2026' }));

    // Assert: Selection is staged until the explicit Set Date action.
    expect(onChange).not.toHaveBeenCalled();

    // Act: Confirm the staged date.
    fireEvent.click(screen.getByRole('button', { name: /set date/i }));

    // Assert: The committed value is a YYYY-MM-DD string.
    expect(onChange).toHaveBeenCalledWith('2026-03-12');
  });

  it('renders an optional empty value with the configured empty label', () => {
    // Arrange: Render an optional picker with no selected value.
    render(
      <DatePicker
        label="Valid To"
        value=""
        onChange={vi.fn()}
        allowEmpty
        emptyLabel="Open-ended"
      />
    );

    // Act: Inspect the trigger before opening the picker.
    const trigger = screen.getByRole('button', { name: /valid to/i });

    // Assert: The user-facing empty state is Open-ended.
    expect(trigger).toHaveTextContent('Open-ended');
  });

  it('does not commit today when opening an optional empty picker', () => {
    // Arrange: Render an optional empty picker.
    const onChange = vi.fn();
    render(
      <DatePicker
        label="Valid To"
        value=""
        onChange={onChange}
        allowEmpty
        emptyLabel="Open-ended"
      />
    );

    // Act: Open and cancel the picker without choosing a day.
    fireEvent.click(screen.getByRole('button', { name: /valid to/i }));
    expect(screen.getByRole('button', { name: /no end date/i })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    // Assert: Opening the picker does not silently commit a date.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('selects and confirms an optional date', () => {
    // Arrange: Render an optional picker with no current value.
    const onChange = vi.fn();
    render(
      <DatePicker
        label="Valid To"
        value=""
        onChange={onChange}
        allowEmpty
        emptyLabel="Open-ended"
      />
    );

    // Act: Choose a date in a navigated month and confirm it.
    fireEvent.click(screen.getByRole('button', { name: /valid to/i }));
    chooseDate('2026-06-30');
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));

    // Assert: The selected date is committed.
    expect(onChange).toHaveBeenCalledWith('2026-06-30');
  });

  it('stages no end date and commits it only after applying', () => {
    // Arrange: Render an optional picker with an existing value.
    const onChange = vi.fn();
    render(
      <DatePicker
        label="Valid To"
        value="2026-06-30"
        onChange={onChange}
        allowEmpty
        emptyLabel="Open-ended"
      />
    );

    // Act: Stage the no-end-date mode without applying it.
    fireEvent.click(screen.getByRole('button', { name: /valid to/i }));
    fireEvent.click(screen.getByRole('button', { name: /no end date/i }));

    // Assert: Changing modes is staged until the explicit Apply action.
    expect(screen.getByRole('button', { name: /no end date/i })).toHaveAttribute('aria-pressed', 'true');
    expect(onChange).not.toHaveBeenCalled();

    // Act: Apply the staged no-end-date value.
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));

    // Assert: The committed value is the empty string used by forms.
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('cancels optional mode changes without committing them', () => {
    // Arrange: Render an optional picker with an existing value.
    const onChange = vi.fn();
    render(
      <DatePicker
        label="Valid To"
        value="2026-06-30"
        onChange={onChange}
        allowEmpty
        emptyLabel="Open-ended"
      />
    );

    // Act: Toggle to no end date, then cancel.
    fireEvent.click(screen.getByRole('button', { name: /valid to/i }));
    fireEvent.click(screen.getByRole('button', { name: /no end date/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    // Assert: Cancel closes the picker without committing the staged mode.
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /valid to/i })).toHaveTextContent('30.06.2026');
  });

  it('disables dates outside min and max', () => {
    // Arrange: Render a picker constrained to March 2026.
    render(
      <DatePicker
        label="Promo Start"
        value="2026-03-10"
        onChange={vi.fn()}
        required
        min="2026-03-05"
        max="2026-03-20"
      />
    );

    // Act: Open the picker.
    fireEvent.click(screen.getByRole('button', { name: /promo start/i }));

    // Assert: Out-of-range dates cannot be chosen.
    expect(screen.getByRole('button', { name: 'Choose 04.03.2026' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Choose 21.03.2026' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Choose 10.03.2026' })).not.toBeDisabled();
  });

  it('exposes error text through aria-describedby', () => {
    // Arrange: Render a picker with a validation error.
    render(
      <DatePicker
        label="Effective From"
        value=""
        onChange={vi.fn()}
        required
        error="Effective from date is required"
      />
    );

    // Act: Inspect the trigger and message relationship.
    const trigger = screen.getByRole('button', { name: /effective from/i });
    const error = screen.getByText('Effective from date is required');

    // Assert: The trigger is marked invalid and described by the message.
    expect(trigger).toHaveAttribute('aria-invalid', 'true');
    expect(trigger).toHaveAttribute('aria-describedby', error.getAttribute('id'));
  });

  it('supports keyboard open, navigation, confirmation, cancellation, and clearing', async () => {
    // Arrange: Render an optional picker with an existing selected date.
    const onChange = vi.fn();
    render(
      <DatePicker
        label="Valid To"
        value="2026-03-10"
        onChange={onChange}
        allowEmpty
        emptyLabel="Open-ended"
      />
    );
    const trigger = screen.getByRole('button', { name: /valid to/i });

    // Act: Open with keyboard, move one day, and confirm.
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const selectedDate = screen.getByRole('button', { name: 'Choose 10.03.2026' });
    await waitFor(() => expect(selectedDate).toHaveFocus());
    fireEvent.keyDown(selectedDate, { key: 'ArrowRight' });
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));

    // Assert: Keyboard day movement stages and commits the next date.
    expect(onChange).toHaveBeenCalledWith('2026-03-11');

    // Act: Reopen and cancel with Escape.
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Choose 10.03.2026' })).toHaveFocus());
    fireEvent.keyDown(document.activeElement ?? screen.getByRole('dialog'), { key: 'Escape' });

    // Assert: Escape does not commit another value.
    expect(onChange).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(trigger).toHaveFocus());

    // Act: Reopen and apply the optional no-end-date mode.
    fireEvent.keyDown(trigger, { key: 'Enter' });
    await screen.findByRole('button', { name: /no end date/i });
    fireEvent.click(screen.getByRole('button', { name: /no end date/i }));
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));

    // Assert: The clear path remains keyboard reachable through a real button.
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('keeps required pickers on Set Date without optional modes', () => {
    // Arrange: Render a required picker.
    render(
      <DatePicker
        label="Session Date"
        value="2026-03-10"
        onChange={vi.fn()}
        required
      />
    );

    // Act: Open the picker.
    fireEvent.click(screen.getByRole('button', { name: /session date/i }));

    // Assert: Required fields use date-only actions.
    expect(screen.getByRole('button', { name: /set date/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /apply/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /no end date/i })).not.toBeInTheDocument();
  });

  it('returns focus to the trigger after canceling', async () => {
    // Arrange: Render an optional picker with a selected value.
    render(
      <DatePicker
        label="Valid To"
        value="2026-03-10"
        onChange={vi.fn()}
        allowEmpty
        emptyLabel="Open-ended"
      />
    );
    const trigger = screen.getByRole('button', { name: /valid to/i });

    // Act: Open and cancel the picker.
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    // Assert: Focus returns to the trigger for continued keyboard flow.
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('closes without committing when focus moves outside the picker', () => {
    // Arrange: Render a picker next to another focus target.
    const onChange = vi.fn();
    render(
      <>
        <DatePicker
          label="Valid From"
          value="2026-03-10"
          onChange={onChange}
          required
        />
        <button type="button">Next field</button>
      </>
    );

    // Act: Open the picker, then move focus outside of its root.
    fireEvent.click(screen.getByRole('button', { name: /valid from/i }));
    fireEvent.focusIn(screen.getByRole('button', { name: /next field/i }));

    // Assert: Focus changes dismiss the staged picker without committing.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('closes an open picker before opening another picker', () => {
    // Arrange: Render adjacent date pickers like tariff validity fields.
    render(
      <>
        <DatePicker
          label="Valid From"
          value="2026-04-27"
          onChange={vi.fn()}
          required
        />
        <DatePicker
          label="Valid To"
          value="2026-06-30"
          onChange={vi.fn()}
          allowEmpty
          emptyLabel="Open-ended"
        />
      </>
    );

    // Act: Open the first picker, then click into the second picker.
    fireEvent.click(screen.getByRole('button', { name: /valid from/i }));
    expect(getPickerMonth()).toBe('2026-04');
    const validTo = screen.getByRole('button', { name: /valid to/i });
    fireEvent.pointerDown(validTo);
    fireEvent.click(validTo);

    // Assert: Only the newly focused picker remains open.
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(getPickerMonth()).toBe('2026-06');
  });

  it('does not open or commit changes when disabled', () => {
    // Arrange: Render a disabled required picker.
    const onChange = vi.fn();
    render(
      <DatePicker
        label="Session Date"
        value="2026-03-10"
        onChange={onChange}
        required
        disabled
      />
    );

    // Act: Try to open through pointer and keyboard paths.
    const trigger = screen.getByRole('button', { name: /session date/i });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'Enter' });

    // Assert: Disabled controls do not expose the picker or emit changes.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('commits the exact adjacent-month day selected from the visible grid', () => {
    // Arrange: Render a picker on a month whose grid includes early April days.
    const onChange = vi.fn();
    render(
      <DatePicker
        label="Promo End"
        value="2026-03-31"
        onChange={onChange}
        required
      />
    );

    // Act: Select an adjacent-month day without navigating to that month first.
    fireEvent.click(screen.getByRole('button', { name: /promo end/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose 01.04.2026' }));
    fireEvent.click(screen.getByRole('button', { name: /set date/i }));

    // Assert: Adjacent-month cells commit their own full date, not the visible month.
    expect(onChange).toHaveBeenCalledWith('2026-04-01');
  });
});
