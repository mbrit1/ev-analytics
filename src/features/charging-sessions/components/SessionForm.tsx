import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Save, X, Zap, Calendar, MapPin, Gauge, Percent, FileText } from 'lucide-react';
import { useTariffs } from '../../tariffs/hooks/useTariffs';
import { useProviders } from '../../tariffs/hooks/useProviders';
import { useAuth } from '../../auth/hooks/useAuth';
import { type ChargingSession } from '../../../lib/db';
import { prepareSession } from '../services/sessionService';

const sessionSchema = z.object({
  session_timestamp: z.string().min(1, 'Date is required'),
  provider_id: z.string().min(1, 'Provider is required'),
  tariff_id: z.string().min(1, 'Tariff is required'),
  location_type: z.enum(['Home', 'Work', 'Public', 'Fast Charger']),
  charging_type: z.enum(['AC', 'DC']),
  kwh_billed: z.string().regex(/^\d+([,.]\d{1,4})?$/, 'Invalid kWh format'),
  kwh_added: z.string().regex(/^\d+([,.]\d{1,4})?$/, 'Invalid kWh format').optional(),
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
    formState: { errors, isSubmitting },
  } = useForm<SessionFormValues>({
    resolver: zodResolver(sessionSchema),
    defaultValues: {
      session_timestamp: initialValues?.session_timestamp 
        ? initialValues.session_timestamp.toISOString().split('T')[0] 
        : new Date().toISOString().split('T')[0],
      location_type: initialValues?.location_type || 'Public',
      charging_type: initialValues?.charging_type || 'AC',
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
    <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900">
          {initialValues?.id ? 'Edit Session' : 'New Session'}
        </h2>
        <button
          onClick={onCancel}
          className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Cancel"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4" noValidate>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Date */}
          <div className="space-y-1">
            <label htmlFor="session_timestamp" className="flex items-center text-sm font-medium text-slate-700">
              <Calendar className="w-4 h-4 mr-1 text-slate-400" />
              Date
            </label>
            <input
              id="session_timestamp"
              type="date"
              {...register('session_timestamp')}
              aria-invalid={!!errors.session_timestamp}
              aria-describedby={errors.session_timestamp ? 'session_timestamp_error' : undefined}
              className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none min-h-[44px]"
            />
            {errors.session_timestamp && (
              <p id="session_timestamp_error" className="text-sm text-red-600">{errors.session_timestamp.message}</p>
            )}
          </div>

          {/* Location Type */}
          <div className="space-y-1">
            <label htmlFor="location_type" className="flex items-center text-sm font-medium text-slate-700">
              <MapPin className="w-4 h-4 mr-1 text-slate-400" />
              Location Type
            </label>
            <select
              id="location_type"
              {...register('location_type')}
              className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white min-h-[44px]"
            >
              <option value="Public">Public</option>
              <option value="Fast Charger">Fast Charger</option>
              <option value="Home">Home</option>
              <option value="Work">Work</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Provider */}
          <div className="space-y-1">
            <label htmlFor="provider_id" className="block text-sm font-medium text-slate-700">
              Provider
            </label>
            <select
              id="provider_id"
              {...register('provider_id')}
              aria-invalid={!!errors.provider_id}
              aria-describedby={errors.provider_id ? 'provider_id_error' : undefined}
              className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white min-h-[44px]"
            >
              <option value="">Select Provider</option>
              {providers.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {errors.provider_id && (
              <p id="provider_id_error" className="text-sm text-red-600">{errors.provider_id.message}</p>
            )}
          </div>

          {/* Tariff */}
          <div className="space-y-1">
            <label htmlFor="tariff_id" className="block text-sm font-medium text-slate-700">
              Tariff
            </label>
            <select
              id="tariff_id"
              {...register('tariff_id')}
              aria-invalid={!!errors.tariff_id}
              aria-describedby={errors.tariff_id ? 'tariff_id_error' : undefined}
              className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white min-h-[44px]"
            >
              <option value="">Select Tariff</option>
              {tariffs
                .filter(t => !selectedProviderId || t.provider_id === selectedProviderId)
                .map(t => (
                  <option key={t.id} value={t.id}>{t.tariff_name}</option>
                ))}
            </select>
            {errors.tariff_id && (
              <p id="tariff_id_error" className="text-sm text-red-600">{errors.tariff_id.message}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Charging Type */}
          <div className="space-y-1">
            <span id="charging-type-label" className="flex items-center text-sm font-medium text-slate-700">
              <Zap className="w-4 h-4 mr-1 text-slate-400" />
              Charging Type
            </span>
            <div className="flex gap-2" role="radiogroup" aria-labelledby="charging-type-label">
              <label className="flex-1">
                <input
                  type="radio"
                  value="AC"
                  {...register('charging_type')}
                  className="sr-only peer"
                />
                <div className="flex items-center justify-center px-4 py-3 border rounded-lg cursor-pointer peer-checked:bg-blue-50 peer-checked:border-blue-500 peer-checked:text-blue-600 hover:bg-slate-50 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500 transition-colors min-h-[44px]">
                  AC
                </div>
              </label>
              <label className="flex-1">
                <input
                  type="radio"
                  value="DC"
                  {...register('charging_type')}
                  className="sr-only peer"
                />
                <div className="flex items-center justify-center px-4 py-3 border rounded-lg cursor-pointer peer-checked:bg-blue-50 peer-checked:border-blue-500 peer-checked:text-blue-600 hover:bg-slate-50 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500 transition-colors min-h-[44px]">
                  DC
                </div>
              </label>
            </div>
          </div>

          {/* kWh Billed */}
          <div className="space-y-1">
            <label htmlFor="kwh_billed" className="flex items-center text-sm font-medium text-slate-700">
              <Percent className="w-4 h-4 mr-1 text-slate-400" />
              kWh Billed
            </label>
            <input
              id="kwh_billed"
              type="text"
              inputMode="decimal"
              {...register('kwh_billed')}
              aria-invalid={!!errors.kwh_billed}
              aria-describedby={errors.kwh_billed ? 'kwh_billed_error' : undefined}
              placeholder="e.g. 45,5"
              className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none min-h-[44px]"
            />
            {errors.kwh_billed && (
              <p id="kwh_billed_error" className="text-sm text-red-600">{errors.kwh_billed.message}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Start SoC */}
          <div className="space-y-1">
            <label htmlFor="start_soc_percentage" className="block text-sm font-medium text-slate-700">
              Start SoC (%)
            </label>
            <input
              id="start_soc_percentage"
              type="text"
              inputMode="numeric"
              {...register('start_soc_percentage')}
              aria-invalid={!!errors.start_soc_percentage}
              aria-describedby={errors.start_soc_percentage ? 'start_soc_error' : undefined}
              className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none min-h-[44px]"
            />
            {errors.start_soc_percentage && (
              <p id="start_soc_error" className="text-sm text-red-600">{errors.start_soc_percentage.message}</p>
            )}
          </div>

          {/* End SoC */}
          <div className="space-y-1">
            <label htmlFor="end_soc_percentage" className="block text-sm font-medium text-slate-700">
              End SoC (%)
            </label>
            <input
              id="end_soc_percentage"
              type="text"
              inputMode="numeric"
              {...register('end_soc_percentage')}
              aria-invalid={!!errors.end_soc_percentage}
              aria-describedby={errors.end_soc_percentage ? 'end_soc_error' : undefined}
              className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none min-h-[44px]"
            />
            {errors.end_soc_percentage && (
              <p id="end_soc_error" className="text-sm text-red-600">{errors.end_soc_percentage.message}</p>
            )}
          </div>
        </div>

        {/* Odometer */}
        <div className="space-y-1">
          <label htmlFor="odometer_km" className="flex items-center text-sm font-medium text-slate-700">
            <Gauge className="w-4 h-4 mr-1 text-slate-400" />
            Odometer (km)
          </label>
          <input
            id="odometer_km"
            type="text"
            inputMode="numeric"
            {...register('odometer_km')}
            aria-invalid={!!errors.odometer_km}
            aria-describedby={errors.odometer_km ? 'odometer_km_error' : undefined}
            placeholder="e.g. 12450"
            className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none min-h-[44px]"
          />
          {errors.odometer_km && (
            <p id="odometer_km_error" className="text-sm text-red-600">{errors.odometer_km.message}</p>
          )}
        </div>

        {/* Notes */}
        <div className="space-y-1">
          <label htmlFor="notes" className="flex items-center text-sm font-medium text-slate-700">
            <FileText className="w-4 h-4 mr-1 text-slate-400" />
            Notes
          </label>
          <textarea
            id="notes"
            {...register('notes')}
            rows={3}
            className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none min-h-[88px]"
          />
        </div>

        <div className="pt-4 flex flex-col md:flex-row gap-3">
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex-1 flex items-center justify-center py-3 px-4 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 min-h-[44px]"
          >
            {isSubmitting ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
            ) : (
              <Save className="w-5 h-5 mr-2" />
            )}
            Save Session
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
