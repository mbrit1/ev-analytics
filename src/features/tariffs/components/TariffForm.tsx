import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Save, X, PlusCircle, Check, Calendar } from 'lucide-react';
import { useProviders } from '../hooks/useProviders';
import { parseDecimalToCents } from '../../../lib/utils';
import { useAuth } from '../../auth/hooks/useAuth';
import { saveProvider } from '../services/providerService';
import { type Tariff } from '../../../lib/db';
import { Slab } from '../../../components/ui/Slab';
import { ThinInput } from '../../../components/ui/ThinInput';

const tariffSchema = z.object({
  tariff_name: z.string().min(1, 'Tariff name is required'),
  provider_id: z.string().min(1, 'Provider is required'),
  ac_price: z.string().regex(/^\d+([,.]\d{1,2})?$/, 'Invalid price format (max 2 decimals)'),
  dc_price: z.string().regex(/^\d+([,.]\d{1,2})?$/, 'Invalid price format (max 2 decimals)'),
  session_fee: z.string().regex(/^\d+([,.]\d{1,2})?$/, 'Invalid fee format (max 2 decimals)'),
  valid_from: z.string().min(1, 'Start date is required'),
});

type TariffFormValues = z.infer<typeof tariffSchema>;

interface TariffFormProps {
  onSubmit: (data: Tariff) => Promise<void>;
  onCancel: () => void;
  initialValues?: Omit<Partial<Tariff>, 'ac_price_per_kwh' | 'dc_price_per_kwh' | 'session_fee' | 'valid_from'> & { 
    ac_price?: string; 
    dc_price?: string; 
    session_fee?: string;
    valid_from?: string;
  };
}

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
    if (!user) return;

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
    <Slab className="max-w-2xl mx-auto">
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <ThinInput
            label="AC Price"
            unit="€/kWh"
            type="text"
            inputMode="decimal"
            {...register('ac_price')}
            error={errors.ac_price?.message}
            placeholder="0,55"
          />

          <ThinInput
            label="DC Price"
            unit="€/kWh"
            type="text"
            inputMode="decimal"
            {...register('dc_price')}
            error={errors.dc_price?.message}
            placeholder="0,79"
          />

          <ThinInput
            label="Session Fee"
            unit="€"
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
            className="flex-1 flex items-center justify-center py-4 px-6 bg-primary text-surface font-bold rounded-xl hover:opacity-90 transition-all disabled:opacity-50 min-h-[56px] shadow-lg shadow-primary/20"
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
