import type { ReactNode } from 'react';

/** Properties for the domain-neutral entity surface. */
export interface EntitySlabProps {
  /** Consumer-owned primary entity content. */
  main: ReactNode;
  /** Consumer-owned exceptional actions kept outside the primary content. */
  trailing?: ReactNode;
  /** Whether the primary content drives the article's interaction state. */
  mainInteraction?: boolean;
}

/** Generic, non-interactive article surface for an entity and its actions. */
export function EntitySlab({ main, trailing, mainInteraction = false }: EntitySlabProps) {
  return (
    <article
      className={`relative isolate space-y-4 rounded-2xl bg-surface p-6 shadow-slab ${
        mainInteraction
          ? "before:pointer-events-none before:absolute before:inset-0 before:z-0 before:rounded-[inherit] before:content-[''] before:transition-colors before:duration-150 motion-reduce:before:transition-none [&:has([data-entity-slab-main]:active)]:before:bg-secondary/10 [&:has([data-entity-slab-main]_:focus-visible)]:ring-2 [&:has([data-entity-slab-main]_:focus-visible)]:ring-accent/70 [&:has([data-entity-slab-main]_:focus-visible)]:ring-offset-2 [&:has([data-entity-slab-main]_:focus-visible)]:ring-offset-surface [@media(hover:hover)_and_(pointer:fine)]:[&:has([data-entity-slab-main]:hover)]:before:bg-secondary/5"
          : ''
      }`}
    >
      <div className="relative z-10 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1" data-entity-slab-main={mainInteraction ? '' : undefined}>{main}</div>
        {trailing ? <div className="shrink-0">{trailing}</div> : null}
      </div>
    </article>
  );
}
