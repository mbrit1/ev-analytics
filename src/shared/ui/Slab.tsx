import React from 'react';

/**
 * Properties for the Slab component.
 */
interface SlabProps {
  /** The content to be wrapped inside the slab. */
  children: React.ReactNode;
  /** Optional extra CSS classes to apply to the container. */
  className?: string;
}

/**
 * Floating container component for the Sandbox v2.0 design system.
 * 
 * Applies standard padding, border, shadow, and border-radius consistently
 * across major content blocks.
 *
 * @param props - Component properties ({@link SlabProps})
 * @returns The rendered slab container.
 */
export const Slab: React.FC<SlabProps> = ({ children, className = '' }) => {
  const baseClasses = 'bg-surface border border-slab-border rounded-slab shadow-slab p-8 transition-all duration-300';
  const combinedClasses = `${baseClasses} ${className}`.trim();

  return (
    <div className={combinedClasses}>
      {children}
    </div>
  );
};
