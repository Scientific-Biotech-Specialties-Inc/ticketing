import { useCallback, useEffect, useState } from 'react';
import { getTicketReimbursement } from '@/services/ticketService';
import { normalizeReimbursement } from '@/data/sermsReimbursementData';

/**
 * Loads the SERMS reimbursement claim of a ticket from ticket-service.
 *
 * Returns { claim, canSubmit, eligible, loading, error, refresh }. claim is null when no claim
 * was filed. A failed lookup leaves claim null and sets error; the ticket views still render.
 * Pass enabled=false to skip the request (for example while the ticket is not yet loaded).
 */
export default function useTicketReimbursement(ticketId, { enabled = true } = {}) {
  const [state, setState] = useState({ claim: null, canSubmit: false, eligible: false, loading: false, error: null });

  const numericId = ticketId ? Number(String(ticketId).replace(/\D/g, '')) : null;

  const refresh = useCallback(async () => {
    if (!numericId || !enabled) return null;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await getTicketReimbursement(numericId);
      const next = {
        claim: normalizeReimbursement(res?.data),
        canSubmit: Boolean(res?.can_submit),
        eligible: Boolean(res?.eligible),
        loading: false,
        error: null,
      };
      setState(next);
      return next;
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err?.response?.data?.message || 'Could not load the reimbursement.' }));
      return null;
    }
  }, [numericId, enabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { ...state, refresh };
}
