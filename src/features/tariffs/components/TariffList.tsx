import React, { useState } from 'react';
import { Plus, Trash2, Edit2, Zap, Info } from 'lucide-react';
import { useTariffs } from '../hooks/useTariffs';
import { TariffForm } from './TariffForm';
import { formatCurrency } from '../../../lib/utils';
import { useProviders } from '../hooks/useProviders';
import { type Tariff } from '../../../lib/db';
import { formatCentsToDecimal } from '../../../lib/utils';

export const TariffList: React.FC = () => {
  const { tariffs, addTariff, removeTariff, isLoading } = useTariffs();
  const { providers } = useProviders();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingTariff, setEditingTariff] = useState<(Omit<Partial<Tariff>, 'ac_price_per_kwh' | 'dc_price_per_kwh' | 'session_fee' | 'valid_from'> & { 
    ac_price?: string; 
    dc_price?: string; 
    session_fee?: string;
    valid_from?: string;
  }) | null>(null);

  const handleEdit = (tariff: Tariff) => {
    // Convert cents back to decimal strings for the form
    const initialValues = {
      ...tariff,
      ac_price: formatCentsToDecimal(tariff.ac_price_per_kwh),
      dc_price: formatCentsToDecimal(tariff.dc_price_per_kwh),
      session_fee: formatCentsToDecimal(tariff.session_fee),
      valid_from: new Date(tariff.valid_from).toISOString().split('T')[0],
    };
    setEditingTariff(initialValues);
    setIsFormOpen(true);
  };

  const handleDelete = (tariff: Tariff) => {
    if (window.confirm(`Are you sure you want to delete the tariff "${tariff.tariff_name}"?`)) {
      removeTariff(tariff.id);
    }
  };

  const handleSubmit = async (tariff: Tariff) => {
    await addTariff(tariff);
    setIsFormOpen(false);
    setEditingTariff(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-12 h-12 bg-slate-200 rounded-full"></div>
          <div className="h-4 w-32 bg-slate-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Tariffs</h1>
        {!isFormOpen && (
          <button
            onClick={() => setIsFormOpen(true)}
            className="flex items-center px-4 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors min-h-[44px]"
          >
            <Plus className="w-5 h-5 mr-2" />
            Add Tariff
          </button>
        )}
      </div>

      {isFormOpen && (
        <TariffForm
          onSubmit={handleSubmit}
          onCancel={() => {
            setIsFormOpen(false);
            setEditingTariff(null);
          }}
          initialValues={editingTariff || undefined}
        />
      )}

      {tariffs.length === 0 ? (
        <div className="text-center p-12 bg-slate-50 rounded-xl border border-dashed border-slate-300">
          <Info className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <p className="text-slate-500 font-medium">No tariffs added yet.</p>
          <p className="text-slate-400 text-sm">Add your first charging tariff to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tariffs.map((tariff) => {
            const provider = providers.find(p => p.id === tariff.provider_id);
            return (
              <div
                key={tariff.id}
                className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow relative group"
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-bold text-slate-900 text-lg leading-tight">
                      {tariff.tariff_name}
                    </h3>
                    <p className="text-slate-500 text-sm font-medium">
                      {provider?.name || 'Unknown Provider'}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleEdit(tariff)}
                      className="flex items-center justify-center min-w-[44px] min-h-[44px] text-slate-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
                      aria-label="Edit"
                    >
                      <Edit2 className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => handleDelete(tariff)}
                      className="flex items-center justify-center min-w-[44px] min-h-[44px] text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                      aria-label="Delete"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div className="space-y-1">
                    <div className="flex items-center text-xs font-bold text-slate-500 uppercase tracking-wider">
                      <Zap className="w-3 h-3 mr-1 text-yellow-500" />
                      AC Price
                    </div>
                    <p className="text-lg font-bold text-slate-800">
                      {formatCurrency(tariff.ac_price_per_kwh)}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center text-xs font-bold text-slate-500 uppercase tracking-wider">
                      <Zap className="w-3 h-3 mr-1 text-blue-500" />
                      DC Price
                    </div>
                    <p className="text-lg font-bold text-slate-800">
                      {formatCurrency(tariff.dc_price_per_kwh)}
                    </p>
                  </div>
                </div>

                {tariff.session_fee > 0 && (
                  <div className="mt-4 pt-4 border-t border-slate-100 flex justify-between items-center">
                    <span className="text-sm text-slate-500">Session Fee</span>
                    <span className="text-sm font-bold text-slate-700">
                      {formatCurrency(tariff.session_fee)}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
