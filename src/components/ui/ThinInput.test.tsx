import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, it, expect } from 'vitest';
import { ThinInput } from './ThinInput';

describe('ThinInput', () => {
  it('renders the label correctly', () => {
    render(<ThinInput label="Odometer" />);
    expect(screen.getByText('Odometer')).toBeInTheDocument();
  });

  it('renders the unit correctly when provided', () => {
    render(<ThinInput label="Distance" unit="km" />);
    expect(screen.getByText('km')).toBeInTheDocument();
  });

  it('renders an error message when provided', () => {
    render(<ThinInput label="Odometer" error="Value is too low" />);
    expect(screen.getByText('Value is too low')).toBeInTheDocument();
  });

  it('forwards the ref to the input element', () => {
    const ref = createRef<HTMLInputElement>();
    render(<ThinInput label="Odometer" ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it('passes standard input props to the input element', () => {
    render(
      <ThinInput 
        label="Odometer" 
        placeholder="0" 
        type="number" 
        name="odometer"
      />
    );
    const input = screen.getByLabelText('Odometer');
    expect(input).toHaveAttribute('placeholder', '0');
    expect(input).toHaveAttribute('type', 'number');
    expect(input).toHaveAttribute('name', 'odometer');
  });

  it('associates the label with the input via id', () => {
    render(<ThinInput label="Energy used" />);
    const label = screen.getByText('Energy used');
    const input = screen.getByLabelText('Energy used');
    expect(label).toHaveAttribute('for', input.getAttribute('id'));
  });
});
