/**
 * Spec 0048: what a staff status column shows while an employee On Hold request is involved.
 * Display only. The stored ticket status (and the SLA) is unchanged until CS approves.
 *
 * Reads `hold_request_state` from staff list payloads ('pending' | 'rejected' | null), or the
 * `pending_hold_request` / `latest_rejected_hold_request` fields from ticket details.
 * Customer payloads never carry these fields, so customers always see the plain status.
 */
export const HOLD_PENDING_LABEL = 'Pending On Hold';
export const HOLD_REJECTED_LABEL = 'On Hold Rejected';

export const getHoldRequestState = (ticket) => {
  if (!ticket) return null;
  if (ticket.hold_request_state) return ticket.hold_request_state;
  if (ticket.pending_hold_request) return 'pending';
  if (ticket.latest_rejected_hold_request) return 'rejected';
  return null;
};

/** The hold request label, or `fallback` (default: the ticket's own status) when none applies. */
export const holdRequestDisplayStatus = (ticket, fallback = ticket?.status) => {
  const state = getHoldRequestState(ticket);
  if (state === 'pending') return HOLD_PENDING_LABEL;
  if (state === 'rejected') return HOLD_REJECTED_LABEL;
  return fallback;
};
