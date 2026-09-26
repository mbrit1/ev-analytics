import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PageActionSlab, type PageActionSlabProps } from './PageActionSlab';

/**
 * Test suite for the shared page action surface.
 *
 * Verifies that the shared standard action and consumer-owned custom action
 * are exposed with the page context in one accessible heading region.
 */
describe('PageActionSlab', () => {
  it('renders the standard action with accessible and responsive presentation', () => {
    // Arrange: Provide page copy, a standard action, and a live button ref.
    const onAction = vi.fn();
    const actionRef = createRef<HTMLButtonElement>();
    render(
      <PageActionSlab
        heading="Sessions"
        description="Review charging sessions"
        actionLabel="Add Session"
        onAction={onAction}
        actionRef={actionRef}
      />,
    );

    // Assert: The heading and description remain associated with the section.
    const heading = screen.getByRole('heading', { name: 'Sessions', level: 1 });
    const description = screen.getByText('Review charging sessions');
    const surface = screen.getByRole('region', { name: 'Sessions' });
    expect(heading).toHaveAttribute('aria-describedby', description.id);

    // Assert: The standard button exposes its accessible name at every width.
    const action = screen.getByRole('button', { name: 'Add Session' });
    expect(action).toHaveAttribute('type', 'button');
    expect(action).toHaveClass(
      'inline-flex',
      'min-h-[44px]',
      'min-w-[44px]',
      'items-center',
      'justify-center',
      'rounded-xl',
      'bg-accent',
      'px-3',
      'py-2',
      'font-bold',
      'text-white',
      'transition-opacity',
      '[@media(hover:hover)_and_(pointer:fine)]:hover:opacity-90',
      'focus-visible:outline-none',
      'focus-visible:ring-2',
      'focus-visible:ring-accent/60',
      'focus-visible:ring-offset-2',
      'focus-visible:ring-offset-surface',
      'motion-reduce:transition-none',
      'md:px-4',
    );
    const visibleLabel = screen.getByText('Add Session');
    expect(visibleLabel).toHaveClass('hidden', 'md:inline', 'md:pl-2');
    const icon = action.querySelector('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).toHaveClass('h-5', 'w-5');
    expect(actionRef.current).toBe(action);

    // Act: Activate the standard action.
    fireEvent.click(action);

    // Assert: The shared control invokes the consumer callback.
    expect(onAction).toHaveBeenCalledOnce();
    expect(surface).toBeInTheDocument();
  });

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

  it('keeps standard and custom action props mutually exclusive', () => {
    // Arrange: Keep invalid prop combinations in the checked TypeScript source.
    // @ts-expect-error A custom action cannot also use standard action props.
    const invalidCustomAndStandardProps = ({ heading: 'Sessions', description: 'Review charging sessions', action: <button type="button">Custom action</button>, actionLabel: 'Add Session', onAction: () => {} } satisfies PageActionSlabProps);
    // @ts-expect-error A standard action requires its callback.
    const invalidStandardShape = ({ heading: 'Sessions', description: 'Review charging sessions', actionLabel: 'Add Session' } satisfies PageActionSlabProps);

    // Assert: The invalid examples remain compile-time-only coverage.
    expect(invalidCustomAndStandardProps).toBeDefined();
    expect(invalidStandardShape).toBeDefined();
  });
});
