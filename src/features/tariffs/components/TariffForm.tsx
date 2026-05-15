import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Plus, Save, X, PlusCircle, Check } from 'lucide-react';
import { useProviders } from '../hooks/useProviders';
import { parseDecimalToCents } from '../../../lib/utils';
import { useAuth } from '../../auth/hooks/useAuth';
import { saveProvider } from '../services/providerService';
import { type Tariff } from '../../../lib/db';

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
    <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900">
          {initialValues?.id ? 'Edit Tariff' : 'New Tariff'}
        </h2>
        <button
          onClick={onCancel}
          className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors"
          aria-label="Cancel"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4" noValidate>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label htmlFor="tariff_name" className="block text-sm font-medium text-slate-700">
              Tariff Name
            </label>
            <input
              id="tariff_name"
              type="text"
              {...register('tariff_name')}
              aria-invalid={!!errors.tariff_name}
              aria-describedby={errors.tariff_name ? 'tariff_name_error' : undefined}
              className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="e.g. Drive Free"
            />
            {errors.tariff_name && (
              <p id="tariff_name_error" className="text-sm text-red-600">{errors.tariff_name.message}</p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="provider_id" className="block text-sm font-medium text-slate-700">
              Provider
            </label>
            {!isAddingProvider ? (
              <div className="flex gap-2">
                <select
                  id="provider_id"
                  {...register('provider_id')}
                  aria-invalid={!!errors.provider_id}
                  aria-describedby={errors.provider_id ? 'provider_id_error' : undefined}
                  className="flex-1 px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
                >
                  <option value="">Select a provider</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setIsAddingProvider(true)}
                  className="p-3 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors border border-blue-200 min-w-[44px] min-h-[44px] flex items-center justify-center"
                  aria-label="Add new provider"
                >
                  <PlusCircle className="w-6 h-6" />
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newProviderName}
                  onChange={(e) => setNewProviderName(e.target.value)}
                  className="flex-1 px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  placeholder="Provider name"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleAddProvider}
                  className="p-3 text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                  aria-label="Save provider"
                >
                  <Check className="w-6 h-6" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsAddingProvider(false)}
                  className="p-3 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                  aria-label="Cancel"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            )}
            {errors.provider_id && !isAddingProvider && (
              <p id="provider_id_error" className="text-sm text-red-600">{errors.provider_id.message}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1">
            <label htmlFor="ac_price" className="block text-sm font-medium text-slate-700">
              AC Price (€/kWh)
            </label>
            <input
              id="ac_price"
              type="text"
              inputMode="decimal"
              {...register('ac_price')}
              aria-invalid={!!errors.ac_price}
              aria-describedby={errors.ac_price ? 'ac_price_error' : undefined}
              className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="0,55"
            />
            {errors.ac_price && (
              <p id="ac_price_error" className="text-sm text-red-600">{errors.ac_price.message}</p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="dc_price" className="block text-sm font-medium text-slate-700">
              DC Price (€/kWh)
            </label>
            <input
              id="dc_price"
              type="text"
              inputMode="decimal"
              {...register('dc_price')}
              aria-invalid={!!errors.dc_price}
              aria-describedby={errors.dc_price ? 'dc_price_error' : undefined}
              className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="0,79"
            />
            {errors.dc_price && (
              <p id="dc_price_error" className="text-sm text-red-600">{errors.dc_price.message}</p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="session_fee" className="block text-sm font-medium text-slate-700">
              Session Fee (€)
            </label>
            <input
              id="session_fee"
              type="text"
              inputMode="decimal"
              {...register('session_fee')}
              aria-invalid={!!errors.session_fee}
              aria-describedby={errors.session_fee ? 'session_fee_error' : undefined}
              className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="0,00"
            />
            {errors.session_fee && (
              <p id="session_fee_error" className="text-sm text-red-600">{errors.session_fee.message}</p>
            )}
          </div>
        </div>

        <div className="space-y-1">
          <label htmlFor="valid_from" className="block text-sm font-medium text-slate-700">
            Valid From
          </label>
          <input
            id="valid_from"
            type="date"
            {...register('valid_from')}
            aria-invalid={!!errors.valid_from}
            aria-describedby={errors.valid_from ? 'valid_from_error' : undefined}
            className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
          {errors.valid_from && (
            <p id="valid_from_error" className="text-sm text-red-600">{errors.valid_from.message}</p>
          )}
        </div>

        <div className="pt-4 flex flex-col md:flex-row gap-3">
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex-1 flex items-center justify-center py-3 px-4 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 min-h-[44px]"
          >
            {isSubmitting ? (
              <Plus className="w-5 h-5 animate-spin mr-2" />
            ) : (
              <Save className="w-5 h-5 mr-2" />
            )}
            {initialValues?.id ? 'Update Tariff' : 'Save Tariff'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-3 px-4 bg-slate-100 text-slate-700 font-bold rounded-lg hover:bg-slate-200 transition-colors min-h-[44px]"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};
