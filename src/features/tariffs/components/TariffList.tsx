import React, { useState } from 'react';
import { Plus, Trash2, Edit2, Info } from 'lucide-react';
import { useTariffs } from '../hooks/useTariffs';
import { TariffForm } from './TariffForm';
import { formatCurrency } from '../../../lib/utils';
import { useProviders } from '../hooks/useProviders';
import { type Tariff } from '../../../lib/db';
import { formatCentsToDecimal } from '../../../lib/utils';
import { Slab } from '../../../components/ui/Slab';

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
      <div className="flex items-center justify-between px-2">
        <h1 className="text-2xl font-bold text-primary">Tariffs</h1>
        {!isFormOpen && (
          <button
            onClick={() => setIsFormOpen(true)}
            className="flex items-center px-6 py-2 bg-accent text-white font-bold rounded-xl hover:opacity-90 transition-all shadow-sm active:scale-95 min-h-[44px]"
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
        <Slab className="text-center p-12 border-dashed">
          <Info className="w-12 h-12 text-secondary/30 mx-auto mb-4" />
          <p className="text-secondary font-medium">No tariffs added yet.</p>
          <p className="text-secondary/60 text-sm">Add your first charging tariff to get started.</p>
        </Slab>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {tariffs.map((tariff) => {
            const provider = providers.find(p => p.id === tariff.provider_id);
            return (
              <Slab
                key={tariff.id}
                className="p-6 relative group transition-all hover:border-accent/20"
              >
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h3 className="font-bold text-primary text-lg leading-tight">
                      {tariff.tariff_name}
                    </h3>
                    <p className="text-secondary text-sm font-medium">
                      {provider?.name || 'Unknown Provider'}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleEdit(tariff)}
                      className="flex items-center justify-center min-w-[44px] min-h-[44px] text-secondary hover:text-accent rounded-xl hover:bg-accent/5 transition-colors"
                      aria-label="Edit"
                    >
                      <Edit2 className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => handleDelete(tariff)}
                      className="flex items-center justify-center min-w-[44px] min-h-[44px] text-secondary hover:text-red-500 rounded-xl hover:bg-red-500/5 transition-colors"
                      aria-label="Delete"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-secondary/5">
                  <div className="space-y-1">
                    <div className="text-[10px] font-bold text-secondary uppercase tracking-widest">
                      AC Price
                    </div>
                    <p className="text-3xl font-semibold text-primary tabular-nums">
                      {formatCurrency(tariff.ac_price_per_kwh)}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[10px] font-bold text-secondary uppercase tracking-widest">
                      DC Price
                    </div>
                    <p className="text-3xl font-semibold text-primary tabular-nums">
                      {formatCurrency(tariff.dc_price_per_kwh)}
                    </p>
                  </div>
                </div>

                {tariff.session_fee > 0 && (
                  <div className="mt-6 pt-4 border-t border-secondary/5 flex justify-between items-center">
                    <span className="text-xs font-bold text-secondary uppercase tracking-widest">Session Fee</span>
                    <span className="text-lg font-semibold text-primary tabular-nums">
                      {formatCurrency(tariff.session_fee)}
                    </span>
                  </div>
                )}
              </Slab>
            );
          })}
        </div>
      )}
    </div>
  );
};
