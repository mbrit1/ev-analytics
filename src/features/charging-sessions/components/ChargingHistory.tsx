import React from 'react';
import { useSessions } from '../hooks/useSessions';
import { formatCurrency, formatCentsToDecimal } from '../../../lib/utils';
import { Calendar, Zap, Info, Clock, CheckCircle2 } from 'lucide-react';

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
      <div className="text-center p-12 bg-white rounded-xl border border-slate-200 shadow-sm">
        <Info className="w-12 h-12 text-slate-300 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-slate-900 mb-2">No Sessions Yet</h2>
        <p className="text-slate-500">Your charging history will appear here once you log your first session.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-slate-900 mb-4">Charging History</h2>
      <div className="space-y-3">
        {sessions.map((session) => (
          <div
            key={session.id}
            className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="flex justify-between items-start">
              <div className="space-y-1">
                <div className="flex items-center text-sm text-slate-500">
                  <Calendar className="w-4 h-4 mr-1.5" />
                  {new Date(session.session_timestamp).toLocaleDateString('de-DE', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                  })}
                </div>
                <h3 className="font-bold text-slate-900">{session.provider_name}</h3>
                <div className="flex items-center gap-2">
                  <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">
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
                <p className="text-lg font-bold text-slate-900">
                  {formatCurrency(session.total_cost)}
                </p>
                <div className="flex items-center justify-end text-sm font-medium text-blue-600 mt-1">
                  <Zap className="w-4 h-4 mr-1 text-yellow-500" />
                  {formatCentsToDecimal(Math.round(session.kwh_billed * 100)).replace(',00', '')} kWh
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
