import React from 'react';

interface SlabProps {
  children: React.ReactNode;
  className?: string;
}

export const Slab: React.FC<SlabProps> = ({ children, className = '' }) => {
  const baseClasses = 'bg-surface border border-secondary/10 rounded-slab shadow-slab p-8 transition-colors duration-300';
  const combinedClasses = `${baseClasses} ${className}`.trim();

  return (
    <div className={combinedClasses}>
      {children}
    </div>
  );
};
