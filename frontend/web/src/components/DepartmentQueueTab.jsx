import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Inbox, RefreshCw, Undo2, UserCheck, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, getStatusBadgeVariant } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { DataTableSkeleton, DataTableEmptyState } from '@/components/ui/data-table';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmationModal } from '@/components/ui/confirmation-modal';
import { FormModal } from '@/components/ui/form-modal';
import { useAuth } from '@/context/AuthContext';
import { formatDisplayDate } from '@/utils/dateUtils';
import {
  CS_TICKET_REFRESH_EVENT,
  claimDepartmentTicket,
  delegateDepartmentTicket,
  departmentRoutingErrorMessage,
  getDepartmentQueue,
  getEligibleEmployees,
  returnDepartmentTicket,
} from '@/services/ticketService';

const RETURN_REASON_MIN = 10;
const RETURN_REASON_MAX = 500;
const QUEUE_REFRESH_MS = 60 * 1000;

/**
 * Spec 0051 (AC-6): loads the signed in manager's Department queue. `available` is false when
 * the caller is not a department manager (the API answers 403), so pages can stay unchanged.
 */
export function useDepartmentQueue() {
  const [state, setState] = useState({ loading: true, available: false, error: '', tickets: [], department: null });

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setState((prev) => ({ ...prev, loading: true }));
    try {
      const data = await getDepartmentQueue({ perPage: 100 });
      setState({
        loading: false,
        available: true,
        error: '',
        tickets: Array.isArray(data?.tickets) ? data.tickets : [],
        department: data?.department || null,
      });
    } catch (err) {
      if (err?.response?.status === 403 || err?.response?.status === 401) {
        setState({ loading: false, available: false, error: '', tickets: [], department: null });
      } else {
        setState((prev) => ({ ...prev, loading: false, error: departmentRoutingErrorMessage(err, 'Failed to load the Department queue.') }));
      }
    }
  }, []);

  useEffect(() => {
    load();
    const refresh = () => load({ silent: true });
    window.addEventListener(CS_TICKET_REFRESH_EVENT, refresh);
    window.addEventListener('notifications:updated', refresh);
    const timer = window.setInterval(refresh, QUEUE_REFRESH_MS);
    return () => {
      window.removeEventListener(CS_TICKET_REFRESH_EVENT, refresh);
      window.removeEventListener('notifications:updated', refresh);
      window.clearInterval(timer);
    };
  }, [load]);

  return { ...state, reload: load };
}

/**
 * Wraps a manager ticket page. Department managers get an "All Tickets | Department Queue" switch;
 * everyone else sees the page exactly as before.
 */
export function DepartmentQueueSwitch({ children, allLabel = 'All Tickets' }) {
  const queue = useDepartmentQueue();
  const [view, setView] = useState('all');

  if (!queue.available) {
    return children;
  }

  const tabs = [
    { key: 'all', label: allLabel },
    { key: 'department', label: `Department Queue (${queue.tickets.length})` },
  ];

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Ticket views" className="flex gap-4 border-b border-border">
        {tabs.map((tab) => {
          const isActive = view === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setView(tab.key)}
              data-testid={`queue-view-${tab.key}`}
              className={`text-xs font-bold pb-2 px-1 border-b-2 transition-all flex items-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                isActive ? 'border-primary text-primary' : 'border-transparent text-slate-muted hover:text-slate-dark'
              }`}
            >
              {tab.key === 'department' && <Inbox className="w-4 h-4" />}
              {tab.label}
            </button>
          );
        })}
      </div>

      {view === 'all' ? children : <DepartmentQueuePanel queue={queue} />}
    </div>
  );
}

/**
 * Spec 0051 (AC-6 to AC-10): tickets routed to the manager's department, with Accept,
 * Assign members, and Return to CS. The first manager to act wins; a late action shows a notice.
 */
