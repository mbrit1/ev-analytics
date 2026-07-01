import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Slab } from './Slab';

/**
 * Test suite for the Slab component.
 * Focuses on checking rendering behavior and class name composition.
 */
describe('Slab', () => {
  it('renders children correctly', () => {
    // Arrange: Provide nested child content.
    // Act: Render the Slab component.
    render(
      <Slab>
        <div data-testid="child">Hello World</div>
      </Slab>
    );
    
    // Assert: Verify the child and its text are present
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('applies default sandbox classes', () => {
    // Arrange: Use the default Slab props.
    // Act: Render the Slab component.
    const { container } = render(<Slab>Content</Slab>);
    const slabElement = container.firstChild as HTMLElement;
    
    const expectedClasses = [
      'bg-surface',
      'border',
      'border-slab-border',
      'rounded-slab',
      'shadow-slab',
      'p-8',
      'transition-all',
      'duration-300'
    ];
    
    // Assert: Verify all sandbox token design classes are applied
    expectedClasses.forEach(className => {
      expect(slabElement).toHaveClass(className);
    });
  });

  it('merges custom className with default classes', () => {
    // Arrange: Provide an extra class name.
    // Act: Render the Slab component.
    const { container } = render(<Slab className="custom-class">Content</Slab>);
    const slabElement = container.firstChild as HTMLElement;
    
    // Assert: Verify both default base classes and the custom class exist
    expect(slabElement).toHaveClass('bg-surface');
    expect(slabElement).toHaveClass('custom-class');
  });

  it('removes default padding when the padding mode is none', () => {
    // Arrange: Request a slab whose child owns the internal spacing.
    // Act: Render the slab without default padding.
    const { container } = render(<Slab padding="none">Content</Slab>);
    const slabElement = container.firstChild as HTMLElement;

    // Assert: The default padding utility is not emitted.
    expect(slabElement).not.toHaveClass('p-8');
  });

  it('forwards standard HTML attributes to the slab container', () => {
    // Arrange: Provide accessibility and test attributes for the container.
    // Act: Render a busy analytics slab.
    render(<Slab aria-busy="true" data-testid="analytics-slab">Content</Slab>);

    // Assert: Consumers can expose semantic container state through Slab.
    expect(screen.getByTestId('analytics-slab')).toHaveAttribute('aria-busy', 'true');
  });
});
