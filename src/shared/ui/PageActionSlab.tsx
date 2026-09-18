import { useId, type ReactNode } from 'react';

/**
 * Properties for the domain-neutral page action surface.
 */
export interface PageActionSlabProps {
  /** Primary page heading shown in the surface. */
  heading: string;
  /** Supporting copy associated with the primary heading. */
  description: string;
  /** Consumer-owned primary action rendered beside the page context. */
  action: ReactNode;
  /** Optional local visual treatment for a consuming feature. */
  className?: string;
}

/**
 * Renders a page heading, associated description, and consumer-owned action slot.
 */
export function PageActionSlab({
  heading,
  description,
  action,
  className = '',
}: PageActionSlabProps) {
  const headingId = useId();
  const descriptionId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className={`flex flex-col gap-4 rounded-slab border border-slab-border p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6 ${className}`.trim()}
    >
      <div className="space-y-1">
        <h1 id={headingId} aria-describedby={descriptionId} className="text-2xl font-bold tracking-tight text-primary">
          {heading}
        </h1>
        <p id={descriptionId} className="text-sm text-secondary">
          {description}
        </p>
      </div>
      <div className="shrink-0">{action}</div>
    </section>
  );
}
