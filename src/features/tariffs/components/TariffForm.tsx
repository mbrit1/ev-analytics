import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Save, X, PlusCircle, Check, Calendar } from 'lucide-react';
import { useProviders } from '../hooks/useProviders';
import { parseDecimalToCents } from '../../../shared/lib';
import { useAuth } from '../../auth';
import { saveProvider } from '../services/providerService';
import { type Tariff } from '../../../infra/db';
import { Slab } from '../../../shared/ui';
import { ThinInput } from '../../../shared/ui';

/**
 * Form values stay as strings so users can type localized decimal prices before
 * submit converts them into integer cents for storage.
 */
const tariffSchema = z.object({
  /** Display name shown when selecting a tariff for a charging session. */
  tariff_name: z.string().min(1, 'Tariff name is required'),
  /** Provider that owns this tariff and filters charging-session choices. */
  provider_id: z.string().min(1, 'Provider is required'),
  /** AC charging price in euros per kWh, entered with comma or period decimals. */
  ac_price: z.string().regex(/^\d+([,.]\d{1,2})?$/, 'Invalid price format (max 2 decimals)'),
  /** DC charging price in euros per kWh, entered with comma or period decimals. */
  dc_price: z.string().regex(/^\d+([,.]\d{1,2})?$/, 'Invalid price format (max 2 decimals)'),
  /** Optional fixed fee charged once per session. */
  session_fee: z.string().regex(/^\d+([,.]\d{1,2})?$/, 'Invalid fee format (max 2 decimals)'),
  /** Date from which this tariff should be considered valid. */
  valid_from: z.string().min(1, 'Start date is required'),
});

type TariffFormValues = z.infer<typeof tariffSchema>;

export interface TariffFormProps {
  /** Persists the fully converted tariff record. */
  onSubmit: (data: Tariff) => Promise<void>;
  /** Closes the form without saving. */
  onCancel: () => void;
  /** Existing tariff values, converted to form-friendly strings for editing. */
  initialValues?: Omit<Partial<Tariff>, 'ac_price_per_kwh' | 'dc_price_per_kwh' | 'session_fee' | 'valid_from'> & { 
    ac_price?: string; 
    dc_price?: string; 
    session_fee?: string;
    valid_from?: string;
  };
}

/**
 * Captures tariff pricing and provider selection for offline-first persistence.
 *
 * Users can create a missing provider inline; after saving that provider, the
 * form selects it automatically so the tariff can be saved in one flow.
 */
