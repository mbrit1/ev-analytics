import React from 'react';
import { useSessions } from '../hooks/useSessions';
import { groupSessionsByMonth } from '../model/types';
import { formatCurrency, formatCentsToDecimal, formatKwh } from '../../../shared/lib';
import { Calendar, Zap, Info } from 'lucide-react';
import { Slab } from '../../../shared/ui';
import { type ChargingSession } from '../../../infra/db';

interface SessionCardRestorationRequest {
  /** Unique key for one restoration attempt; defaults to the target session id. */
  requestKey?: string | number;
  /** Session card to reveal after the live query re-renders. */
  sessionId: string;
  type: 'session';
}

interface ScrollPositionRestorationRequest {
  /** Unique key for one restoration attempt; defaults to the saved scroll position. */
  requestKey?: string | number;
  /** Window scroll offset captured before the form opened. */
  scrollY: number;
  /** Optional session card to focus after restoring the previous position. */
  focusSessionId?: string | null;
  type: 'position';
}

type ChargingHistoryRestorationRequest =
  | SessionCardRestorationRequest
  | ScrollPositionRestorationRequest;

interface ChargingHistoryProps {
  /** Opens the selected persisted session for editing. */
  onSelectSession?: (session: ChargingSession) => void;
  /** One-shot request to restore history context after form close/save. */
  restorationRequest?: ChargingHistoryRestorationRequest;
  /** Clears the parent request once the requested restoration has completed. */
  onRestorationComplete?: () => void;
}

function buildSessionEditLabel(session: ChargingSession): string {
  const providerName = session.provider_name_snapshot || 'Unknown provider';
  const sessionDate = new Date(session.session_timestamp).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  return `Edit session ${providerName} ${sessionDate}`;
}

/**
 * Displays locally saved charging sessions with their calculated cost and sync state.
 *
 * The history view reads from IndexedDB through {@link useSessions}, so newly
 * saved sessions appear immediately while the pending badge reflects whether an
 * outbox entry still needs remote sync.
 */
export const ChargingHistory: React.FC<ChargingHistoryProps> = ({
  onSelectSession,
  restorationRequest,
  onRestorationComplete,
}) => {
  const { sessions, isLoading } = useSessions();
  const sessionCardRefs = React.useRef(new Map<string, HTMLElement>());
  const activeImplicitRestorationKeyRef = React.useRef<string | null>(null);
  const completedExplicitRestorationKeysRef = React.useRef(new Set<string>());
  const monthGroups = groupSessionsByMonth(sessions);
  const implicitRestorationKey = restorationRequest == null
    ? null
    : String(
      restorationRequest.type === 'session'
        ? restorationRequest.sessionId
        : `position:${restorationRequest.scrollY}:${restorationRequest.focusSessionId ?? ''}`
    );
  const explicitRestorationKey = restorationRequest?.requestKey == null
    ? null
    : String(restorationRequest.requestKey);

  React.useEffect(() => {
    if (restorationRequest == null) {
      activeImplicitRestorationKeyRef.current = null;
      return;
    }

    if (
      explicitRestorationKey != null
      && completedExplicitRestorationKeysRef.current.has(explicitRestorationKey)
    ) {
      return;
    }

    if (
      explicitRestorationKey == null
      && implicitRestorationKey != null
      && activeImplicitRestorationKeyRef.current === implicitRestorationKey
    ) {
      return;
    }

    if (isLoading) {
      return;
    }

    if (restorationRequest.type === 'position') {
      const focusTarget = restorationRequest.focusSessionId == null
        ? null
        : sessionCardRefs.current.get(restorationRequest.focusSessionId);

      if (restorationRequest.focusSessionId != null && focusTarget == null) {
        return;
      }

      window.scrollTo({ top: restorationRequest.scrollY, behavior: 'auto' });

      if (focusTarget != null && typeof focusTarget.focus === 'function') {
        focusTarget.focus({ preventScroll: true });
      }

      if (explicitRestorationKey != null) {
        completedExplicitRestorationKeysRef.current.add(explicitRestorationKey);
      } else {
        activeImplicitRestorationKeyRef.current = implicitRestorationKey;
      }
      onRestorationComplete?.();
      return;
    }

    if (sessions.length === 0) {
      return;
    }

    const sessionCard = sessionCardRefs.current.get(restorationRequest.sessionId);
    if (sessionCard == null) {
      return;
    }

    sessionCard.scrollIntoView({
      behavior: 'auto',
      block: 'center',
    });

    if (typeof sessionCard.focus === 'function') {
      sessionCard.focus({ preventScroll: true });
    }

    if (explicitRestorationKey != null) {
      completedExplicitRestorationKeysRef.current.add(explicitRestorationKey);
    } else {
      activeImplicitRestorationKeyRef.current = implicitRestorationKey;
    }
    onRestorationComplete?.();
  }, [explicitRestorationKey, implicitRestorationKey, isLoading, onRestorationComplete, restorationRequest, sessions]);

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
      {monthGroups.map((group) => (
        <section key={group.monthKey} className="space-y-4">
          <header className="border-t border-slab-border/70 px-2 pt-4 first:border-t-0 first:pt-0">
            <div className="flex flex-col gap-0.2">
              <h3 className="text-sm font-semibold text-primary">
                {group.label}
              </h3>
              <p className="text-sm text-secondary tabular-nums">
                {formatKwh(group.totalKwh)} kWh · {formatCurrency(group.totalCostCents)}
              </p>
            </div>
          </header>

          <div className="space-y-4">
            {group.sessions.map((session) => {
              const cardContent = (
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
                      {session.provider_name_snapshot || 'Unknown Provider'}
                    </h3>
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="text-sm text-secondary font-medium">
                        {(session.session_mode === 'ad_hoc'
                          ? 'Ad-Hoc'
                          : (session.price_snapshot?.label
                            ?? session.charging_plan_name_snapshot
                            ?? 'Charging Plan'))} • {session.charging_type}
                      </p>
                      {session.session_mode === 'ad_hoc' && (() => {
                        const cpoName = session.ad_hoc_pricing?.cpoName?.trim();
                        const providerName = (session.provider_name_snapshot || '').trim().toLowerCase();
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
              );

              return (
                <Slab
                  key={session.id}
                  padding="none"
                >
                  {onSelectSession ? (
                    <button
                      type="button"
                      onClick={() => onSelectSession(session)}
                      aria-label={buildSessionEditLabel(session)}
                      id={`charging-session-${session.id}`}
                      data-session-id={session.id}
                      ref={(element) => {
                        if (element == null) {
                          sessionCardRefs.current.delete(session.id);
                          return;
                        }

                        sessionCardRefs.current.set(session.id, element);
                      }}
                      className="group w-full min-h-[44px] cursor-pointer rounded-[inherit] p-6 text-left transition-colors hover:bg-secondary/5 active:bg-secondary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                    >
                      {cardContent}
                    </button>
                  ) : (
                    <div
                      id={`charging-session-${session.id}`}
                      data-session-id={session.id}
                      ref={(element) => {
                        if (element == null) {
                          sessionCardRefs.current.delete(session.id);
                          return;
                        }

                        sessionCardRefs.current.set(session.id, element);
                      }}
                      className="p-6"
                      tabIndex={-1}
                    >
                      {cardContent}
                    </div>
                  )}
                </Slab>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
};
