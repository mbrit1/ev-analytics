import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Slab } from './Slab';

/**
 * Test suite for the Slab component.
 * Focuses on checking rendering behavior and class name composition.
 */
describe('Slab', () => {
  it('renders children correctly', () => {
    // Arrange & Act: Render the Slab component with a nested test child
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
    // Arrange & Act: Render the Slab component
    const { container } = render(<Slab>Content</Slab>);
    const slabElement = container.firstChild as HTMLElement;
    
    const expectedClasses = [
      'bg-surface',
      'border',
      'border-secondary/10',
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
    // Arrange & Act: Render the Slab component with an extra class
    const { container } = render(<Slab className="custom-class">Content</Slab>);
    const slabElement = container.firstChild as HTMLElement;
    
    // Assert: Verify both default base classes and the custom class exist
    expect(slabElement).toHaveClass('bg-surface');
    expect(slabElement).toHaveClass('custom-class');
  });
});
