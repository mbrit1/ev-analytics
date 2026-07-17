import type { UseFormRegisterReturn } from 'react-hook-form';
import { ThinInput } from '../../../shared/ui';

interface AdHocIdentityFieldsProps {
  /** React Hook Form registration for the required billing-provider value. */
  billingProviderRegistration: UseFormRegisterReturn<'billing_provider_name'>;
  /** Current billing-provider validation message, when invalid. */
  billingProviderError?: string;
  /** React Hook Form registration for the optional operator value. */
  cpoRegistration: UseFormRegisterReturn<'cpo_name'>;
}

/**
 * Captures the commercial identities for an ad-hoc session without exposing
 * saved tariff providers in the one-off charging workflow.
 */
export function AdHocIdentityFields({
  billingProviderRegistration,
  billingProviderError,
  cpoRegistration,
}: AdHocIdentityFieldsProps) {
  return (
    <>
      <div className="flex flex-col" aria-live="polite">
        <ThinInput
          id="ad-hoc-billing-provider"
          label="Billing provider"
          type="text"
          align="left"
          required
          requiredIndicator
          aria-required="true"
          aria-describedby="ad-hoc-billing-provider-help"
          className="min-h-[44px]"
          {...billingProviderRegistration}
          error={billingProviderError}
        />
        <p id="ad-hoc-billing-provider-help" className="mt-1.5 text-sm text-secondary">
          Company or app that charged you
        </p>
      </div>

      <div className="flex flex-col">
        <ThinInput
          id="ad-hoc-cpo"
          label="Charging-station operator (CPO)"
          type="text"
          align="left"
          aria-describedby="ad-hoc-cpo-help"
          className="min-h-[44px]"
          {...cpoRegistration}
        />
        <p id="ad-hoc-cpo-help" className="mt-1.5 text-sm text-secondary">
          Who operates the charger? Leave blank if unknown.
        </p>
      </div>
    </>
  );
}
