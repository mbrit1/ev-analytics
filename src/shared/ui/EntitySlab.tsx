import type { ReactNode } from 'react';

/** Properties for the domain-neutral entity surface. */
export interface EntitySlabProps {
  /** Consumer-owned primary entity content. */
  main: ReactNode;
  /** Consumer-owned exceptional actions kept outside the primary content. */
  trailing?: ReactNode;
}

/** Generic, non-interactive article surface for an entity and its actions. */
export function EntitySlab({ main, trailing }: EntitySlabProps) {
  return (
    <article className="space-y-4 rounded-2xl bg-surface p-6 shadow-slab">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">{main}</div>
        {trailing ? <div className="shrink-0">{trailing}</div> : null}
      </div>
    </article>
  );
}