export function DepartmentQueuePanel({ queue }) {
  const [claimTicket, setClaimTicket] = useState(null);
  const [delegateTicket, setDelegateTicket] = useState(null);
  const [returnTicket, setReturnTicket] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { tone: 'success' | 'error', text }

  const finish = (text, tone = 'success') => {
    setNotice({ tone, text });
    queue.reload({ silent: true });
  };

  const handleClaim = async () => {
    if (!claimTicket) return;
    setBusy(true);
    try {
      await claimDepartmentTicket(claimTicket.ticket_id);
      setClaimTicket(null);
      finish(`You took ${claimTicket.ticket_number}. It is now in progress under your name.`);
    } catch (err) {
      setClaimTicket(null);
      finish(departmentRoutingErrorMessage(err, 'Failed to accept the ticket.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const departmentName = queue.department?.name || 'your department';

  return (
    <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden" data-testid="department-queue">
      <div className="flex items-center justify-between gap-4 p-4 border-b border-border">
        <div>
          <h2 className="text-sm font-bold text-slate-dark">Department Queue</h2>
          <p className="text-xs text-slate-muted">
            Tickets CS routed to {departmentName}. Accept one, assign it to your team, or return it to CS.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => queue.reload()} disabled={queue.loading} className="text-xs gap-2 cursor-pointer">
          <RefreshCw className={`w-4 h-4 ${queue.loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </Button>
      </div>

      {notice && (
        <div
          role="status"
          className={`m-4 p-4 rounded-xl border text-xs flex items-start gap-2 ${
            notice.tone === 'error' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          {notice.tone === 'error' ? <AlertCircle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}
          <span className="flex-1">{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="font-semibold underline cursor-pointer">Dismiss</button>
        </div>
      )}

      {queue.error && !queue.loading && (
        <div className="m-4 p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 flex items-center gap-2" role="alert">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1">{queue.error}</span>
          <Button variant="outline" size="sm" onClick={() => queue.reload()} className="text-xs border-red-300 text-red-800 hover:bg-red-100">Retry</Button>
        </div>
      )}

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-page border-b border-border">
              <TableHead className="w-32 font-semibold text-xs">Ticket</TableHead>
              <TableHead className="min-w-[240px] font-semibold text-xs">Subject &amp; Category</TableHead>
              <TableHead className="w-24 font-semibold text-xs">Priority</TableHead>
              <TableHead className="w-28 font-semibold text-xs">SLA</TableHead>
              <TableHead className="min-w-[180px] font-semibold text-xs">Routed By</TableHead>
              <TableHead className="w-72 text-right font-semibold text-xs">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {queue.loading ? (
              <DataTableSkeleton columns={6} rows={4} />
            ) : queue.tickets.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-48 text-center">
                  <DataTableEmptyState
                    title="Your Department queue is empty"
                    description="Tickets CS routes to your department show up here until a manager acts on them."
                  />
                </TableCell>
              </TableRow>
            ) : (
              queue.tickets.map((t) => (
                <TableRow key={t.ticket_id} data-testid={`department-queue-row-${t.ticket_id}`}>
                  <TableCell className="font-mono text-xs font-bold text-primary">{t.ticket_number}</TableCell>
                  <TableCell>
                    <p className="font-semibold text-xs text-slate-dark line-clamp-1">{t.title}</p>
                    <p className="text-[11px] text-slate-muted">{t.category || 'Uncategorized'}</p>
                    {t.note && <p className="text-[11px] text-slate-muted italic line-clamp-2">Note: {t.note}</p>}
                  </TableCell>
                  <TableCell>
                    {t.priority ? <Badge variant={getStatusBadgeVariant(t.priority)} size="sm">{t.priority}</Badge> : <span className="text-xs text-slate-muted">None</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={getStatusBadgeVariant(t.sla_label)} size="sm">{t.sla_label}</Badge>
                  </TableCell>
                  <TableCell>
                    <p className="text-xs font-medium text-slate-dark">{t.routed_by}</p>
                    <p className="text-[11px] text-slate-muted">{t.routed_at ? formatDisplayDate(t.routed_at) : ''}</p>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button size="sm" onClick={() => { setNotice(null); setClaimTicket(t); }} className="text-[11px] h-8 px-2 cursor-pointer">
                        <UserCheck className="w-4 h-4 mr-1" /> Accept
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => { setNotice(null); setDelegateTicket(t); }} className="text-[11px] h-8 px-2 cursor-pointer">
                        <Users className="w-4 h-4 mr-1" /> Assign Members
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => { setNotice(null); setReturnTicket(t); }} className="text-[11px] h-8 px-2 cursor-pointer">
                        <Undo2 className="w-4 h-4 mr-1" /> Return
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <ConfirmationModal
        isOpen={Boolean(claimTicket)}
        onClose={() => !busy && setClaimTicket(null)}
        onConfirm={handleClaim}
        title="Accept this ticket?"
        description={claimTicket ? `${claimTicket.ticket_number} moves to In Progress under your name, and it leaves the other managers' queues.` : ''}
        confirmLabel="Accept Ticket"
        variant="primary"
        loading={busy}
      />

      {delegateTicket && (
        <DelegateDialog
          ticket={delegateTicket}
          departmentName={queue.department?.name || ''}
          onClose={() => setDelegateTicket(null)}
          onDone={(text, tone) => { setDelegateTicket(null); finish(text, tone); }}
        />
      )}

      {returnTicket && (
        <ReturnDialog
          ticket={returnTicket}
          onClose={() => setReturnTicket(null)}
          onDone={(text, tone) => { setReturnTicket(null); finish(text, tone); }}
        />
      )}
    </div>
  );
}

/**
 * AC-8: pick one or more active people of the manager's own department. People outside the
 * category track can be picked only with an override reason.
 */
function DelegateDialog({ ticket, departmentName, onClose, onDone }) {
  const { user } = useAuth();
  const selfId = Number(user?.emp_id ?? user?.id ?? 0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [people, setPeople] = useState([]);
  const [selected, setSelected] = useState([]);
  const [overrideReason, setOverrideReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getEligibleEmployees({ ticket_ID: ticket.ticket_id, category: ticket.category });
        const sameDept = (e) => String(e.department || '').trim().toLowerCase() === departmentName.trim().toLowerCase();
        const notSelf = (e) => Number(e.id ?? e.emp_id) !== selfId;
        const eligible = (data?.eligible_employees || []).filter(sameDept).filter(notSelf).map((e) => ({ ...e, eligible: true }));
        const ineligible = (data?.ineligible_employees || []).filter(sameDept).filter(notSelf).map((e) => ({ ...e, eligible: false }));
        if (!cancelled) setPeople([...eligible, ...ineligible]);
      } catch (err) {
        if (!cancelled) setLoadError(departmentRoutingErrorMessage(err, 'Failed to load your team.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ticket.ticket_id, ticket.category, departmentName, selfId]);

  const needsOverride = useMemo(
    () => selected.some((id) => people.find((p) => Number(p.id) === id && !p.eligible)),
    [selected, people]
  );

  const toggle = (id) => {
    setError('');
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const submit = async () => {
    if (selected.length === 0) {
      setError('Pick at least one person.');
      return;
    }
    if (needsOverride && !overrideReason.trim()) {
      setError('Someone you picked is outside the category track. Add an override reason.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await delegateDepartmentTicket({
        ticketId: ticket.ticket_id,
        employeeIds: selected,
        overrideReason: needsOverride ? overrideReason.trim() : undefined,
      });
      onDone(`${ticket.ticket_number} was assigned to your team. They will see it as a pending assignment.`);
    } catch (err) {
      const code = err?.response?.data?.code;
      if (code === 'DEPARTMENT_ALREADY_CLAIMED' || err?.response?.status === 403) {
        onDone(departmentRoutingErrorMessage(err), 'error');
        return;
      }
      setError(departmentRoutingErrorMessage(err, 'Failed to assign the ticket.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      isOpen
      onClose={onClose}
      onSubmit={submit}
      title="Assign Members"
      subtitle={`${ticket.ticket_number}: ${ticket.title}`}
      icon={Users}
      confirmLabel="Assign Members"
      loading={saving}
      maxWidth="max-w-xl"
    >
      <div className="space-y-4">
        <p className="text-xs text-slate-muted">Only active people in {departmentName || 'your department'} are listed.</p>

        {loading && (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}
          </div>
        )}

        {!loading && loadError && (
          <p className="text-xs text-destructive flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {loadError}</p>
        )}

        {!loading && !loadError && people.length === 0 && (
          <div className="p-6 border border-dashed border-border rounded-xl text-center text-xs text-slate-muted">
            Nobody else in your department can take this ticket right now. Accept it yourself or return it to CS.
          </div>
        )}

        {!loading && !loadError && people.length > 0 && (
          <div className="max-h-72 overflow-auto bg-page border border-border rounded-xl p-2 space-y-2">
            {people.map((p) => {
              const id = Number(p.id);
              const isSelected = selected.includes(id);
              return (
                <label
                  key={id}
                  className={`flex items-start justify-between gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-all ${
                    isSelected ? 'bg-primary/5 border-primary/30' : 'border-transparent hover:bg-card hover:border-border'
                  }`}
                >
                  <span className="flex items-start gap-2 min-w-0">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggle(id)}
                      className="mt-1 w-4 h-4 rounded border-border text-primary focus:ring-accent"
                    />
                    <span className="min-w-0">
                      <span className="block text-xs font-bold text-slate-dark">{p.name}</span>
                      <span className="block text-[11px] text-slate-muted">
                        {p.technical_role || p.role || p.position_level || 'Employee'}
                      </span>
                    </span>
                  </span>
                  {!p.eligible && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded px-1 shrink-0">
                      <AlertTriangle className="w-3 h-3" /> Outside Track
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        )}

        {needsOverride && (
          <div>
            <label htmlFor="delegate-override" className="block text-xs font-medium text-slate-dark mb-2">
              Override reason <span className="text-destructive">*</span>
            </label>
            <textarea
              id="delegate-override"
              value={overrideReason}
              maxLength={RETURN_REASON_MAX}
              onChange={(e) => { setOverrideReason(e.target.value); setError(''); }}
              rows={2}
              placeholder="Why this person should take a ticket outside their category track"
              className="w-full px-4 py-2 text-sm bg-card border border-border rounded-xl text-slate-dark focus:ring-2 focus:ring-accent outline-none resize-none"
            />
          </div>
        )}

        {error && (
          <p className="text-xs font-semibold text-destructive flex items-center gap-2 bg-destructive/10 p-2 rounded-lg border border-destructive/20" role="alert">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </p>
        )}
      </div>
    </FormModal>
  );
}

/**
 * AC-9: send the ticket back to CS with a reason of 10 to 500 characters.
 */
function ReturnDialog({ ticket, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const length = reason.trim().length;

  const submit = async () => {
    if (length < RETURN_REASON_MIN) {
      setError(`Give a reason of at least ${RETURN_REASON_MIN} characters.`);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await returnDepartmentTicket({ ticketId: ticket.ticket_id, reason: reason.trim() });
      onDone(`${ticket.ticket_number} went back to CS with your reason.`);
    } catch (err) {
      const code = err?.response?.data?.code;
      if (code === 'DEPARTMENT_ALREADY_CLAIMED' || err?.response?.status === 403) {
        onDone(departmentRoutingErrorMessage(err), 'error');
        return;
      }
      setError(departmentRoutingErrorMessage(err, 'Failed to return the ticket.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      isOpen
      onClose={onClose}
      onSubmit={submit}
      title="Return to CS"
      subtitle={`${ticket.ticket_number}: ${ticket.title}`}
      icon={Undo2}
      confirmLabel="Return to CS"
      loading={saving}
      maxWidth="max-w-lg"
      tone="destructive"
    >
      <div className="space-y-2">
        <label htmlFor="department-return-reason" className="block text-xs font-medium text-slate-dark">
          Reason <span className="text-destructive">*</span>
        </label>
        <textarea
          id="department-return-reason"
          value={reason}
          maxLength={RETURN_REASON_MAX}
          onChange={(e) => { setReason(e.target.value); setError(''); }}
          rows={4}
          placeholder="Tell CS why your department should not take this ticket"
          className="w-full px-4 py-2 text-sm bg-card border border-border rounded-xl text-slate-dark focus:ring-2 focus:ring-accent outline-none resize-none"
        />
        <p className={`text-[11px] text-right ${length > 0 && length < RETURN_REASON_MIN ? 'text-destructive' : 'text-slate-muted'}`}>
          {length}/{RETURN_REASON_MAX} (at least {RETURN_REASON_MIN})
        </p>
        {error && (
          <p className="text-xs font-semibold text-destructive flex items-center gap-2" role="alert">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </p>
        )}
      </div>
    </FormModal>
  );
}

export default DepartmentQueueSwitch;