export const TariffForm: React.FC<TariffFormProps> = ({ onSubmit, onCancel, initialValues }) => {
  const { providers } = useProviders();
  const { user } = useAuth();
  const [isAddingProvider, setIsAddingProvider] = useState(false);
  const [newProviderName, setNewProviderName] = useState('');

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<TariffFormValues>({
    resolver: zodResolver(tariffSchema),
    defaultValues: (initialValues as TariffFormValues) || {
      tariff_name: '',
      provider_id: '',
      ac_price: '',
      dc_price: '',
      session_fee: '0',
      valid_from: new Date().toISOString().split('T')[0],
    },
  });

  const handleAddProvider = async () => {
    // Inline provider creation is intentionally small: the provider is saved
    // locally, queued for sync, and selected for the tariff being edited.
    if (!user || !newProviderName.trim()) return;

    const provider = {
      id: crypto.randomUUID(),
      user_id: user.id,
      name: newProviderName.trim(),
      created_at: new Date(),
      updated_at: new Date(),
    };

    await saveProvider(provider);
    setValue('provider_id', provider.id);
    setIsAddingProvider(false);
    setNewProviderName('');
  };

  const handleFormSubmit = async (values: TariffFormValues) => {
    // Tariffs are user-owned; do not create local records without an auth owner.
    if (!user) return;

    // Convert localized euro strings into integer cents before persistence so
    // downstream cost calculations can avoid floating point currency math.
    const tariff: Tariff = {
      id: initialValues?.id || crypto.randomUUID(),
      user_id: user.id,
      provider_id: values.provider_id,
      tariff_name: values.tariff_name,
      ac_price_per_kwh: parseDecimalToCents(values.ac_price),
      dc_price_per_kwh: parseDecimalToCents(values.dc_price),
      session_fee: parseDecimalToCents(values.session_fee),
      valid_from: new Date(values.valid_from),
      created_at: initialValues?.created_at || new Date(),
      updated_at: new Date(),
    };

    await onSubmit(tariff);
  };

  return (
    <Slab>
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-bold text-primary">
          {initialValues?.id ? 'Edit Tariff' : 'New Tariff'}
        </h2>
        <button
          onClick={onCancel}
          className="p-2 text-secondary/40 hover:text-secondary rounded-full hover:bg-secondary/10 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Cancel"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-8" noValidate>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <ThinInput
            label="Tariff Name"
            type="text"
            {...register('tariff_name')}
            error={errors.tariff_name?.message}
            placeholder="e.g. Drive Free"
            className="text-2xl"
          />

          <div className="flex flex-col">
            <label htmlFor="provider_id" className="text-[13px] font-medium text-secondary uppercase tracking-wider mb-1">
              Provider
            </label>
            {!isAddingProvider ? (
              <div className="flex gap-2 items-baseline border-b border-secondary/20 focus-within:border-accent transition-colors duration-300">
                <select
                  id="provider_id"
                  {...register('provider_id')}
                  className="flex-1 py-2 bg-transparent text-xl font-medium outline-none min-h-[44px]"
                >
                  <option value="">Select Provider</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setIsAddingProvider(true)}
                  className="p-2 text-accent hover:bg-accent/10 rounded-lg transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                  aria-label="Add new provider"
                >
                  <PlusCircle className="w-6 h-6" />
                </button>
              </div>
            ) : (
              <div className="flex gap-2 items-baseline border-b border-accent transition-colors duration-300">
                <input
                  type="text"
                  value={newProviderName}
                  onChange={(e) => setNewProviderName(e.target.value)}
                  className="flex-1 py-2 bg-transparent text-xl font-medium outline-none min-h-[44px]"
                  placeholder="Provider name"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleAddProvider}
                  className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                  aria-label="Save provider"
                >
                  <Check className="w-6 h-6" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsAddingProvider(false)}
                  className="p-2 text-secondary hover:bg-secondary/10 rounded-lg transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                  aria-label="Cancel"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            )}
            {errors.provider_id && !isAddingProvider && (
              <p className="text-sm text-red-500 font-medium mt-1.5">{errors.provider_id.message}</p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-8">
          <ThinInput
            label="AC Price"
            unit="€/kWh"
            layout="horizontal"
            type="text"
            inputMode="decimal"
            {...register('ac_price')}
            error={errors.ac_price?.message}
            placeholder="0,55"
          />

          <ThinInput
            label="DC Price"
            unit="€/kWh"
            layout="horizontal"
            type="text"
            inputMode="decimal"
            {...register('dc_price')}
            error={errors.dc_price?.message}
            placeholder="0,79"
          />

          <ThinInput
            label="Session Fee"
            unit="€"
            layout="horizontal"
            type="text"
            inputMode="decimal"
            {...register('session_fee')}
            error={errors.session_fee?.message}
            placeholder="0,00"
          />
        </div>

        <div className="flex flex-col">
          <label htmlFor="valid_from" className="text-[13px] font-medium text-secondary uppercase tracking-wider mb-1">
            Valid From
          </label>
          <div className="flex items-baseline border-b border-secondary/20 focus-within:border-accent transition-colors duration-300 py-1">
            <Calendar className="w-5 h-5 mr-2 text-secondary/40" />
            <input
              id="valid_from"
              type="date"
              {...register('valid_from')}
              className="flex-1 bg-transparent text-xl font-medium outline-none"
            />
          </div>
          {errors.valid_from && (
            <p className="text-sm text-red-500 font-medium mt-1.5">{errors.valid_from.message}</p>
          )}
        </div>

        <div className="pt-6 flex flex-col sm:flex-row gap-4">
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex-1 flex items-center justify-center py-4 px-6 bg-accent text-white font-bold rounded-xl hover:opacity-90 transition-all disabled:opacity-50 min-h-[56px] shadow-lg shadow-accent/20"
          >
            {isSubmitting ? (
              <div className="w-5 h-5 border-2 border-surface/30 border-t-surface rounded-full animate-spin mr-2" />
            ) : (
              <Save className="w-5 h-5 mr-2" />
            )}
            {initialValues?.id ? 'Update Tariff' : 'Save Tariff'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-4 px-6 bg-secondary/10 text-primary font-bold rounded-xl hover:bg-secondary/20 transition-all min-h-[56px]"
          >
            Cancel
          </button>
        </div>
      </form>
    </Slab>
  );
};
