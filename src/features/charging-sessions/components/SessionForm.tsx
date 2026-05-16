import React from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Save, X, Calendar, FileText } from 'lucide-react';
import { useTariffs } from '../../tariffs/hooks/useTariffs';
import { useProviders } from '../../tariffs/hooks/useProviders';
import { useAuth } from '../../auth/hooks/useAuth';
import { type ChargingSession } from '../../../lib/db';
import { prepareSession } from '../services/sessionService';
import { Slab } from '../../../components/ui/Slab';
import { ThinInput } from '../../../components/ui/ThinInput';
import { TactileMatrix } from '../../../components/ui/TactileMatrix';

const sessionSchema = z.object({
  session_timestamp: z.string().min(1, 'Date is required'),
  provider_id: z.string().min(1, 'Provider is required'),
  tariff_id: z.string().min(1, 'Tariff is required'),
  location_type: z.enum(['Home', 'Work', 'Public', 'Fast Charger']),
  charging_type: z.enum(['AC', 'DC']),
  kwh_billed: z.string().regex(/^\d+([,.]\d{1,4})?$/, 'Invalid kWh format'),
  kwh_added: z.string().regex(/^\d+([,.]\d{1,4})?$/, 'Invalid kWh format').optional().or(z.literal('')),
  start_soc_percentage: z.string().regex(/^\d{1,3}$/, '0-100').refine(v => {
    const n = parseInt(v);
    return !isNaN(n) && n >= 0 && n <= 100;
  }, 'Must be 0-100'),
  end_soc_percentage: z.string().regex(/^\d{1,3}$/, '0-100').refine(v => {
    const n = parseInt(v);
    return !isNaN(n) && n >= 0 && n <= 100;
  }, 'Must be 0-100'),
  odometer_km: z.string().regex(/^\d*$/, 'Invalid number').optional(),
  notes: z.string().optional(),
});

type SessionFormValues = z.infer<typeof sessionSchema>;

interface SessionFormProps {
  onSubmit: (session: ChargingSession) => Promise<void>;
  onCancel: () => void;
  initialValues?: Partial<ChargingSession>;
}

