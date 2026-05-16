import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Slab } from './Slab';

describe('Slab', () => {
  it('renders children correctly', () => {
    render(
      <Slab>
        <div data-testid="child">Hello World</div>
      </Slab>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('applies default sandbox classes', () => {
    const { container } = render(<Slab>Content</Slab>);
    const slabElement = container.firstChild as HTMLElement;
    
    const expectedClasses = [
      'bg-surface',
      'border',
      'border-secondary/10',
      'rounded-slab',
      'shadow-slab',
      'p-8',
      'transition-colors',
      'duration-300'
    ];
    
    expectedClasses.forEach(className => {
      expect(slabElement).toHaveClass(className);
    });
  });

  it('merges custom className with default classes', () => {
    const { container } = render(<Slab className="custom-class">Content</Slab>);
    const slabElement = container.firstChild as HTMLElement;
    
    expect(slabElement).toHaveClass('bg-surface');
    expect(slabElement).toHaveClass('custom-class');
  });
});
