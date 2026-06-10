import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TactileMatrix } from './TactileMatrix';

/**
 * Test suite for the TactileMatrix component.
 * Focuses on rendering options, handling click selections, applying visual states, and keyboard navigation.
 */
describe('TactileMatrix', () => {
  const options = [
    { label: 'Option 1', value: 'opt1' },
    { label: 'Option 2', value: 'opt2' },
    { label: 'Option 3', value: 'opt3' },
  ];
  const optionsWithDisabled = [
    { label: 'Option 1', value: 'opt1' },
    { label: 'Option 2', value: 'opt2', disabled: true },
    { label: 'Option 3', value: 'opt3' },
  ];

  it('renders label and all options', () => {
    // Arrange: Define a selected value and predefined options.
    // Act: Render the matrix.
    render(
      <TactileMatrix 
        label="Test Matrix" 
        options={options} 
        value="opt1" 
        onChange={() => {}} 
      />
    );

    // Assert: Verify the group label and all option labels are visible
    expect(screen.getByText('Test Matrix')).toBeInTheDocument();
    options.forEach(option => {
      expect(screen.getByText(option.label)).toBeInTheDocument();
    });
  });

  it('renders option secondary text with smaller tabular typography', () => {
    // Arrange: Provide an option with secondary pricing copy.
    render(
      <TactileMatrix
        label="Test Matrix"
        options={[{ label: 'Domestic DC', secondaryLabel: '0,49 €/kWh', value: 'dc' }]}
        value="dc"
        onChange={() => {}}
      />
    );

    // Assert: The primary label remains visible and secondary copy uses the requested hierarchy.
    expect(screen.getByText('Domestic DC')).toHaveClass('text-[17px]');
    expect(screen.getByText('Domestic DC')).toHaveClass('font-semibold');
    expect(screen.getByText('0,49 €/kWh')).toHaveClass('text-[13px]');
    expect(screen.getByText('0,49 €/kWh')).toHaveClass('font-medium');
    expect(screen.getByText('0,49 €/kWh')).toHaveClass('opacity-90');
    expect(screen.getByText('0,49 €/kWh')).toHaveClass('tabular-nums');
  });

  it('keeps a two-option matrix at two columns across breakpoints', () => {
    // Arrange: Render the common binary-choice matrix shape.
    render(
      <TactileMatrix
        label="Charging Rate"
        options={[
          { label: 'Domestic AC', value: 'ac' },
          { label: 'Domestic DC', value: 'dc' },
        ]}
        value="dc"
        onChange={() => {}}
      />
    );

    // Act: Locate the grid that owns the option columns.
    const group = screen.getByRole('radiogroup', { name: 'Charging Rate' });
    const optionGrid = group.querySelector('.grid');

    // Assert: No desktop utility introduces an empty third column.
    expect(optionGrid).toHaveClass('grid-cols-2');
    expect(optionGrid).not.toHaveClass('sm:grid-cols-3');
  });

  it('calls onChange with correct value when an option is clicked', () => {
    // Arrange: Render the matrix with a mock change handler
    const onChange = vi.fn();
    render(
      <TactileMatrix 
        label="Test Matrix" 
        options={options} 
        value="opt1" 
        onChange={onChange} 
      />
    );

    // Act: Click a non-selected option
    fireEvent.click(screen.getByText('Option 2'));
    
    // Assert: The change handler should be called with the option's value
    expect(onChange).toHaveBeenCalledWith('opt2');
  });

  it('does not allow selecting disabled options', () => {
    // Arrange: Render the matrix with a disabled middle option.
    const onChange = vi.fn();
    render(
      <TactileMatrix
        label="Test Matrix"
        options={optionsWithDisabled}
        value="opt1"
        onChange={onChange}
      />
    );

    // Act: Try to click the disabled option.
    fireEvent.click(screen.getByText('Option 2'));

    // Assert: Disabled options do not propagate changes.
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: 'Option 2' })).toBeDisabled();
  });

  it('applies active classes only to the selected option', () => {
    // Arrange: Select Option 2 as the active value.
    // Act: Render the matrix.
    render(
      <TactileMatrix 
        label="Test Matrix" 
        options={options} 
        value="opt2" 
        onChange={() => {}} 
      />
    );

    const activeOption = screen.getByRole('radio', { name: 'Option 2' });
    const idleOption = screen.getByRole('radio', { name: 'Option 1' });

    // Assert: Requirements: bg-primary text-surface shadow-md scale-[1.02]
    expect(activeOption).toHaveClass('bg-primary');
    expect(activeOption).toHaveClass('text-surface');
    expect(activeOption).toHaveClass('shadow-md');
    expect(activeOption).toHaveClass('scale-[1.02]');

    // Assert: Requirements: bg-secondary/10 text-primary hover:bg-secondary/20
    expect(idleOption).toHaveClass('bg-secondary/10');
    expect(idleOption).toHaveClass('text-primary');
    expect(idleOption).not.toHaveClass('bg-primary');
  });

  it('supports arrow key navigation', () => {
    // Arrange: Render the matrix with Option 1 selected
    const onChange = vi.fn();
    render(
      <TactileMatrix 
        label="Test Matrix" 
        options={options} 
        value="opt1" 
        onChange={onChange} 
      />
    );

    const firstOption = screen.getByText('Option 1');
    firstOption.focus();

    // Act: Press Right Arrow.
    fireEvent.keyDown(firstOption, { key: 'ArrowRight' });
    // Assert: Right Arrow moves to Option 2.
    expect(onChange).toHaveBeenCalledWith('opt2');

    // Act: Press Down Arrow.
    fireEvent.keyDown(firstOption, { key: 'ArrowDown' });
    // Assert: Down Arrow moves to Option 2.
    expect(onChange).toHaveBeenCalledWith('opt2');

    // Act: Press Left Arrow.
    fireEvent.keyDown(firstOption, { key: 'ArrowLeft' });
    // Assert: Left Arrow wraps to Option 3.
    expect(onChange).toHaveBeenCalledWith('opt3');

    // Act: Press Up Arrow.
    fireEvent.keyDown(firstOption, { key: 'ArrowUp' });
    // Assert: Up Arrow wraps to Option 3.
    expect(onChange).toHaveBeenCalledWith('opt3');
  });

  it('skips disabled options when navigating with arrow keys', () => {
    // Arrange: Render the matrix with a disabled middle option.
    const onChange = vi.fn();
    render(
      <TactileMatrix
        label="Test Matrix"
        options={optionsWithDisabled}
        value="opt1"
        onChange={onChange}
      />
    );

    const firstOption = screen.getByText('Option 1');
    firstOption.focus();

    // Act: Move right from the first option.
    fireEvent.keyDown(firstOption, { key: 'ArrowRight' });

    // Assert: Keyboard navigation skips the disabled option and lands on the next enabled one.
    expect(onChange).toHaveBeenCalledWith('opt3');
  });

  it('manages tabIndex correctly for radio group items', () => {
    // Arrange: Select Option 2 as the active value.
    // Act: Render the matrix.
    render(
      <TactileMatrix 
        label="Test Matrix" 
        options={options} 
        value="opt2" 
        onChange={() => {}} 
      />
    );

    const option1 = screen.getByRole('radio', { name: 'Option 1' });
    const option2 = screen.getByRole('radio', { name: 'Option 2' });
    const option3 = screen.getByRole('radio', { name: 'Option 3' });

    // Assert: Only the selected option (Option 2) should be in the tab sequence
    expect(option1).toHaveAttribute('tabindex', '-1');
    expect(option2).toHaveAttribute('tabindex', '0');
    expect(option3).toHaveAttribute('tabindex', '-1');
  });
});