export const SessionForm: React.FC<SessionFormProps> = ({ onSubmit, onCancel, initialValues }) => {
  const { user } = useAuth();
  const { tariffs } = useTariffs();
  const { providers } = useProviders();

  const {
    register,
    handleSubmit,
    watch,
    control,
    formState: { errors, isSubmitting },
  } = useForm<SessionFormValues>({
    resolver: zodResolver(sessionSchema),
    defaultValues: {
      session_timestamp: initialValues?.session_timestamp 
        ? initialValues.session_timestamp.toISOString().split('T')[0] 
        : new Date().toISOString().split('T')[0],
      location_type: (initialValues?.location_type as any) || 'Public',
      charging_type: (initialValues?.charging_type as any) || 'AC',
      start_soc_percentage: initialValues?.start_soc_percentage?.toString() || '20',
      end_soc_percentage: initialValues?.end_soc_percentage?.toString() || '80',
      provider_id: initialValues?.provider_id || '',
      tariff_id: initialValues?.tariff_id || '',
      kwh_billed: initialValues?.kwh_billed?.toString() || '',
      kwh_added: initialValues?.kwh_added?.toString() || '',
      odometer_km: initialValues?.odometer_km?.toString() || '',
      notes: initialValues?.notes || '',
    },
  });

  const selectedProviderId = watch('provider_id');

  const handleFormSubmit = async (values: SessionFormValues) => {
    if (!user) return;

    const tariff = tariffs.find(t => t.id === values.tariff_id);
    const provider = providers.find(p => p.id === values.provider_id);

    if (!tariff || !provider) return;

    const sessionInput: Parameters<typeof prepareSession>[0] = {
      user_id: user.id,
      session_timestamp: new Date(values.session_timestamp),
      provider_id: values.provider_id,
      tariff_id: values.tariff_id,
      location_type: values.location_type,
      charging_type: values.charging_type,
      kwh_billed: parseFloat(values.kwh_billed.replace(',', '.')),
      kwh_added: values.kwh_added ? parseFloat(values.kwh_added.replace(',', '.')) : undefined,
      start_soc_percentage: parseInt(values.start_soc_percentage),
      end_soc_percentage: parseInt(values.end_soc_percentage),
      odometer_km: values.odometer_km ? parseInt(values.odometer_km) : undefined,
      notes: values.notes,
    };

    const session = prepareSession(sessionInput, tariff, provider);
    await onSubmit(session);
  };

  return (
    <Slab className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-bold text-primary">
          {initialValues?.id ? 'Edit Session' : 'New Session'}
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
          {/* Date */}
          <div className="flex flex-col">
            <label htmlFor="session_timestamp" className="text-[13px] font-medium text-secondary uppercase tracking-wider mb-1">
              Date
            </label>
            <div className="flex items-baseline border-b border-secondary/20 focus-within:border-accent transition-colors duration-300 py-1">
              <Calendar className="w-5 h-5 mr-2 text-secondary/40" />
              <input
                id="session_timestamp"
                type="date"
                {...register('session_timestamp')}
                className="flex-1 bg-transparent text-xl font-medium outline-none"
              />
            </div>
            {errors.session_timestamp && (
              <p className="text-sm text-red-500 font-medium mt-1.5">{errors.session_timestamp.message}</p>
            )}
          </div>

          {/* Location Type */}
          <Controller
            name="location_type"
            control={control}
            render={({ field }) => (
              <TactileMatrix
                label="Location Type"
                value={field.value}
                onChange={field.onChange}
                options={[
                  { label: 'Public', value: 'Public' },
                  { label: 'Fast Charger', value: 'Fast Charger' },
                  { label: 'Home', value: 'Home' },
                  { label: 'Work', value: 'Work' },
                ]}
              />
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Provider */}
          <div className="flex flex-col">
            <label htmlFor="provider_id" className="text-[13px] font-medium text-secondary uppercase tracking-wider mb-1">
              Provider
            </label>
            <select
              id="provider_id"
              {...register('provider_id')}
              className="w-full px-0 py-2 border-b border-secondary/20 focus:border-accent outline-none bg-transparent text-xl font-medium min-h-[44px] transition-colors"
            >
              <option value="">Select Provider</option>
              {providers.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {errors.provider_id && (
              <p className="text-sm text-red-500 font-medium mt-1.5">{errors.provider_id.message}</p>
            )}
          </div>

          {/* Tariff */}
          <div className="flex flex-col">
            <label htmlFor="tariff_id" className="text-[13px] font-medium text-secondary uppercase tracking-wider mb-1">
              Tariff
            </label>
            <select
              id="tariff_id"
              {...register('tariff_id')}
              className="w-full px-0 py-2 border-b border-secondary/20 focus:border-accent outline-none bg-transparent text-xl font-medium min-h-[44px] transition-colors"
            >
              <option value="">Select Tariff</option>
              {tariffs
                .filter(t => !selectedProviderId || t.provider_id === selectedProviderId)
                .map(t => (
                  <option key={t.id} value={t.id}>{t.tariff_name}</option>
                ))}
            </select>
            {errors.tariff_id && (
              <p className="text-sm text-red-500 font-medium mt-1.5">{errors.tariff_id.message}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Charging Type */}
          <Controller
            name="charging_type"
            control={control}
            render={({ field }) => (
              <TactileMatrix
                label="Charging Type"
                value={field.value}
                onChange={field.onChange}
                options={[
                  { label: 'AC', value: 'AC' },
                  { label: 'DC', value: 'DC' },
                ]}
              />
            )}
          />

          {/* kWh Billed */}
          <ThinInput
            label="kWh Billed"
            unit="kWh"
            type="text"
            inputMode="decimal"
            placeholder="0,00"
            {...register('kwh_billed')}
            error={errors.kwh_billed?.message}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* kWh Added */}
          <ThinInput
            label="kWh Added"
            unit="kWh"
            type="text"
            inputMode="decimal"
            placeholder="0,00"
            {...register('kwh_added')}
            error={errors.kwh_added?.message}
          />

          {/* Odometer */}
          <ThinInput
            label="Odometer"
            unit="km"
            type="text"
            inputMode="numeric"
            placeholder="0"
            {...register('odometer_km')}
            error={errors.odometer_km?.message}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Start SoC */}
          <ThinInput
            label="Start SoC"
            unit="%"
            type="text"
            inputMode="numeric"
            placeholder="20"
            {...register('start_soc_percentage')}
            error={errors.start_soc_percentage?.message}
          />

          {/* End SoC */}
          <ThinInput
            label="End SoC"
            unit="%"
            type="text"
            inputMode="numeric"
            placeholder="80"
            {...register('end_soc_percentage')}
            error={errors.end_soc_percentage?.message}
          />
        </div>

        {/* Notes */}
        <div className="flex flex-col">
          <label htmlFor="notes" className="text-[13px] font-medium text-secondary uppercase tracking-wider mb-1 flex items-center">
            <FileText className="w-4 h-4 mr-1 text-secondary/40" />
            Notes
          </label>
          <textarea
            id="notes"
            {...register('notes')}
            rows={2}
            className="w-full px-0 py-2 border-b border-secondary/20 focus:border-accent outline-none bg-transparent text-lg transition-colors resize-none"
            placeholder="Optional notes..."
          />
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
            Save Session
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
