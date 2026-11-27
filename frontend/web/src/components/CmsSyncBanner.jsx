import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getCmsSyncStatus, triggerCmsSync } from '@/services/ticketService';

const POLL_MS = 5 * 60 * 1000;

const formatWhen = (iso) => {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

/**
 * Spec 3.1: persistent, non-blocking warning shown while the last CMS equipment sync failed.
 * Pages keep working on locally synced machines; this only reads the recorded sync state.
 * DESIGN.md §9 Persistent Warning Banner. `canSync` shows the admin "Sync now" action.
 */
export default function CmsSyncBanner({ canSync = false, className = '' }) {
  const [status, setStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await getCmsSyncStatus());
    } catch {
      // The banner is advisory: if ticket-service itself fails, other page errors cover it.
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await triggerCmsSync();
      if (result?.status) setStatus(result.status);
      else await load();
    } catch {
      await load();
    } finally {
      setSyncing(false);
    }
  };

  if (!status?.configured || status.reachable !== false) return null;

  const lastSuccess = formatWhen(status.last_success_at);

  return (
    <div
      role="status"
      className={`flex flex-col sm:flex-row sm:items-center gap-2 p-4 rounded-xl border border-amber-300 bg-[#fffdf0] text-amber-800 ${className}`}
    >
      <div className="flex items-start gap-2 flex-1 min-w-0">
        <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" aria-hidden="true" />
        <p className="text-sm font-medium leading-relaxed">
          The Contract Management System is unreachable right now.{' '}
          {lastSuccess
            ? `Equipment and customer details are from the last successful sync (${lastSuccess}).`
            : 'Equipment and customer details may be out of date.'}
        </p>
      </div>
      {canSync && (
        <Button type="button" variant="outline" size="sm" onClick={handleSync} disabled={syncing} className="shrink-0 cursor-pointer">
          {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          {syncing ? 'Syncing' : 'Sync Now'}
        </Button>
      )}
    </div>
  );
}
