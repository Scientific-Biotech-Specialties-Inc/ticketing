import React, { useState } from 'react';
import { PauseCircle, Check, X, XCircle, AlertCircle } from 'lucide-react';
import { FormModal } from '@/components/ui/form-modal';
import { Button } from '@/components/ui/button';
import { formatDisplayDate } from '@/utils/dateUtils';
import { approveHoldRequest, rejectHoldRequest } from '@/services/ticketService';

const NOTE_MAX = 1000;
const REASON_MIN = 3;
const MARKUP = /<[^>]*>/;

/**
 * Spec 0048 (AC-9, AC-10, AC-11): the CS ticket modal banner for a pending employee
 * On Hold request. Shows who asked, when, and the full remark, with Approve (optional
 * note) and Reject (required reason). Approval puts the ticket On Hold on the server.
 */
export default function HoldRequestDecisionCard({ holdRequest, ticketId, readOnly = false, onDecided }) {
  const [mode, setMode] = useState(null); // 'approve' | 'reject' | null
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  if (!holdRequest) return null;

  const open = (next) => {
    setMode(next);
    setText('');
    setError('');
  };

  const close = () => {
    if (isSaving) return;
    setMode(null);
  };

  const submit = async () => {
    const trimmed = text.trim();
    if (mode === 'reject' && trimmed.length < REASON_MIN) {
      setError(`A reason is required to reject the request (at least ${REASON_MIN} characters).`);
      return;
    }
    if (trimmed && MARKUP.test(trimmed)) {
      setError('This field cannot contain HTML or markup.');
      return;
    }

    setIsSaving(true);
    setError('');
    try {
      if (mode === 'approve') {
        await approveHoldRequest(holdRequest.id, ticketId, trimmed);
      } else {
        await rejectHoldRequest(holdRequest.id, ticketId, trimmed);
      }
      const decided = mode;
      setMode(null);
      onDecided?.(decided, holdRequest);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to save your decision. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const requester = holdRequest.requested_by?.name || 'The assigned employee';

  return (
    <>
      <section
        aria-label="On Hold request pending review"
        className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-xs"
      >
        <div className="flex items-start gap-4">
          <PauseCircle className="w-5 h-5 text-amber-600 shrink-0 mt-1" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-dark-slate">On Hold request pending review</h3>
            <p className="text-xs text-muted-slate mt-1">
              {requester} asked to put this ticket On Hold
              {holdRequest.requested_at ? ` on ${formatDisplayDate(holdRequest.requested_at)}` : ''}.
              The SLA keeps running until you approve.
            </p>
            <blockquote className="mt-2 rounded-lg border border-amber-200 bg-white p-2 text-xs text-dark-slate whitespace-pre-wrap break-words">
              {holdRequest.remarks}
            </blockquote>
            {!readOnly && (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={() => open('approve')} className="gap-2">
                  <Check className="w-4 h-4" aria-hidden="true" />
                  Approve
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => open('reject')}
                  className="gap-2 border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-400 focus-visible:ring-red-500/40"
                >
                  <X className="w-4 h-4 text-red-600" aria-hidden="true" />
                  Reject
                </Button>
              </div>
            )}
          </div>
        </div>
      </section>

      <FormModal
        isOpen={mode !== null}
        onClose={close}
        onSubmit={submit}
        title={mode === 'approve' ? 'Approve On Hold Request' : 'Reject On Hold Request'}
        subtitle={
          mode === 'approve'
            ? 'The ticket goes On Hold with the employee\'s remark as the reason, and the SLA pauses. The customer only sees that the ticket is On Hold.'
            : 'The ticket stays as it is. The employee sees your reason.'
        }
        icon={mode === 'reject' ? XCircle : PauseCircle}
        tone={mode === 'reject' ? 'destructive' : 'default'}
        confirmLabel={mode === 'approve' ? 'Approve and Hold' : 'Reject Request'}
        loading={isSaving}
        maxWidth="max-w-lg"
      >
        <div className="space-y-4">
          {error && (
            <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
          <div>
            <label htmlFor="hold-decision-text" className="block text-xs font-semibold text-muted-slate mb-2">
              {mode === 'approve' ? 'Note (optional)' : 'Reason'}
              {mode === 'reject' && <span className="text-rose-600"> *</span>}
            </label>
            <textarea
              id="hold-decision-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={NOTE_MAX}
              rows={4}
              disabled={isSaving}
              placeholder={mode === 'approve' ? 'Add context for the staff timeline...' : 'Explain why the ticket should keep going...'}
              className={`w-full text-sm border border-slate-200 rounded-lg p-2 bg-white text-dark-slate outline-none focus:ring-1 resize-none disabled:opacity-50 ${
                mode === 'reject' ? 'focus:border-red-500 focus:ring-red-500' : 'focus:border-accent focus:ring-accent'
              }`}
            />
            <div className="text-right text-xs text-muted-slate mt-1">{text.length}/{NOTE_MAX}</div>
          </div>
        </div>
      </FormModal>
    </>
  );
}
