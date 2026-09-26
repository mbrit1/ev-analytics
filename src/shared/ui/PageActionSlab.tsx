import { Plus } from 'lucide-react';
import { useId, type ReactNode, type Ref } from 'react';

/**
 * Shared page context and either its standard button action or a custom action.
 */
type PageActionSlabBaseProps = {
  heading: string;
  description: string;
  className?: string;
};

type PageActionSlabStandardActionProps = {
  actionLabel: string;
  onAction: () => void;
  actionRef?: Ref<HTMLButtonElement>;
  action?: never;
};

type PageActionSlabCustomActionProps = {
  action: ReactNode;
  actionLabel?: never;
  onAction?: never;
  actionRef?: never;
};

export type PageActionSlabProps = PageActionSlabBaseProps &
  (PageActionSlabStandardActionProps | PageActionSlabCustomActionProps);

/**
 * Renders page context with a shared standard button or consumer-owned custom action.
 */
export function PageActionSlab({
  heading,
  description,
  className = '',
  action,
  actionLabel,
  onAction,
  actionRef,
}: PageActionSlabProps) {
  const headingId = useId();
  const descriptionId = useId();
  const renderedAction = typeof actionLabel === 'string' ? (
    <button
      type="button"
      aria-label={actionLabel}
      onClick={onAction}
      ref={actionRef}
      className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-accent px-3 py-2 font-bold text-white transition-opacity [@media(hover:hover)_and_(pointer:fine)]:hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-reduce:transition-none md:px-4"
    >
      <Plus aria-hidden="true" className="h-5 w-5" />
      <span className="hidden md:inline md:pl-2">{actionLabel}</span>
    </button>
  ) : action;

  return (
    <section
      aria-labelledby={headingId}
      className={`flex flex-row items-center justify-between gap-3 rounded-slab border border-slab-border bg-surface p-[18px_20px] shadow-slab sm:p-6 ${className}`.trim()}
    >
      <div className="space-y-1">
        <h1 id={headingId} aria-describedby={descriptionId} className="text-2xl font-bold tracking-tight text-primary">
          {heading}
        </h1>
        <p id={descriptionId} className="text-sm text-secondary">
          {description}
        </p>
      </div>
      <div className="shrink-0">{renderedAction}</div>
    </section>
  );
}
