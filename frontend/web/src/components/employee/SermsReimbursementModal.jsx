import React, { useState, useEffect } from 'react';
import {
  ReceiptText,
  Upload,
  CheckCircle2,
  X,
  Paperclip,
  Trash2,
  AlertCircle,
  Clock,
  XCircle,
  RotateCcw,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { submitTicketReimbursement } from '@/services/ticketService';
import useTicketReimbursement from '@/hooks/useTicketReimbursement';
import {
  EXPENSE_CATEGORIES,
  MAX_DESCRIPTION_LENGTH,
  MAX_RECEIPT_BYTES,
  MAX_RECEIPTS,
  RECEIPT_ACCEPT,
  normalizeReimbursement,
} from '@/data/sermsReimbursementData';

const TONE_STYLES = {
  success: { box: 'bg-emerald-50 border-emerald-200', title: 'text-emerald-950', sub: 'text-emerald-800', badge: 'medium-success', Icon: CheckCircle2, icon: 'text-emerald-600' },
  danger: { box: 'bg-rose-50 border-rose-200', title: 'text-rose-950', sub: 'text-rose-800', badge: 'outline', Icon: XCircle, icon: 'text-rose-600' },
  warning: { box: 'bg-amber-50 border-amber-200', title: 'text-amber-950', sub: 'text-amber-800', badge: 'outline', Icon: RotateCcw, icon: 'text-amber-600' },
  pending: { box: 'bg-blue-50 border-blue-200', title: 'text-slate-900', sub: 'text-slate-700', badge: 'outline', Icon: Clock, icon: 'text-[#2E85D8]' },
};

const today = () => new Date().toISOString().split('T')[0];

function firstValidationError(err) {
  const data = err?.response?.data;
  const errors = data?.errors;
  if (errors && typeof errors === 'object') {
    const first = Object.values(errors).flat()[0];
    if (first) return String(first);
  }
  return data?.message || 'The reimbursement could not be submitted. Please try again.';
}

export default function SermsReimbursementModal({
  ticket,
  open,
  onClose,
  onReimbursementSubmitted,
}) {
  const { user } = useAuth();
  const toast = useToast();

  const ticketId = ticket?.ticket_ID || ticket?.id;
  const ticketLabel = ticket?.ticket_number || ticket?.id || ticketId;
  const { claim, canSubmit, loading, error: loadError, refresh } = useTicketReimbursement(ticketId, { enabled: Boolean(open) });

  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState(today);
  const [description, setDescription] = useState('');
  const [receiptFiles, setReceiptFiles] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (!open) {
      setShowForm(false);
      setSubmitError('');
    }
  }, [open]);

  if (!open || !ticket) return null;

  const claimantName = user?.name || [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username || 'Employee';

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = null;
    if (!files.length) return;
    const tooBig = files.filter((f) => f.size > MAX_RECEIPT_BYTES);
    if (tooBig.length) {
      toast.error(`${tooBig.map((f) => f.name).join(', ')} exceeds 2 MB.`, 'Receipt Too Large');
    }
    const accepted = files.filter((f) => f.size <= MAX_RECEIPT_BYTES);
    setReceiptFiles((prev) => [...prev, ...accepted].slice(0, MAX_RECEIPTS));
  };

  const removeFile = (idx) => {
    setReceiptFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const resetForm = () => {
    setCategory(EXPENSE_CATEGORIES[0]);
    setAmount('');
    setExpenseDate(today());
    setDescription('');
    setReceiptFiles([]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError('');
    if (!amount || Number(amount) < 0.01) {
      setSubmitError('Please enter a valid expense amount.');
      return;
    }
    if (!receiptFiles.length) {
      setSubmitError('Attach at least one receipt (JPG, PNG, or PDF).');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await submitTicketReimbursement(
        ticketId,
        {
          amount: Number(amount).toFixed(2),
          expense_category: category,
          description: description.trim(),
          expense_date: expenseDate,
        },
        receiptFiles
      );
      const saved = normalizeReimbursement(res?.data);
      toast.success(
        `Reimbursement ${saved?.claimNumber || ''} submitted to SERMS.`.replace('  ', ' '),
        'Reimbursement Submitted'
      );
      resetForm();
      setShowForm(false);
      await refresh();
      if (typeof onReimbursementSubmitted === 'function') {
        onReimbursementSubmitted(saved);
      }
    } catch (err) {
      if (err?.response?.status === 409) {
        await refresh();
        setShowForm(false);
        toast.info?.('A reimbursement is already filed for this ticket.', 'Already Filed');
      } else {
        setSubmitError(firstValidationError(err));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const formVisible = !loading && (showForm || (!claim && canSubmit));
  const tone = TONE_STYLES[claim?.tone] || TONE_STYLES.pending;
  const ToneIcon = tone.Icon;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-2xl w-[95vw] md:w-full p-0 overflow-hidden rounded-2xl bg-white border border-slate-200/80 shadow-2xl flex flex-col gap-0 font-sans"
        showClose={false}
      >
        {/* Modal Header */}
        <div className="p-6 bg-gradient-to-r from-[#252578] to-[#2E85D8] text-white relative w-full">
          <div className="flex items-center justify-between gap-3 pb-2 w-full">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] font-bold tracking-wider px-2.5 py-0.5 rounded-full bg-white/20 text-white shrink-0">
                SERMS Reimbursement
              </span>
              <span className="text-xs font-mono text-white/90 truncate">Ticket {ticketLabel}</span>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-white hover:bg-white/20 bg-white/10 transition-colors cursor-pointer shrink-0"
              aria-label="Close modal"
            >
              <X className="w-4 h-4 text-white" />
            </button>
          </div>

          <DialogHeader className="text-left mt-1 w-full">
            <DialogTitle className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              <ReceiptText className="w-5 h-5 text-accent" />
              Request Expense Reimbursement
            </DialogTitle>
            <DialogDescription className="text-xs text-white/80 mt-0.5">
              Smart Expense Reimbursement Management System (SERMS) Integration
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Modal Body */}
        <div className="p-6 max-h-[70vh] overflow-y-auto space-y-4">
          {/* Ticket Context Information */}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-2 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <span className="text-muted-slate block">Linked Ticket:</span>
                <span className="font-semibold text-dark-slate">{ticketLabel} — {ticket.title || 'Service Ticket'}</span>
              </div>
              <div>
                <span className="text-muted-slate block">Claimant:</span>
                <span className="font-semibold text-dark-slate">{claimantName}</span>
              </div>
            </div>
          </div>

          {loading && !claim ? (
            <div className="space-y-3" aria-label="Loading reimbursement">
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
          ) : null}

          {loadError && !claim && !loading ? (
            <div className="rounded-xl p-3 border border-rose-200 bg-rose-50 text-xs text-rose-800 flex items-center justify-between gap-3">
              <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" />{loadError}</span>
              <Button type="button" variant="outline" size="sm" onClick={refresh}>Retry</Button>
            </div>
          ) : null}

          {/* Existing claim summary */}
          {claim && !showForm ? (
            <div className="space-y-4">
              <div className={`rounded-xl p-4 border space-y-3 ${tone.box}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <ToneIcon className={`w-5 h-5 ${tone.icon}`} />
                    <div>
                      <h4 className={`font-bold text-sm ${tone.title}`}>Reimbursement Filed</h4>
                      <p className={`text-xs font-mono mt-0.5 ${tone.sub}`}>{claim.claimNumber}</p>
                    </div>
                  </div>
                  <Badge variant={tone.badge} size="default">{claim.status}</Badge>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-black/5 text-xs">
                  <div>
                    <span className={`block ${tone.sub}`}>Expense Category:</span>
                    <span className={`font-semibold ${tone.title}`}>{claim.category}</span>
                  </div>
                  <div>
                    <span className={`block ${tone.sub}`}>Claim Amount:</span>
                    <span className={`font-bold text-sm ${tone.title}`}>PHP {Number(claim.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div>
                    <span className={`block ${tone.sub}`}>Date of Expense:</span>
                    <span className={`font-medium ${tone.title}`}>{claim.date || '—'}</span>
                  </div>
                  <div>
                    <span className={`block ${tone.sub}`}>Attached Receipts:</span>
                    <span className={`font-medium ${tone.title}`}>{claim.receiptCount} File(s)</span>
                  </div>
                </div>

                {claim.description && (
                  <div className="pt-2 border-t border-black/5 text-xs">
                    <span className={`block ${tone.sub}`}>Business Purpose:</span>
                    <p className={`mt-0.5 italic ${tone.title}`}>&quot;{claim.description}&quot;</p>
                  </div>
                )}

                {(claim.rejectionComment || claim.message) && (
                  <div className="pt-2 border-t border-black/5 text-xs">
                    <span className={`block ${tone.sub}`}>{claim.rejectionComment ? 'Finance Comment:' : 'SERMS Update:'}</span>
                    <p className={`mt-0.5 ${tone.title}`}>{claim.rejectionComment || claim.message}</p>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 pt-2">
                <p className="text-xs text-muted-slate">
                  {claim.statusKey === 'revise'
                    ? 'Finance returned this claim for revision. Update it in SERMS.'
                    : claim.canResubmit
                      ? 'This claim was rejected. You can file a new one.'
                      : 'Status updates from SERMS appear here automatically.'}
                </p>
                {claim.canResubmit && canSubmit && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowForm(true)} className="text-xs text-slate-600">
                    File New Claim
                  </Button>
                )}
              </div>
            </div>
          ) : null}

          {!loading && !claim && !canSubmit && !loadError ? (
            <p className="text-xs text-muted-slate">
              Only the employee assigned to this ticket can request a reimbursement, once the ticket is Resolved or Closed.
            </p>
          ) : null}

          {/* Reimbursement Form */}
          {formVisible ? (
            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              {submitError && (
                <div role="alert" className="rounded-lg p-3 border border-rose-200 bg-rose-50 text-rose-800 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
                  <span>{submitError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="serms-category" className="font-semibold text-slate-700 block mb-1">
                    Expense Category <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="serms-category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs text-dark-slate focus:outline-none focus:ring-1 focus:ring-accent"
                    required
                  >
                    {EXPENSE_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="serms-amount" className="font-semibold text-slate-700 block mb-1">
                    Amount (PHP ₱) <span className="text-red-500">*</span>
                  </label>
                  <Input
                    id="serms-amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="e.g. 750.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="h-10 text-xs"
                    required
                  />
                </div>
              </div>

              <div>
                <label htmlFor="serms-date" className="font-semibold text-slate-700 block mb-1">
                  Date Incurred <span className="text-red-500">*</span>
                </label>
                <Input
                  id="serms-date"
                  type="date"
                  max={today()}
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                  className="h-10 text-xs"
                  required
                />
              </div>

              <div>
                <label htmlFor="serms-description" className="font-semibold text-slate-700 block mb-1">
                  Business Purpose / Justification <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="serms-description"
                  rows={3}
                  maxLength={MAX_DESCRIPTION_LENGTH}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Round-trip Grab fare to client hospital for emergency analyzer board replacement"
                  className="w-full p-2.5 rounded-lg border border-slate-200 text-xs text-dark-slate focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                  required
                />
                <p className="text-[10px] text-muted-slate text-right">{description.length}/{MAX_DESCRIPTION_LENGTH}</p>
              </div>

              <div>
                <span className="font-semibold text-slate-700 block mb-1">
                  Official Receipts (OR) / Tax Invoices <span className="text-red-500">*</span>
                </span>
                <label className="border-2 border-dashed border-slate-200 hover:border-accent rounded-xl p-3 flex flex-col items-center justify-center cursor-pointer transition-colors bg-slate-50/50 hover:bg-blue-50/20">
                  <Upload className="w-5 h-5 text-slate-400 mb-1" />
                  <span className="text-xs font-semibold text-accent">Attach Receipts</span>
                  <span className="text-[10px] text-muted-slate">PNG, JPG, or PDF up to 2 MB each</span>
                  <input
                    type="file"
                    multiple
                    accept={RECEIPT_ACCEPT}
                    onChange={handleFileChange}
                    className="hidden"
                    aria-label="Attach receipts"
                  />
                </label>

                {receiptFiles.length > 0 && (
                  <div className="space-y-1.5 mt-2">
                    {receiptFiles.map((file, idx) => (
                      <div
                        key={`${file.name}-${idx}`}
                        className="flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-200 text-xs"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <Paperclip className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="truncate">{file.name}</span>
                          <span className="text-[10px] text-slate-400">({(file.size / 1024).toFixed(0)} KB)</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeFile(idx)}
                          className="text-slate-400 hover:text-rose-600 p-0.5 ml-2"
                          aria-label={`Remove ${file.name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={claim ? () => setShowForm(false) : onClose}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="default"
                  size="sm"
                  loading={isSubmitting}
                  disabled={isSubmitting || !amount || !description.trim() || receiptFiles.length === 0}
                  className="bg-primary hover:bg-[#2F2F8E] text-white"
                >
                  <ReceiptText className="w-4 h-4 mr-1.5" />
                  Submit to SERMS
                </Button>
              </div>
            </form>
          ) : null}
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-3 w-full shrink-0">
          <div className="text-xs text-muted-slate">
            Target System: <span className="font-semibold text-slate-700">SERMS Module</span>
          </div>
          <Button variant="outline" size="sm" onClick={onClose} className="h-8 text-xs">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
