import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TactileMatrix } from './TactileMatrix';

describe('TactileMatrix', () => {
  const options = [
    { label: 'Option 1', value: 'opt1' },
    { label: 'Option 2', value: 'opt2' },
    { label: 'Option 3', value: 'opt3' },
  ];

  it('renders label and all options', () => {
    render(
      <TactileMatrix 
        label="Test Matrix" 
        options={options} 
        value="opt1" 
        onChange={() => {}} 
      />
    );

    expect(screen.getByText('Test Matrix')).toBeInTheDocument();
    options.forEach(option => {
      expect(screen.getByText(option.label)).toBeInTheDocument();
    });
  });

  it('calls onChange with correct value when an option is clicked', () => {
    const onChange = vi.fn();
    render(
      <TactileMatrix 
        label="Test Matrix" 
        options={options} 
        value="opt1" 
        onChange={onChange} 
      />
    );

    fireEvent.click(screen.getByText('Option 2'));
    expect(onChange).toHaveBeenCalledWith('opt2');
  });

  it('applies active classes only to the selected option', () => {
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

    // Requirements: bg-primary text-surface shadow-md scale-[1.02]
    expect(activeOption).toHaveClass('bg-primary');
    expect(activeOption).toHaveClass('text-surface');
    expect(activeOption).toHaveClass('shadow-md');
    expect(activeOption).toHaveClass('scale-[1.02]');

    // Requirements: bg-secondary/10 text-primary hover:bg-secondary/20
    expect(idleOption).toHaveClass('bg-secondary/10');
    expect(idleOption).toHaveClass('text-primary');
    expect(idleOption).not.toHaveClass('bg-primary');
  });
});
