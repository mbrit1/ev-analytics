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

  it('renders label and all options', () => {
    // Arrange & Act: Render the matrix with predefined options
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

  it('applies active classes only to the selected option', () => {
    // Arrange & Act: Render the matrix with Option 2 selected
    render(
      <TactileMatrix 
        label="Test Matrix" 
        options={options} 
        value="opt2" 
        onChange={() => {}} 
      />
    );

    const activeOption = screen.getByText('Option 2');
    const idleOption = screen.getByText('Option 1');

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

    // Act & Assert: Right Arrow moves to Option 2
    fireEvent.keyDown(firstOption, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('opt2');

    // Act & Assert: Down Arrow moves to Option 2
    fireEvent.keyDown(firstOption, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenCalledWith('opt2');

    // Act & Assert: Left Arrow wraps to Option 3
    fireEvent.keyDown(firstOption, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('opt3');

    // Act & Assert: Up Arrow wraps to Option 3
    fireEvent.keyDown(firstOption, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledWith('opt3');
  });

  it('manages tabIndex correctly for radio group items', () => {
    // Arrange & Act: Render the matrix with Option 2 selected
    render(
      <TactileMatrix 
        label="Test Matrix" 
        options={options} 
        value="opt2" 
        onChange={() => {}} 
      />
    );

    const option1 = screen.getByText('Option 1');
    const option2 = screen.getByText('Option 2');
    const option3 = screen.getByText('Option 3');

    // Assert: Only the selected option (Option 2) should be in the tab sequence
    expect(option1).toHaveAttribute('tabindex', '-1');
    expect(option2).toHaveAttribute('tabindex', '0');
    expect(option3).toHaveAttribute('tabindex', '-1');
  });
});
