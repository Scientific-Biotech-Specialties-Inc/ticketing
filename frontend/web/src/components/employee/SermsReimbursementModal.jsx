import React, { useState, useEffect } from 'react';
import {
  ReceiptText,
  DollarSign,
  Calendar,
  Building2,
  FileText,
  Upload,
  CheckCircle2,
  X,
  ExternalLink,
  Layers,
  ArrowRight,
  ShieldCheck,
  Paperclip,
  Trash2,
  AlertCircle,
  Clock,
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
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import {
  EXPENSE_CATEGORIES,
  getTicketReimbursement,
  saveTicketReimbursement,
} from '@/data/sermsReimbursementData';

export default function SermsReimbursementModal({
  ticket,
  open,
  onClose,
  onReimbursementSubmitted,
}) {
  const { user } = useAuth();
  const toast = useToast();

  const ticketId = ticket?.id || ticket?.ticket_ID;
  const existingClaim = getTicketReimbursement(ticketId);

  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [description, setDescription] = useState('');
  const [receiptFiles, setReceiptFiles] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [savedClaim, setSavedClaim] = useState(existingClaim);

  useEffect(() => {
    if (ticketId) {
      setSavedClaim(getTicketReimbursement(ticketId));
    }
  }, [ticketId, open]);

  if (!open || !ticket) return null;

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setReceiptFiles((prev) => [...prev, ...files]);
    e.target.value = null;
  };

  const removeFile = (idx) => {
    setReceiptFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!amount || Number(amount) <= 0) {
      toast.error('Please enter a valid expense amount.', 'VALIDATION ERROR');
      return;
    }

    setIsSubmitting(true);
    setTimeout(() => {
      const claimPayload = {
        claimNumber: savedClaim?.claimNumber || `SRM-2026-${Math.floor(1000 + Math.random() * 9000)}`,
        category,
        amount: parseFloat(amount).toFixed(2),
        date: expenseDate,
        description: description.trim(),
        claimantName: user?.name || user?.username || 'Field Technician',
        claimantEmail: user?.email || 'technician@sbsi.com.ph',
        ticketTitle: ticket.title || 'Service Ticket',
        customerName: ticket.customer_name || ticket.company_name || 'SBSI Client',
        receiptCount: receiptFiles.length,
        receiptNames: receiptFiles.map((f) => f.name),
        status: 'Pending Review',
        submittedAt: new Date().toISOString(),
      };

      const saved = saveTicketReimbursement(ticketId, claimPayload);
      setSavedClaim(saved);
      setIsSubmitting(false);

      toast.success(
        `Expense claim ${saved.claimNumber} filed successfully to SERMS!`,
        'SERMS REIMBURSEMENT FILED'
      );

      if (typeof onReimbursementSubmitted === 'function') {
        onReimbursementSubmitted(saved);
      }
    }, 700);
  };

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
              <span className="text-[10px] font-bold tracking-wider uppercase px-2.5 py-0.5 rounded-full bg-white/20 text-white shrink-0">
                SERMS REIMBURSEMENT
              </span>
              <span className="text-xs font-mono text-white/90 truncate">Ticket #{ticketId}</span>
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
          {/* Target System Connectivity Strip */}
          <div className="bg-blue-50/70 rounded-xl p-3 border border-blue-100 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              <span className="font-semibold text-slate-700">Destination:</span>
              <span className="font-medium text-[#252578]">SERMS Module (Smart Expense Reimbursement)</span>
            </div>
            <span className="text-[11px] text-slate-500 font-mono">Port 8004/8009 • Live</span>
          </div>

          {/* Ticket Context Information */}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-2 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <span className="text-muted-slate block">Linked Ticket:</span>
                <span className="font-semibold text-dark-slate">#{ticketId} — {ticket.title || 'Service Ticket'}</span>
              </div>
              <div>
                <span className="text-muted-slate block">Claimant / Field Technician:</span>
                <span className="font-semibold text-dark-slate">{user?.name || user?.username || 'Field Technician'}</span>
              </div>
            </div>
          </div>

          {/* If already submitted: Display Claim Summary */}
          {savedClaim ? (
            <div className="space-y-4">
              <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    <div>
                      <h4 className="font-bold text-emerald-950 text-sm">Claim Filed Successfully</h4>
                      <p className="text-xs text-emerald-800 font-mono mt-0.5">{savedClaim.claimNumber}</p>
                    </div>
                  </div>
                  <Badge variant="medium-success" size="default">
                    {savedClaim.status || 'Pending Review'}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-emerald-200/60 text-xs">
                  <div>
                    <span className="text-emerald-800/80 block">Expense Category:</span>
                    <span className="font-semibold text-emerald-950">{savedClaim.category}</span>
                  </div>
                  <div>
                    <span className="text-emerald-800/80 block">Total Claim Amount:</span>
                    <span className="font-bold text-emerald-950 text-sm">PHP {Number(savedClaim.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div>
                    <span className="text-emerald-800/80 block">Date of Expense:</span>
                    <span className="font-medium text-emerald-950">{savedClaim.date}</span>
                  </div>
                  <div>
                    <span className="text-emerald-800/80 block">Attached Receipts:</span>
                    <span className="font-medium text-emerald-950">{savedClaim.receiptCount || 0} File(s)</span>
                  </div>
                </div>

                {savedClaim.description && (
                  <div className="pt-2 border-t border-emerald-200/60 text-xs">
                    <span className="text-emerald-800/80 block">Notes & Justification:</span>
                    <p className="text-emerald-950 mt-0.5 italic">&quot;{savedClaim.description}&quot;</p>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 pt-2">
                <p className="text-xs text-muted-slate">
                  Your reimbursement is being routed to the Finance Department in SERMS.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSavedClaim(null)}
                  className="text-xs text-slate-600"
                >
                  File Another Claim
                </Button>
              </div>
            </div>
          ) : (
            /* Reimbursement Form */
            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Expense Category */}
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Expense Category <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs text-dark-slate focus:outline-none focus:ring-1 focus:ring-accent"
                    required
                  >
                    {EXPENSE_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Amount */}
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Amount (PHP ₱) <span className="text-red-500">*</span>
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    min="1"
                    placeholder="e.g. 750.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="h-10 text-xs"
                    required
                  />
                </div>
              </div>

              {/* Expense Date */}
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Date Incurred <span className="text-red-500">*</span>
                </label>
                <Input
                  type="date"
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                  className="h-10 text-xs"
                  required
                />
              </div>

              {/* Description */}
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Business Purpose / Justification <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Round-trip Grab fare to client hospital for emergency analyzer board replacement..."
                  className="w-full p-2.5 rounded-lg border border-slate-200 text-xs text-dark-slate focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                  required
                />
              </div>

              {/* Official Receipts Attachment */}
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Official Receipts (OR) / Tax Invoices
                </label>
                <label className="border-2 border-dashed border-slate-200 hover:border-accent rounded-xl p-3 flex flex-col items-center justify-center cursor-pointer transition-colors bg-slate-50/50 hover:bg-blue-50/20">
                  <Upload className="w-5 h-5 text-slate-400 mb-1" />
                  <span className="text-xs font-semibold text-accent">Attach Receipts</span>
                  <span className="text-[10px] text-muted-slate">PNG, JPG, or PDF up to 10MB</span>
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.png,.jpg,.jpeg"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>

                {receiptFiles.length > 0 && (
                  <div className="space-y-1.5 mt-2">
                    {receiptFiles.map((file, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-200 text-xs"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <Paperclip className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="truncate">{file.name}</span>
                          <span className="text-[10px] text-slate-400">
                            ({(file.size / 1024).toFixed(0)} KB)
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeFile(idx)}
                          className="text-slate-400 hover:text-rose-600 p-0.5 ml-2"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Form Buttons */}
              <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="default"
                  size="sm"
                  loading={isSubmitting}
                  disabled={isSubmitting || !amount || !description.trim()}
                  className="bg-primary hover:bg-[#2F2F8E] text-white"
                >
                  <ReceiptText className="w-4 h-4 mr-1.5" />
                  Submit to SERMS
                </Button>
              </div>
            </form>
          )}
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
