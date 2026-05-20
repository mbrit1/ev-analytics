import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, it, expect } from 'vitest';
import { ThinInput } from './ThinInput';

/**
 * Test suite for the ThinInput component.
 * Focuses on rendering, prop forwarding, layout variations, and accessibility attributes.
 */
describe('ThinInput', () => {
  it('renders the label correctly', () => {
    // Arrange: Provide a visible label.
    // Act: Render the input.
    render(<ThinInput label="Odometer" />);
    // Assert: Verify label is present
    expect(screen.getByText('Odometer')).toBeInTheDocument();
  });

  it('renders the unit correctly when provided', () => {
    // Arrange: Provide a unit suffix.
    // Act: Render the input.
    render(<ThinInput label="Distance" unit="km" />);
    // Assert: Verify unit is present
    expect(screen.getByText('km')).toBeInTheDocument();
  });

  it('renders an error message when provided', () => {
    // Arrange: Provide an error message.
    // Act: Render the input.
    render(<ThinInput label="Odometer" error="Value is too low" />);
    // Assert: Verify error is present
    expect(screen.getByText('Value is too low')).toBeInTheDocument();
  });

  it('forwards the ref to the input element', () => {
    // Arrange: Create a ref
    const ref = createRef<HTMLInputElement>();
    // Act: Render with the ref
    render(<ThinInput label="Odometer" ref={ref} />);
    // Assert: Verify ref is attached to the input
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it('passes standard input props to the input element', () => {
    // Arrange: Provide standard input attributes.
    // Act: Render the input.
    render(
      <ThinInput 
        label="Odometer" 
        placeholder="0" 
        type="number" 
        name="odometer"
      />
    );
    
    // Assert: Verify standard attributes are applied
    const input = screen.getByLabelText('Odometer');
    expect(input).toHaveAttribute('placeholder', '0');
    expect(input).toHaveAttribute('type', 'number');
    expect(input).toHaveAttribute('name', 'odometer');
  });

  it('associates the label with the input via id', () => {
    // Arrange: Provide a label without an explicit id.
    // Act: Render the input.
    render(<ThinInput label="Energy used" />);
    
    // Assert: Verify standard a11y label association
    const label = screen.getByText('Energy used');
    const input = screen.getByLabelText('Energy used');
    expect(label).toHaveAttribute('for', input.getAttribute('id'));
  });

  it('applies horizontal layout classes when requested', () => {
    // Arrange: Request horizontal layout.
    // Act: Render the input.
    const { container } = render(<ThinInput label="kWh Billed" layout="horizontal" />);
    const wrapper = container.firstChild as HTMLElement;
    
    // Assert: Verify specific responsive flex classes
    expect(wrapper).toHaveClass('md:flex-row');
    expect(wrapper).toHaveClass('md:items-center');
    expect(wrapper).toHaveClass('md:border-b');
  });
});
