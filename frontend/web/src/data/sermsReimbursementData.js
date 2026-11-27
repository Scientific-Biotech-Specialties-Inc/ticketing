/**
 * SERMS (Smart Expense Reimbursement Management System) integration helpers.
 *
 * Claims are filed and tracked through ticket-service (/tickets/{id}/reimbursement), which
 * forwards them to SERMS and keeps the latest SERMS status. Nothing is stored in the browser.
 */

/** SERMS expense categories (the ticket-service validates against the same list). */
export const EXPENSE_CATEGORIES = ['Transportation', 'Travel', 'Meals', 'Accommodation', 'Supplies', 'Others'];

/** SERMS limits, mirrored for early client-side feedback. */
export const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;
export const MAX_RECEIPTS = 10;
export const MAX_DESCRIPTION_LENGTH = 255;
export const RECEIPT_ACCEPT = '.pdf,.png,.jpg,.jpeg';

const STATUS_LABELS = {
  submitted: 'Submitted',
  pending: 'Pending Review',
  processing: 'Processing',
  for_review: 'Pending Review',
  revise: 'Returned for Revision',
  approved: 'Approved',
  granted: 'Granted',
  released: 'Released',
  rejected: 'Rejected',
};

/** Title Case label for a SERMS status (for example "for_review" -> "Pending Review"). */
export function formatReimbursementStatus(status) {
  const key = String(status || '').toLowerCase();
  if (STATUS_LABELS[key]) return STATUS_LABELS[key];
  return key
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ') || 'Submitted';
}

/** Visual tone for a SERMS status: 'success' | 'danger' | 'warning' | 'pending'. */
export function reimbursementStatusTone(status) {
  const key = String(status || '').toLowerCase();
  if (['approved', 'granted', 'released'].includes(key)) return 'success';
  if (key === 'rejected') return 'danger';
  if (key === 'revise') return 'warning';
  return 'pending';
}

/** Maps the ticket-service claim payload to the shape the ticket views render. */
export function normalizeReimbursement(claim) {
  if (!claim) return null;
  return {
    claimNumber: claim.reference_no || 'Pending reference',
    reimbursementId: claim.reimbursement_id,
    status: formatReimbursementStatus(claim.status),
    statusKey: String(claim.status || '').toLowerCase(),
    tone: reimbursementStatusTone(claim.status),
    message: claim.message,
    amount: claim.amount ?? 0,
    category: claim.expense_category || '—',
    description: claim.description,
    date: claim.expense_date,
    receiptCount: claim.receipt_count ?? 0,
    rejectionComment: claim.rejection_comment,
    approvedAt: claim.approved_at,
    submittedAt: claim.submitted_at,
    updatedAt: claim.updated_at,
    canResubmit: Boolean(claim.can_resubmit),
  };
}
