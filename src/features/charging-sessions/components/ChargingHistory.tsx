import React from 'react';
import { useSessions } from '../hooks/useSessions';
import { formatCurrency, formatCentsToDecimal } from '../../../shared/lib';
import { Calendar, Zap, Info } from 'lucide-react';
import { Slab } from '../../../shared/ui';

/**
 * Displays locally saved charging sessions with their calculated cost and sync state.
 *
 * The history view reads from IndexedDB through {@link useSessions}, so newly
 * saved sessions appear immediately while the pending badge reflects whether an
 * outbox entry still needs remote sync.
 */
export const ChargingHistory: React.FC = () => {
  const { sessions, isLoading } = useSessions();

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
                    {(session.session_mode === 'adHoc' ? 'Ad-Hoc' : (session.price_snapshot?.label ?? session.charging_plan_name ?? 'Charging Plan'))} • {session.charging_type}
                  </p>
                  {session.session_mode === 'adHoc' && (() => {
                    const cpoName = session.ad_hoc_pricing?.cpoName?.trim();
                    const providerName = session.provider_name.trim().toLowerCase();
                    const shouldShowCpoName = cpoName != null && cpoName.toLowerCase() !== providerName;
                    const metadataParts = [shouldShowCpoName ? cpoName : null].filter(Boolean);

                    if (metadataParts.length === 0) {
                      return null;
                    }

                    return (
                      <p className="text-xs text-secondary/80 font-medium">
                        {metadataParts.join(' • ')}
                      </p>
                    );
                  })()}
                  {(session.start_soc_percentage != null || session.end_soc_percentage != null) && (
                    <p className="text-xs text-secondary/80 font-medium">
                      SoC {session.start_soc_percentage != null ? `${session.start_soc_percentage}%` : '—'} → {session.end_soc_percentage != null ? `${session.end_soc_percentage}%` : '—'}
                    </p>
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
