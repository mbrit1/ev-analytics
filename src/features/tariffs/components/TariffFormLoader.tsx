import React, { Suspense, lazy } from 'react';
import type { TariffFormProps } from './TariffForm';

const LazyTariffForm = lazy(() =>
  import('./TariffForm').then((module) => ({ default: module.TariffForm }))
);

/**
 * Defers tariff form and validation stack loading until the form is opened.
 */
export const TariffFormLoader: React.FC<TariffFormProps> = (props) => {
  return (
    <Suspense fallback={<div className="text-secondary text-sm">Loading tariff form...</div>}>
      <LazyTariffForm {...props} />
    </Suspense>
  );
};
