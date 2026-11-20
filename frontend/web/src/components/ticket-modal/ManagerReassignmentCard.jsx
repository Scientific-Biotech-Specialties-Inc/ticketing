import React, { useEffect, useRef, useState } from 'react';
import { UserCog, Check, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDisplayDate } from '@/utils/dateUtils';
import { acknowledgeManagerReassignment } from '@/services/ticketService';

const names = (list) => (Array.isArray(list) ? list.map((p) => p?.name).filter(Boolean).join(', ') : '');

/**
 * CS ticket modal banner for a department manager reassignment that CS has not acknowledged yet.
 * Shows who moved the ticket, when, and who was added or removed. Acknowledge clears it for every CS user.
 * With autoAcknowledge, opening the ticket counts as seeing it: the card acknowledges itself once and
 * stays visible (without the button) for the rest of this view.
 */
export default function ManagerReassignmentCard({ reassignment, ticketId, readOnly = false, autoAcknowledge = false, onAcknowledged }) {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [seen, setSeen] = useState(false);
  const autoSentRef = useRef(false);

  useEffect(() => {
    if (!autoAcknowledge || readOnly || !reassignment || !ticketId || autoSentRef.current) return;
    autoSentRef.current = true;
    acknowledgeManagerReassignment(ticketId)
      .then(() => {
        setSeen(true);
        onAcknowledged?.({ automatic: true });
      })
      .catch(() => {
        // Leave the Acknowledge button so CS can retry by hand.
        autoSentRef.current = false;
      });
  }, [autoAcknowledge, readOnly, reassignment, ticketId, onAcknowledged]);

  if (!reassignment) return null;

  const manager = reassignment.manager_name || 'A department manager';
  const department = reassignment.department ? `${reassignment.department} Manager` : 'Manager';
  const added = names(reassignment.added);
  const removed = names(reassignment.removed);

  const acknowledge = async () => {
    setIsSaving(true);
    setError('');
    try {
      await acknowledgeManagerReassignment(ticketId);
      setSeen(true);
      onAcknowledged?.({ automatic: false });
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to acknowledge. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section
      aria-label="Reassigned by a department manager"
      data-testid="manager-reassignment-card"
      className="rounded-xl border border-accent/30 bg-accent/5 p-4 shadow-xs"
    >
      <div className="flex items-start gap-4">
        <UserCog className="w-5 h-5 text-accent shrink-0 mt-1" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-dark-slate">Reassigned by {department}</h3>
          <p className="text-xs text-muted-slate mt-1">
            {manager} reassigned this ticket
            {reassignment.reassigned_at ? ` on ${formatDisplayDate(reassignment.reassigned_at)}` : ''}.
          </p>
          {(added || removed) && (
            <ul className="mt-2 space-y-1 text-xs text-dark-slate">
              {added && <li><strong className="font-semibold">Added:</strong> {added}</li>}
              {removed && <li><strong className="font-semibold">Removed:</strong> {removed}</li>}
            </ul>
          )}
          {error && (
            <div role="alert" className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
          {seen && (
            <p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700" data-testid="manager-reassignment-seen">
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
              Marked as seen
            </p>
          )}
          {!readOnly && !seen && (
            <div className="mt-4">
              <Button type="button" size="sm" onClick={acknowledge} disabled={isSaving} className="gap-2">
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Check className="w-4 h-4" aria-hidden="true" />}
                Acknowledge
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
