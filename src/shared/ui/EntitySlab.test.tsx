import { render, screen } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import * as SharedUi from './index';
import { describe, expect, it } from 'vitest';

interface EntitySlabProps {
  /** Consumer-owned primary entity content. */
  main: ReactNode;
  /** Consumer-owned exceptional actions that must remain outside the main root. */
  trailing?: ReactNode;
}

const EntitySlab = (SharedUi as {
  EntitySlab?: ComponentType<EntitySlabProps>;
}).EntitySlab;

/**
 * Test suite for the shared entity surface.
 *
 * Verifies that a domain-neutral article keeps ordinary entity navigation and
 * exceptional actions in separate consumer-owned slots.
 */
describe('EntitySlab', () => {
  it('keeps a consumer main anchor and trailing overflow as separate article children', () => {
    // Arrange: Supply a native main anchor and an exceptional sibling action.
    expect(EntitySlab).toBeDefined();
    if (!EntitySlab) return;

    // Act: Render the generic surface without any tariff-specific behavior.
    render(
      <EntitySlab
        main={(
          <a href="#tariffs/edit/provider-1%3A%3Alidl" aria-label="Open tariff Ionity Lidl">
            <h2>Ionity</h2>
            <p>Lidl</p>
          </a>
        )}
        trailing={<button type="button" aria-label="Tariff actions for Ionity Lidl">Actions</button>}
      />,
    );

    // Assert: The article is never interactive itself, and the overflow cannot become nested in the main anchor.
    const article = screen.getByRole('article');
    const mainAnchor = screen.getByRole('link', { name: 'Open tariff Ionity Lidl' });
    const overflow = screen.getByRole('button', { name: 'Tariff actions for Ionity Lidl' });
    expect(article).not.toHaveAttribute('role', 'link');
    expect(mainAnchor).not.toContainElement(overflow);
    expect(article).toContainElement(mainAnchor);
    expect(article).toContainElement(overflow);
  });
});
