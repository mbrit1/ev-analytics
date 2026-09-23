import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageActionSlab } from './PageActionSlab';

/**
 * Test suite for the shared page action surface.
 *
 * Verifies that domain-neutral page context and the consumer-owned action are
 * exposed as one accessible heading region.
 */
describe('PageActionSlab', () => {
  it('associates a semantic heading and description with the consumer action slot', () => {
    // Arrange: Provide neutral page copy and a consumer-owned 44px primary action.
    render(
      <PageActionSlab
        heading="Tariffs"
        description="Manage charging prices"
        action={(
          <button
            type="button"
            aria-label="Add tariff"
            className="min-h-[44px] min-w-[44px]"
          >
            Add tariff
          </button>
        )}
      />,
    );

    // Assert: Consumers receive an associated heading, description, and intact action target.
    const heading = screen.getByRole('heading', { name: 'Tariffs', level: 1 });
    const description = screen.getByText('Manage charging prices');
    const action = screen.getByRole('button', { name: 'Add tariff' });
    const surface = screen.getByRole('region', { name: 'Tariffs' });
    expect(heading).toHaveAttribute('aria-describedby', description.id);
    expect(description).toHaveAttribute('id');
    expect(surface).toHaveClass(
      'flex-row',
      'bg-surface',
      'p-[18px_20px]',
      'shadow-slab',
      'sm:p-6',
    );
    expect(action).toHaveClass('min-h-[44px]', 'min-w-[44px]');
  });
});
