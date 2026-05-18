import React from 'react';
import { useSessions } from '../hooks/useSessions';
import { formatCurrency, formatCentsToDecimal } from '../../../lib/utils';
import { Calendar, Zap, Info, Clock, CheckCircle2 } from 'lucide-react';
import { Slab } from '../../../components/ui/Slab';

export const ChargingHistory: React.FC = () => {
  const { sessions, pendingSyncIds, isLoading } = useSessions();

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

  if (sessions.length === 0) {
    return (
      <Slab className="text-center p-12">
        <Info className="w-12 h-12 text-secondary/30 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-primary mb-2">No Sessions Yet</h2>
        <p className="text-secondary">Your charging history will appear here once you log your first session.</p>
      </Slab>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-sm font-bold text-secondary uppercase tracking-widest mb-4 px-2">
        Charging History
      </h2>
      <div className="space-y-4">
        {sessions.map((session) => (
          <Slab
            key={session.id}
            className="p-6 transition-all hover:border-accent/20"
          >
            <div className="flex justify-between items-center">
              <div className="space-y-1.5">
                <div className="flex items-center text-[10px] font-bold uppercase tracking-widest text-secondary">
                  <Calendar className="w-3 h-3 mr-1.5" />
                  {new Date(session.session_timestamp).toLocaleDateString('de-DE', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                  })}
                </div>
                <h3 className="text-lg font-bold text-primary leading-tight">
                  {session.provider_name}
                </h3>
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm text-secondary font-medium">
                    {session.tariff_name} • {session.charging_type}
                  </p>
                  {pendingSyncIds.has(session.id) ? (
                    <span className="flex items-center text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100 uppercase tracking-tighter">
                      <Clock className="w-3 h-3 mr-1" />
                      Pending Sync
                    </span>
                  ) : (
                    <span className="flex items-center text-[10px] font-bold text-green-600 bg-green-50 px-1.5 py-0.5 rounded border border-green-100 uppercase tracking-tighter">
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      Synced
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right">
                <p className="text-4xl font-semibold text-primary tabular-nums tracking-tight">
                  {formatCurrency(session.total_cost)}
                </p>
                <div className="flex items-center justify-end text-lg font-medium text-secondary tabular-nums mt-1">
                  <Zap className="w-4 h-4 mr-1 text-accent" />
                  {formatCentsToDecimal(Math.round(session.kwh_billed * 100)).replace(',00', '')} <span className="text-sm ml-1">kWh</span>
                </div>
              </div>
            </div>
          </Slab>
        ))}
      </div>
    </div>
  );
};
