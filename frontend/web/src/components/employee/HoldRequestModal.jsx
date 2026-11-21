import React, { useEffect, useState } from 'react';
import { PauseCircle, AlertCircle } from 'lucide-react';
import { FormModal } from '@/components/ui/form-modal';
import { requestHoldTicket } from '@/services/ticketService';

export const HOLD_REMARKS_MIN = 3;
export const HOLD_REMARKS_MAX = 250;
const MARKUP = /<[^>]*>/;

/**
 * Spec 0048 (AC-3): an assigned employee asks Customer Service to put the ticket On Hold.
 * The remark is required (3 to 250 characters, no markup). CS reads it before deciding.
 */
export default function HoldRequestModal({ isOpen, ticket, onClose, onSubmitted }) {
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setRemarks('');
      setError('');
    }
  }, [isOpen]);

  if (!ticket) return null;

  const handleSubmit = async () => {
    const trimmed = remarks.trim();
    if (trimmed.length < HOLD_REMARKS_MIN) {
      setError(`Please explain why the ticket should be put On Hold (at least ${HOLD_REMARKS_MIN} characters).`);
      return;
    }
    if (MARKUP.test(trimmed)) {
      setError('Remarks cannot contain HTML or markup.');
      return;
    }

    setIsSubmitting(true);
    setError('');
    try {
      const numericId = ticket.ticket_ID || Number(String(ticket.id).replace(/\D/g, ''));
      const result = await requestHoldTicket(numericId, trimmed);
      onSubmitted?.(result?.hold_request ?? null);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to send the On Hold request. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      onSubmit={handleSubmit}
      title="Request On Hold"
      subtitle="Customer Service reviews your remark and approves or rejects the request. The SLA keeps running until they approve."
      icon={PauseCircle}
      confirmLabel="Send Request"
      loading={isSubmitting}
      maxWidth="max-w-xl"
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-muted/40 p-4">
          <div className="text-xs font-mono font-semibold text-primary">{ticket.id}</div>
          <div className="text-sm font-semibold text-foreground mt-1">{ticket.title}</div>
        </div>

        {error && (
          <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-xs font-semibold text-destructive flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div>
          <label htmlFor="hold-request-remarks" className="block text-xs font-semibold text-muted-foreground mb-2">
            Remarks for Customer Service <span className="text-destructive">*</span>
          </label>
          <textarea
            id="hold-request-remarks"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            maxLength={HOLD_REMARKS_MAX}
            rows={4}
            disabled={isSubmitting}
            aria-describedby="hold-request-remarks-count"
            placeholder="Explain why work must pause (for example, waiting on a replacement part or on the customer's site access)..."
            className="w-full text-sm border border-border rounded-lg p-4 bg-background text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none disabled:opacity-50"
          />
          <div id="hold-request-remarks-count" className="text-right text-xs text-muted-foreground mt-2">
            {remarks.length}/{HOLD_REMARKS_MAX} characters
          </div>
        </div>
      </div>
    </FormModal>
  );
}
