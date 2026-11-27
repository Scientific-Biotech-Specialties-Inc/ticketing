import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, LogOut, Loader2, CheckCircle2, CirclePause } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { getSystemStatus } from '@/services/configurationService';
import echo from '@/services/echo';
import QueueKiosk from '@/components/maintenance/QueueKiosk';

/** Seconds between background status polls (also drives the countdown ring). */
const POLL_SECONDS = 20;

/**
 * MaintenanceGate
 *
 * Restricts customer and employee access whenever the platform is set to
 * "Under Maintenance". SuperAdmin and Admin users are exempt to allow system
 * configuration and restoration.
 */
export default function MaintenanceGate({ children }) {
  const { user, logout } = useAuth();
  const [status, setStatus] = useState('Operational');
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState(null);
  const [checkNotice, setCheckNotice] = useState('');

  const isExempt =
    user?.role === 'superadmin' ||
    user?.role === 'admin' ||
    user?.role === 'systemadministrator';

  const checkStatus = useCallback(async (isManual = false) => {
    if (isManual) setChecking(true);
    try {
      const currentStatus = await getSystemStatus();
      if (currentStatus) {
        setStatus(currentStatus);
        setLastChecked(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        if (isManual) {
          if (currentStatus === 'Under Maintenance') {
            setCheckNotice('The system is still under maintenance. Please try again shortly.');
          } else {
            setCheckNotice('The system is operational! Access restored.');
          }
        }
      }
    } catch (err) {
      console.warn('[MaintenanceGate] Failed to fetch system status:', err);
      if (isManual) {
        setCheckNotice('Unable to reach server. Please check your connection.');
      }
    } finally {
      if (isManual) {
        setTimeout(() => setChecking(false), 400);
        setTimeout(() => setCheckNotice(''), 4000);
      }
    }
  }, []);

  useEffect(() => {
    // Initial fetch
    checkStatus(false);

    // Listen for WebSocket broadcast events from configuration-service
    const channels = ['system-status', 'ticket-updates', 'ticket-config'];
    const eventNames = ['system.status.updated', '.system.status.updated'];

    const subscriptions = [];

    channels.forEach((chName) => {
      try {
        const ch = echo.channel(chName);
        eventNames.forEach((evName) => {
          const handler = (payload) => {
            const nextStatus = payload?.status || (payload?.key === 'system_status' ? payload?.status : null);
            if (nextStatus) {
              setStatus(nextStatus);
              setLastChecked(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
            }
          };
          ch.listen(evName, handler);
          subscriptions.push({ ch, evName });
        });
      } catch (e) {
        console.warn(`[MaintenanceGate] Channel ${chName} subscription error:`, e);
      }
    });

    // Cross-tab/window event
    const handleLocalStatusChanged = (e) => {
      const next = e?.detail?.status;
      if (next) {
        setStatus(next);
        setLastChecked(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      }
    };
    window.addEventListener('system:status-changed', handleLocalStatusChanged);

    // Polling fallback every 20 seconds to keep clients synchronized
    const interval = setInterval(() => {
      checkStatus(false);
    }, POLL_SECONDS * 1000);

    return () => {
      clearInterval(interval);
      window.removeEventListener('system:status-changed', handleLocalStatusChanged);
      subscriptions.forEach(({ ch, evName }) => {
        try {
          if (ch?.stopListening) ch.stopListening(evName);
        } catch {}
      });
    };
  }, [checkStatus]);

  // Exempt administrators from the maintenance block
  if (isExempt) {
    return <>{children}</>;
  }

  // If system is operational, render children normally
  if (status !== 'Under Maintenance') {
    return <>{children}</>;
  }

  // System is Under Maintenance: queue kiosk illustration with the message stacked below it (no card)
  return (
    <div className="w-full py-4 px-4 flex items-center justify-center">
      <div className="max-w-3xl w-full flex flex-col items-center gap-6 animate-fadeSlideIn">
        {/* Illustration, scaled up as a whole so its fixed inner sizes keep their proportions */}
        <div className="qk-scale">
          <QueueKiosk />
        </div>

        {/* Message */}
        <div className="flex flex-col items-center gap-4 text-center">
          <div>
            <span className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs font-semibold bg-warning-bg text-warning-hover border border-warning-border">
              <span className="qk-pulse w-2 h-2 rounded-full bg-current" />
              Under Maintenance
            </span>
          </div>

          <h2 className="text-2xl sm:text-4xl font-bold text-primary tracking-tight">
            The service desk is paused for upgrades
          </h2>

          <p className="text-sm sm:text-base text-muted-slate leading-relaxed max-w-2xl">
            You can&apos;t submit or assign tickets until scheduled maintenance is finished. This page checks on its
            own and lets you back in as soon as the desk reopens.
          </p>

          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs text-dark-slate">
            <div className="flex items-start gap-2">
              <CheckCircle2 size={16} className="text-success mt-0.5 shrink-0" />
              <span>Your tickets, messages and drafts are saved.</span>
            </div>
            <div className="flex items-start gap-2">
              <CirclePause size={16} className="text-accent mt-0.5 shrink-0" />
              <span>New tickets and assignments resume automatically when maintenance ends.</span>
            </div>
          </div>

          {checkNotice && (
            <div
              role="status"
              className="text-xs font-semibold px-4 py-2 rounded-xl bg-brand-bg text-primary border border-gray-150 animate-fade-slide-in"
            >
              {checkNotice}
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-center gap-2">
            <button
              type="button"
              onClick={() => checkStatus(true)}
              disabled={checking}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-primary hover:bg-primary-hover active:bg-primary-pressed text-white px-6 py-2 min-h-10 text-xs font-semibold transition-colors shadow-md disabled:opacity-70 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {checking ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              {checking ? 'Checking status…' : 'Check status'}
            </button>

            <button
              type="button"
              onClick={async () => {
                const isCust = user?.role === 'customer' || import.meta.env.VITE_APP_MODE === 'customer';
                await logout();
                window.location.replace(isCust ? '/customer' : '/');
              }}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl border border-gray-150 bg-white hover:border-accent text-dark-slate px-6 py-2 min-h-10 text-xs font-semibold transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <LogOut size={16} className="text-muted-slate" />
              Sign out
            </button>
          </div>

          <AutoCheckCountdown resetKey={lastChecked} />
        </div>
      </div>
    </div>
  );
}

/**
 * Small ring that counts down to the next automatic status poll. Lives in its
 * own component so the per-second tick never re-renders the gated app tree.
 * `resetKey` changes whenever a poll completes, restarting the countdown.
 */
function AutoCheckCountdown({ resetKey }) {
  const [secondsLeft, setSecondsLeft] = useState(POLL_SECONDS);

  useEffect(() => {
    setSecondsLeft(POLL_SECONDS);
    const tick = setInterval(() => {
      setSecondsLeft((s) => (s <= 1 ? POLL_SECONDS : s - 1));
    }, 1000);
    return () => clearInterval(tick);
  }, [resetKey]);

  const circumference = 2 * Math.PI * 9;
  const offset = circumference * (1 - secondsLeft / POLL_SECONDS);

  return (
    <div className="flex items-center gap-2 text-xs text-muted-slate tabular-nums">
      <svg width="24" height="24" viewBox="0 0 24 24" className="qk-autocheck-ring" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" strokeWidth="3" className="stroke-gray-150" />
        <circle
          cx="12"
          cy="12"
          r="9"
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="stroke-accent qk-autocheck-fill"
        />
      </svg>
      <span>
        Next automatic check in <b className="text-dark-slate font-semibold">{secondsLeft}s</b>
        {resetKey && <span className="text-th-header"> · Last checked {resetKey}</span>}
      </span>
    </div>
  );
}
