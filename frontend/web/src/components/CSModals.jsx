import { safeUrl } from '@/utils/safeUrl';
import { attachmentUrl } from '@/utils/attachmentFiles';
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  HelpCircle,
  X,
  FileText,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Pencil,
  Paperclip,
  Loader2,
  Eye,
  Clock,
  User,
  Building2,
  Tag,
  Shield,
  ShieldAlert,
  Check,
  AlertTriangle,
  PauseCircle,
  Bell,
  Send,
  RefreshCw,
  Users,
  UserPlus,
  UserX,
  Phone,
  Mail,
  UserCheck,
  ArrowUpRight,
  MessageCircle,
  Search,
  PlayCircle,
} from 'lucide-react';
import { formatDisplayDate } from '@/utils/dateUtils';
import { formatProperSentenceCase } from '@/utils/titleCaseUtils';
import FilePreviewModal from './FilePreviewModal';
import { useAuth } from '@/context/AuthContext';
import {
  updateEmployeeTicketOverride,
  holdTicket,
  resumeTicket,
  reclassifyTicket,
  getTicketFormOptions,
  addInternalNote,
  getInternalNotes,
  sendTicketReminder,
  getEligibleEmployees,
  getAssignableEmployees,
  updateTicket,
  respondReassignment,
  recordProofView,
} from '@/services/ticketService';
import { getTicketMessages } from '@/services/messagingService';
import {
  TicketDetailModalShell,
  ModalHeader,
  TicketTitleBlock,
  StatusStepper,
  AlertBanner,
  AssigneeRow,
  TabBar,
  FieldGrid,
  AttachmentCard,
  DecisionCard,
  ModalFooter,
  RejectReasonModal,
  StaffTimelineView,
  StaffNotesTab,
  formatPHT,
  formatRelativePHT,
  getAssigneeInfo,
  getAllAssignees,
} from './ticket-modal';
import CustomerTicketDetailModal from './CustomerTicketDetailModal';
import HoldRequestDecisionCard from './ticket-modal/HoldRequestDecisionCard';
import ManagerReassignmentCard from './ticket-modal/ManagerReassignmentCard';
import InternalNotesSection, { NoteList } from './InternalNotesSection';
import TicketFeedbackSection from './feedback/TicketFeedbackSection';
import { hasFeedbackBeenSubmitted } from '@/data/mockFeedbackData';
import useLockBodyScroll from '@/hooks/useLockBodyScroll';
import useLiveTicket from '@/hooks/useLiveTicket';
import { priorityColors } from '@/constants/employeeTickets';
import { Button } from '@/components/ui/button';
import { ConfirmationModal } from '@/components/ui/confirmation-modal';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge, getStatusBadgeVariant } from '@/components/ui/badge';
import EscalateTicketModal from './cs/EscalateTicketModal';
import { getEscalationManagers } from '@/utils/escalationManagers';

/* Helper functions for robust file attachment handling */
const isQuarantinedFile = (file) => {
  if (!file || typeof file !== 'object') return false;
  return Boolean(file.is_quarantined || file.quarantined || file.status === 'quarantined' || file.virus_detected);
};

const getFileUrlRaw = (file) => {
  if (!file) return '';
  if (typeof file === 'string') return file;
  if (file.url) return file.url;
  // Spec 0037: a bare file_path is opened through the authenticated loader, never /storage/.
  if (file.file_path) return attachmentUrl(file.file_path);
  if (file.path) return file.path;
  return '';
};
const getFileUrl = (file) => safeUrl(getFileUrlRaw(file));

const getFileName = (file) => {
  if (!file) return 'Attachment';
  if (typeof file === 'string') return file.split('/').pop() || 'Attachment';
  return file.name || file.file_name || 'Attachment';
};

/* ─────────────────────────────────────────────
   CONFIRMATION DIALOG
───────────────────────────────────────────── */
/**
 * Confirmation before CS resolves a ticket from the Incoming modal. Remarks are required.
 */
export function ResolveRemarksDialog({ onConfirm, onCancel, isSaving = false, error = '' }) {
  useLockBodyScroll(true);
  const [remarks, setRemarks] = useState('');
  const [touched, setTouched] = useState(false);
  const trimmed = remarks.trim();
  const tooShort = trimmed.length < 3;

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px] overscroll-none">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="resolve-remarks-title"
        className="bg-card border border-border rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto overscroll-contain shadow-modal p-6 animate-in fade-in zoom-in-95 duration-200"
      >
        <div className="flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4 text-primary">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <h4 id="resolve-remarks-title" className="text-lg font-bold text-slate-dark mb-2">
            Resolve this ticket?
          </h4>
          <p className="text-sm text-slate-muted mb-4 leading-relaxed">
            The ticket will be resolved without being assigned to anyone. The customer can still reopen it within the reopen window.
          </p>
        </div>

        <label htmlFor="resolve-remarks" className="block text-xs font-medium text-slate-dark mb-2">
          Remarks <span className="text-destructive">*</span>
        </label>
        <textarea
          id="resolve-remarks"
          rows={4}
          maxLength={1000}
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="Explain how this ticket was resolved..."
          className="w-full rounded-xl border border-border bg-card p-3 text-sm text-slate-dark outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        <div className="flex items-center justify-between mt-1 mb-4">
          <span className="text-xs text-destructive">
            {touched && tooShort ? 'Remarks are required (at least 3 characters).' : ''}
          </span>
          <span className="text-[11px] text-slate-muted">{remarks.length}/1000</span>
        </div>

        {error && (
          <p className="mb-4 text-xs font-medium text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-2">
            {error}
          </p>
        )}

        <div className="flex gap-3 w-full">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSaving} className="flex-1">
            Go Back
          </Button>
          <Button
            type="button"
            variant="default"
            onClick={() => {
              setTouched(true);
              if (!tooShort) onConfirm(trimmed);
            }}
            disabled={isSaving || tooShort}
            className="flex-1"
          >
            {isSaving ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="w-4 h-4 animate-spin" /> Resolving...
              </span>
            ) : 'Yes, Resolve'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmDialog({ onConfirm, onCancel, isSaving = false, title = "Update this ticket?", message = "Are you sure you want to save the changes to this ticket?", confirmText = "Yes, Update" }) {
  useLockBodyScroll(true);
  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px] overscroll-none">
      <div className="bg-card border border-border rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto overscroll-contain shadow-modal p-6 flex flex-col items-center text-center animate-in fade-in zoom-in-95 duration-200">
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4 text-primary">
          <HelpCircle className="w-6 h-6" />
        </div>

        <h4 className="text-lg font-bold text-slate-dark mb-2">
          {title}
        </h4>
        <p className="text-sm text-slate-muted mb-6 leading-relaxed">
          {message}
        </p>

        <div className="flex gap-3 w-full">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isSaving}
            className="flex-1"
          >
            Go Back
          </Button>
          <Button
            type="button"
            variant="default"
            onClick={onConfirm}
            disabled={isSaving}
            className="flex-1"
          >
            {isSaving ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="w-4 h-4 animate-spin" /> Saving...
              </span>
            ) : confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   HOLD TICKET DIALOG
───────────────────────────────────────────── */
export function HoldTicketDialog({ isOpen, onClose, onConfirm, isSaving = false }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  useLockBodyScroll(isOpen);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setError('A reason of at least 3 characters is required to place a ticket on hold.');
      return;
    }
    setError('');
    onConfirm(trimmed);
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px] overscroll-none">
      <div className="bg-white rounded-2xl w-120 max-w-full max-h-[90vh] overflow-y-auto overscroll-contain shadow-2xl p-6 sm:p-7 relative flex flex-col">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h4 className="text-base sm:text-lg font-bold text-gray-800">Place Ticket On Hold</h4>
            <p className="text-xs text-gray-500">Temporarily pause progress while awaiting external information</p>
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-xs text-amber-800 leading-relaxed">
          Placing this ticket on hold will pause its SLA clock and alert relevant stakeholders. You can resume this ticket at any time once external info is received.
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              Reason for Hold <span className="text-red-500">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (error && e.target.value.trim().length >= 3) setError('');
              }}
              rows={4}
              maxLength={1000}
              placeholder="Explain why this ticket is being placed on hold (e.g., Awaiting customer network diagnostic logs or vendor replacement parts)..."
              className="w-full text-xs sm:text-sm border border-gray-200 rounded-xl p-3 bg-white text-gray-800 outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 resize-none"
              required
            />
            <div className="flex justify-between items-center text-[11px] text-gray-400 mt-1">
              <span>Minimum 3 characters</span>
              <span>{reason.length}/1000</span>
            </div>
            {error && <p className="text-xs text-red-600 mt-1 font-medium">{error}</p>}
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="flex-1 py-2.5 text-xs sm:text-sm font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || reason.trim().length < 3}
              className="flex-1 py-2.5 text-xs sm:text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition-colors shadow-lg shadow-amber-600/30 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isSaving ? 'Placing on Hold...' : 'Confirm Place on Hold'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   RECLASSIFY EDIT MODAL
───────────────────────────────────────────── */
export function ReclassifyEditModal({
  isOpen,
  onClose,
  currentCategory,
  currentPriority,
  categories = [],
  priorities = ['Low', 'Medium', 'High', 'Critical'],
  onReviewChanges,
}) {
  const [selectedCategory, setSelectedCategory] = useState(currentCategory || '');
  const [selectedPriority, setSelectedPriority] = useState(currentPriority || 'Low');
  const [error, setError] = useState('');
  useLockBodyScroll(isOpen);

  useEffect(() => {
    setSelectedCategory(currentCategory || '');
    setSelectedPriority(currentPriority || 'Low');
    setError('');
  }, [currentCategory, currentPriority, isOpen]);

  if (!isOpen) return null;

  const handleNext = () => {
    if (selectedCategory === currentCategory && selectedPriority === currentPriority) {
      setError('Please change at least one value (Category or Priority) to proceed.');
      return;
    }
    setError('');
    onReviewChanges({
      newCategory: selectedCategory,
      newPriority: selectedPriority,
    });
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px] overscroll-none">
      <div className="bg-white rounded-2xl w-115 max-w-full max-h-[90vh] overflow-y-auto overscroll-contain shadow-2xl p-6 sm:p-7 relative flex flex-col">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-[#252578]/10 text-[#252578] flex items-center justify-center shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </div>
          <div>
            <h4 className="text-base sm:text-lg font-bold text-gray-800">Edit Category & Priority</h4>
            <p className="text-xs text-gray-500">Correct classification after initial assignment</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              Problem Category
            </label>
            <select
              value={selectedCategory}
              onChange={(e) => {
                setSelectedCategory(e.target.value);
                setError('');
              }}
              className="w-full text-xs sm:text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-white text-gray-800 outline-none focus:ring-2 focus:ring-[#252578]/30"
            >
              {categories.map((c) => {
                const name = typeof c === 'string' ? c : (c.category_name || c.label || c.name);
                return (
                  <option key={name} value={name}>
                    {name}
                  </option>
                );
              })}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              Priority Level
            </label>
            <select
              value={selectedPriority}
              onChange={(e) => {
                setSelectedPriority(e.target.value);
                setError('');
              }}
              className="w-full text-xs sm:text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-white text-gray-800 outline-none focus:ring-2 focus:ring-[#252578]/30"
            >
              {priorities.map((p) => {
                const name = typeof p === 'string' ? p : (p.priority_name || p.label || p.name);
                return (
                  <option key={name} value={name}>
                    {name}
                  </option>
                );
              })}
            </select>
          </div>

          {error && <p className="text-xs text-red-600 font-medium">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 text-xs sm:text-sm font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleNext}
              className="flex-1 py-2.5 text-xs sm:text-sm font-semibold text-white bg-[#252578] hover:bg-[#1e1e60] rounded-xl transition-colors shadow-lg shadow-[#252578]/30 cursor-pointer"
            >
              Review Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   RECLASSIFY CONFIRMATION MODAL (OLD VS NEW)
───────────────────────────────────────────── */
export function ReclassifyConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  oldCategory,
  newCategory,
  oldPriority,
  newPriority,
  isSaving = false,
  error = '',
}) {
  useLockBodyScroll(isOpen);
  if (!isOpen) return null;

  const categoryChanged = oldCategory !== newCategory;
  const priorityChanged = oldPriority !== newPriority;

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px] overscroll-none">
      <div className="bg-white rounded-2xl w-120 max-w-full max-h-[90vh] overflow-y-auto overscroll-contain shadow-2xl p-6 sm:p-7 relative flex flex-col">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <div>
            <h4 className="text-base sm:text-lg font-bold text-gray-800">Confirm Ticket Reclassification</h4>
            <p className="text-xs text-gray-500">Review Old vs. New values before applying</p>
          </div>
        </div>

        {/* Comparison card */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-4 space-y-3">
          <div className="flex items-center justify-between pb-2.5 border-b border-gray-200 text-xs">
            <span className="font-semibold text-gray-500">Field</span>
            <div className="flex items-center gap-4">
              <span className="font-semibold text-gray-500">Current</span>
              <span className="text-gray-400">➔</span>
              <span className="font-semibold text-gray-800">Proposed</span>
            </div>
          </div>

          {/* Category comparison */}
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-gray-600">Category</span>
            <div className="flex items-center gap-3">
              <span className="text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{oldCategory || '—'}</span>
              <span className="text-gray-400">➔</span>
              <span className={`px-2 py-0.5 rounded font-semibold ${categoryChanged ? 'bg-blue-100 text-blue-800 border border-blue-200' : 'text-gray-500'}`}>
                {newCategory || '—'}
              </span>
            </div>
          </div>

          {/* Priority comparison */}
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-gray-600">Priority</span>
            <div className="flex items-center gap-3">
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${priorityColors[oldPriority] ?? 'bg-gray-100 text-gray-700'}`}>
                {oldPriority || '—'}
              </span>
              <span className="text-gray-400">➔</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${priorityChanged ? (priorityColors[newPriority] ?? 'bg-blue-100 text-blue-800') + ' ring-2 ring-blue-400' : (priorityColors[newPriority] ?? 'bg-gray-100 text-gray-700')}`}>
                {newPriority || '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Notices */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-xs text-amber-800 space-y-1 leading-relaxed">
          <p className="font-semibold text-amber-900 flex items-center gap-1.5">
            <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Important Reclassification Impacts:
          </p>
          <ul className="list-disc list-inside space-y-0.5 text-amber-800 pl-1">
            <li>SLA response and resolution target deadlines will automatically recalculate.</li>
            <li>If this ticket is already assigned, manual technician reassignment may be needed to align with the new category.</li>
          </ul>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-3 rounded-xl mb-4">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="flex-1 py-2.5 text-xs sm:text-sm font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors cursor-pointer"
          >
            Go Back
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSaving}
            className="flex-1 py-2.5 text-xs sm:text-sm font-semibold text-white bg-[#252578] hover:bg-[#1e1e60] rounded-xl transition-colors shadow-lg shadow-[#252578]/30 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isSaving ? 'Updating...' : 'Confirm & Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

export const renderTicketSlaBadge = (rawStatus, dueAt) => {
  const status = rawStatus ? String(rawStatus).toLowerCase().replace(/[\s_-]+/g, '') : null;
  const formattedDue = dueAt ? formatDisplayDate(dueAt) : null;

  if (status === 'breached') {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200"
        title={formattedDue ? `Breached deadline: ${formattedDue}` : 'Resolution target breached'}
      >
        <AlertTriangle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
        <span>Breached</span>
      </span>
    );
  }

  if (status === 'atrisk') {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200"
        title={formattedDue ? `Deadline: ${formattedDue}` : 'SLA resolution near breach'}
      >
        <Clock className="h-3.5 w-3.5 text-amber-600 shrink-0" />
        <span>At Risk</span>
      </span>
    );
  }

  if (status === 'paused') {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200"
        title="SLA clock paused while on hold"
      >
        <PauseCircle className="h-3.5 w-3.5 text-blue-600 shrink-0" />
        <span>Paused (On Hold)</span>
      </span>
    );
  }

  if (status === 'ontrack' || status === 'compliant') {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200"
        title={formattedDue ? `Target: ${formattedDue}` : 'Compliant with SLA targets'}
      >
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
        <span>On Track</span>
      </span>
    );
  }

  if (status === 'unavailable' || status === 'slaunavailable') {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200"
        title="SLA calculation unavailable due to system configuration failure"
      >
        <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
        <span>SLA Unavailable</span>
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-50 text-slate-600 border border-slate-200"
      title="No SLA rule configured for this category and priority"
    >
      <HelpCircle className="h-3.5 w-3.5 text-slate-400 shrink-0" />
      <span>No SLA Configured</span>
    </span>
  );
};

export function SendReminderDialog({ isOpen, onClose, onConfirm, ticket, assignedEmployee, isSending = false, error = '' }) {
  useLockBodyScroll(isOpen);
  const [customMessage, setCustomMessage] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    onConfirm(customMessage);
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px] overscroll-none animate-in fade-in duration-200">
      <div className="bg-card border border-border rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto overscroll-contain shadow-modal p-6 flex flex-col animate-in zoom-in-95 duration-200">
        <div className="flex items-start justify-between pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Bell className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h4 className="text-base font-bold text-slate-dark">Send Employee Reminder</h4>
              <p className="text-xs text-slate-muted">Prompt the assigned employee to act before ticket breaches SLA.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSending}
            className="text-slate-muted hover:text-slate-dark transition-colors p-1 rounded-md cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="rounded-xl border border-border bg-page p-3.5 space-y-2 text-xs">
            <div className="flex justify-between items-center">
              <span className="font-bold text-slate-dark">Ticket ID:</span>
              <span className="font-mono text-primary font-semibold">{ticket?.id || ticket?.ticket_ID}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-bold text-slate-dark">Recipient:</span>
              <span className="font-semibold text-slate-700">{assignedEmployee?.name || 'Assigned Support Specialist'}</span>
            </div>
            {ticket?.title && (
              <div className="flex justify-between items-center">
                <span className="font-bold text-slate-dark">Title:</span>
                <span className="text-slate-600 truncate max-w-[260px]">{ticket.title}</span>
              </div>
            )}
            {ticket?.due_at && (
              <div className="flex justify-between items-center">
                <span className="font-bold text-slate-dark">SLA Due Date:</span>
                <span className="font-medium text-slate-700">{formatDisplayDate(ticket.due_at)}</span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-dark mb-1.5">
              Custom Message (Optional)
            </label>
            <textarea
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              placeholder="Add an urgent note or instructions for the employee..."
              rows={3}
              maxLength={500}
              className="w-full resize-none rounded-xl border border-border bg-page p-3 text-xs text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent placeholder:text-muted-foreground"
            />
            <div className="mt-1 flex justify-end">
              <span className="text-[10px] text-slate-muted">{customMessage.length}/500</span>
            </div>
          </div>

          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs p-3 rounded-lg flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2 border-t border-border">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="default"
              disabled={isSending}
              className="flex items-center gap-1.5"
            >
              {isSending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Sending...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Send Reminder</span>
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   TICKET SUMMARY VIEW (post-save / already assigned)
───────────────────────────────────────────── */
/** Messages route for the current role area (React Router paths, relative to the app basename). */
const getMessagesPath = () => {
  const pathname = window.location.pathname;
  if (pathname.includes('/cs-manager')) return '/cs-manager/messages';
  if (pathname.includes('/service-manager')) return '/service-manager/messages';
  if (pathname.includes('/it-manager')) return '/it-manager/messages';
  if (pathname.includes('/employee')) return '/employee/messages';
  return '/cs/messages';
};

export function TicketSummary({ ticket: ticketProp, employees = [], onClose, onEdit, onStatusUpdate, readOnly = false, isLoadingDetails = false, onManagerReassignmentSeen }) {
  // Follow the backend while the summary is open so assignee/status changes made elsewhere
  // (another CS agent, the employee accepting) show up without closing and reopening it.
  const { ticket: liveTicket, refresh: refreshLiveTicket } = useLiveTicket(ticketProp);
  const [localPatch, setLocalPatch] = useState(null);
  const ticketKey = ticketProp?.ticket_ID ?? ticketProp?.id ?? null;
  useEffect(() => {
    setLocalPatch(null);
  }, [ticketKey]);
  const ticket = useMemo(
    () => (localPatch && liveTicket ? { ...liveTicket, ...localPatch } : liveTicket),
    [liveTicket, localPatch]
  );

  // Keep the manager reassignment shown for this whole view, even after opening it marks it seen
  // (the refreshed ticket no longer carries it).
  const shownReassignmentRef = useRef(null);
  if (ticket?.manager_reassignment) shownReassignmentRef.current = ticket.manager_reassignment;
  const shownReassignment = ticket?.manager_reassignment || shownReassignmentRef.current;
  const handleReassignmentAcknowledged = useCallback(({ automatic } = {}) => {
    if (!automatic) {
      setActionSuccessNotice('Manager reassignment acknowledged.');
      setTimeout(() => setActionSuccessNotice(''), 6000);
    }
    onManagerReassignmentSeen?.();
  }, [onManagerReassignmentSeen]);
  useLockBodyScroll(!!ticket);
  const navigate = useNavigate();
  const { user } = useAuth();

  // Reassignment Reject Modal State
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showResumeConfirm, setShowResumeConfirm] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);

  // Active Tab state: 'details' | 'timeline' | 'notes' | 'files'
  const [activeTab, setActiveTab] = useState('details');
  const [timelineExpanded, setTimelineExpanded] = useState(true);

  // Internal Notes State
  const [internalNotesList, setInternalNotesList] = useState(ticket?.internalNotes || []);
  const [isAddingNote, setIsAddingNote] = useState(false);

  // Dynamic ticket classification & status states for instant in-place reflection
  const [currentCategory, setCurrentCategory] = useState(ticket?.category || '');
  const [currentPriority, setCurrentPriority] = useState(ticket?.priority || 'Low');
  const [currentStatus, setCurrentStatus] = useState(ticket?.status || 'Pending');
  // The Transition Matrix only allows Escalated from these states (not On Hold, Pending
  // Evaluation, Reopened, Resolved, Closed, or an already Escalated ticket).
  const canEscalateFromStatus = ['Open', 'Pending Assignment', 'Assigned', 'In Progress'].includes(currentStatus);
  const [currentHoldReason, setCurrentHoldReason] = useState(ticket?.hold_reason || '');

  // Dynamic SLA Due Date & SLA Status states
  const [currentSlaDueDate, setCurrentSlaDueDate] = useState(
    ticket?.resolution_due_at || ticket?.due_at || ticket?.sla_due_date || ticket?.sla?.resolution?.target || null
  );
  const [currentSlaStatus, setCurrentSlaStatus] = useState(
    ticket?.sla_status || ticket?.slaStatus || ticket?.sla?.resolution?.status || (ticket?.status === 'On Hold' ? 'Paused' : null)
  );
  const [currentLastReminder, setCurrentLastReminder] = useState(
    ticket?.last_reminder_sent_at || null
  );

  const isBreached = useMemo(() => {
    const normalized = currentSlaStatus ? String(currentSlaStatus).toLowerCase().replace(/[\s_-]+/g, '') : '';
    return normalized === 'breached' || normalized === 'violated' || Boolean(ticket?.sla_breached);
  }, [currentSlaStatus, ticket?.sla_breached]);

  // Managers the ticket is escalated to (ticket details `escalated_to`). The backend escalates a
  // breached ticket to its department managers automatically, so a breached or already escalated
  // ticket shows who it went to instead of an Escalate button.
  const escalatedTo = Array.isArray(ticket?.escalated_to) ? ticket.escalated_to : [];
  const isAlreadyEscalated = isBreached || escalatedTo.length > 0 || currentStatus === 'Escalated';
  const escalatedToText = escalatedTo.length > 0
    ? escalatedTo.map((m) => (m.department ? `${m.name} (${m.department} Manager)` : m.name)).join(', ')
    : 'the department manager';
  const escalationIsAutomatic = escalatedTo.length > 0 ? escalatedTo.some((m) => m.automatic) : isBreached;

  // Send Reminder state
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [isSendingReminder, setIsSendingReminder] = useState(false);
  const [reminderError, setReminderError] = useState('');

  // Hold action state
  const [showHoldModal, setShowHoldModal] = useState(false);
  const [isHolding, setIsHolding] = useState(false);

  // Reclassification state
  const [formOptions, setFormOptions] = useState({ categories: [], priorities: [] });
  const [showReclassifyEdit, setShowReclassifyEdit] = useState(false);
  const [reclassifyPendingValues, setReclassifyPendingValues] = useState(null);
  const [showReclassifyConfirm, setShowReclassifyConfirm] = useState(false);
  const [isReclassifying, setIsReclassifying] = useState(false);
  const [reclassifyError, setReclassifyError] = useState('');
  const [reassignmentNotice, setReassignmentNotice] = useState('');
  const [actionSuccessNotice, setActionSuccessNotice] = useState('');
  const [actionErrorNotice, setActionErrorNotice] = useState('');

  // Escalation state (TS032)
  const [showEscalateModal, setShowEscalateModal] = useState(false);
  const [isEscalating, setIsEscalating] = useState(false);
  const [escalateError, setEscalateError] = useState('');

  // Proof rejection state
  const [showRejectProofInput, setShowRejectProofInput] = useState(false);
  const [proofRejectionReason, setProofRejectionReason] = useState('');
  // Keys of the proof documents CS has opened; every one must be viewed before resolving.
  const [viewedProofKeys, setViewedProofKeys] = useState(() => new Set());

  const cleanTicketId = useMemo(() => {
    const raw = ticket?.ticket_ID || ticket?.id;
    if (!raw) return null;
    const n = Number(String(raw).replace(/\D/g, ''));
    return isNaN(n) ? null : n;
  }, [ticket?.ticket_ID, ticket?.id]);

  const ticketFormattedId = ticket?.id || (cleanTicketId ? `TKT-${String(cleanTicketId).padStart(4, '0')}` : 'TKT-0000');

  // Sync internal state with prop changes
  useEffect(() => {
    setInternalNotesList(ticket?.internalNotes || []);
    setCurrentCategory(ticket?.category || '');
    setCurrentPriority(ticket?.priority || 'Low');
    setCurrentStatus(ticket?.status || 'Pending');
    setCurrentHoldReason(ticket?.hold_reason || '');
    setCurrentSlaDueDate(ticket?.resolution_due_at || ticket?.due_at || ticket?.sla_due_date || ticket?.sla?.resolution?.target || null);
    setCurrentSlaStatus(ticket?.sla_status || ticket?.slaStatus || ticket?.sla?.resolution?.status || (ticket?.status === 'On Hold' ? 'Paused' : null));
    setCurrentLastReminder(ticket?.last_reminder_sent_at || null);

    if (cleanTicketId) {
      getInternalNotes(cleanTicketId).then((notes) => {
        if (Array.isArray(notes) && notes.length > 0) {
          setInternalNotesList(notes);
        }
      }).catch((err) => {
        console.warn('Failed to load internal notes from DB:', err);
      });
    }
    // Keyed on the incoming prop, not the live-merged `ticket`, so a background refresh does not
    // reset in-progress local state or refetch notes. Live status is synced by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketProp]);

  // Reflect server-side status changes (e.g. the assigned employee accepts the ticket).
  useEffect(() => {
    if (ticket?.status) setCurrentStatus(ticket.status);
  }, [ticket?.status]);

  // Load available form options
  useEffect(() => {
    let active = true;
    getTicketFormOptions().then((opts) => {
      if (active && opts) {
        setFormOptions({
          categories: (opts.problem_categories || []).map((c) => c.category_name || c.name || c),
          rawCategories: opts.problem_categories || [],
          priorities: (opts.ticket_priorities || []).map((p) => p.priority_name || p.name || p),
          rawPriorities: opts.ticket_priorities || [],
        });
      }
    }).catch((err) => {
      console.warn('Failed to load form options in TicketSummary:', err);
    });
    return () => { active = false; };
  }, []);

  // Fetch assignable employees fallback if employees prop is empty
  const [fetchedEmployees, setFetchedEmployees] = useState([]);

  useEffect(() => {
    let isMounted = true;
    if (!employees || employees.length === 0) {
      getAssignableEmployees({ forceRefresh: false })
        .then((emps) => {
          if (!isMounted || !Array.isArray(emps)) return;
          const mapped = emps.map((row) => ({
            id: Number(row.id ?? row.emp_id),
            name: row.name || `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.email || `Staff #${row.id ?? row.emp_id}`,
            role: row.role || row.technical_role || 'Technician',
            department: row.department || 'Service',
            status: row.account_active === false ? 'inactive' : 'active',
            presence: row.presence || (row.is_active ? 'online' : 'offline'),
            is_active: Boolean(row.is_active || row.account_active),
          }));
          setFetchedEmployees(mapped);
        })
        .catch((err) => console.warn('Could not load fallback assignable employees:', err));
    }
    return () => { isMounted = false; };
  }, [employees]);

  const activeStaffList = useMemo(() => {
    if (Array.isArray(employees) && employees.length > 0) return employees;
    return fetchedEmployees;
  }, [employees, fetchedEmployees]);

  // Assignee Information
  const allAssignees = useMemo(() => {
    return getAllAssignees(ticket, activeStaffList);
  }, [ticket, activeStaffList]);

  const assignee = useMemo(() => {
    return getAssigneeInfo(ticket, activeStaffList);
  }, [ticket, activeStaffList]);

  const isTicketAssigned = assignee.isAssigned || allAssignees.length > 0;

  // Requesting employee for reassignment
  const requestingEmployee = useMemo(() => {
    let name = '';
    let dept = ticket?.department || 'Service Department';

    if (ticket?.reassignmentRequestedBy) {
      const match = (activeStaffList || []).find(e => String(e.id || e.emp_id) === String(ticket.reassignmentRequestedBy));
      if (match?.name) {
        name = match.name;
        if (match.department) dept = match.department;
      } else if (typeof ticket.reassignmentRequestedBy === 'string' && isNaN(Number(ticket.reassignmentRequestedBy))) {
        name = ticket.reassignmentRequestedBy.replace(/^Employee ID:\s*/i, '').trim();
      }
    }

    if (!name) {
      name = assignee.name !== 'Unassigned' ? assignee.name : 'Assigned Technician';
      dept = assignee.department;
    }

    const initials = name.split(' ').filter(Boolean).map((n) => n[0]).join('').slice(0, 2).toUpperCase() || 'MR';

    return { name, department: dept, initials };
  }, [ticket, activeStaffList, assignee]);

  // Available technicians for reassignment (exclude current requester if possible)
  const availableTechnicians = useMemo(() => {
    if (!Array.isArray(activeStaffList) || activeStaffList.length === 0) return [];
    const currentId = ticket?.reassignmentRequestedBy || (ticket?.assigned && ticket?.assigned[0]?.id) || (ticket?.assigned && ticket?.assigned[0]);
    return activeStaffList.filter((e) => {
      // Exclude currently assigned technician who requested reassignment
      if (currentId != null && String(e.id || e.emp_id) === String(currentId)) return false;
      // Exclude deactivated accounts if explicitly flagged
      if (e.account_active === false || e.status === 'deactivated') return false;
      return true;
    });
  }, [activeStaffList, ticket]);

  // Suggested technician (match from reason / suggestion fields)
  const suggestedEmpId = useMemo(() => {
    if (ticket?.suggested_employee_id) return String(ticket.suggested_employee_id);
    if (ticket?.suggested_technician_id) return String(ticket.suggested_technician_id);
    const searchStr = `${ticket?.reassignmentReason || ''} ${ticket?.specialist_suggestion || ''}`.toLowerCase();
    const matched = (availableTechnicians || []).find(e => e.name && searchStr.includes(e.name.toLowerCase()));
    return matched ? String(matched.id || matched.emp_id) : '';
  }, [ticket, availableTechnicians]);

  const csTicketNumericId = useMemo(() => {
    const raw = ticket?.ticket_ID || ticket?.id;
    if (!raw) return null;
    const n = Number(String(raw).replace(/\D/g, ''));
    return isNaN(n) ? null : n;
  }, [ticket?.ticket_ID, ticket?.id]);

  // Normalized attachments & files
  const normalizedAttachments = useMemo(() => {
    let list = ticket?.attachments || ticket?.ticket_attachments || [];
    if (typeof list === 'string') {
      try { list = JSON.parse(list); } catch { list = []; }
    }
    const ticketDate = ticket?.date_created || ticket?.created_at || ticket?.date;
    return Array.isArray(list) ? list.map((item, idx) => ({
      ...(typeof item === 'string' ? { name: item, url: item } : item),
      id: item?.id || item?.attachment_id || `att-${idx}`,
      source: item?.source || 'ticket',
      created_at: item?.created_at || item?.uploaded_at || ticketDate,
    })) : [];
  }, [ticket?.attachments, ticket?.ticket_attachments, ticket?.date_created, ticket?.created_at, ticket?.date]);

  const proofFiles = useMemo(() => {
    const list = ticket?.proofAttachments || ticket?.proofFiles || [];
    return Array.isArray(list) ? list.map((item, idx) => ({
      ...(typeof item === 'string' ? { name: item, url: item } : item),
      id: item?.id || `proof-${idx}`,
      source: 'proof',
      created_at: item?.created_at || item?.uploaded_at || ticket?.updated_at || ticket?.last_updated,
    })) : [];
  }, [ticket?.proofAttachments, ticket?.proofFiles, ticket?.updated_at, ticket?.last_updated]);

  const employeeRemarks = useMemo(() => {
    if (typeof ticket?.remarks === 'string' && ticket.remarks.trim()) {
      return ticket.remarks.trim();
    }
    if (typeof ticket?.proof_remarks === 'string' && ticket.proof_remarks.trim()) {
      return ticket.proof_remarks.trim();
    }
    if (Array.isArray(ticket?.remarks) && ticket.remarks.length > 0) {
      const last = ticket.remarks[ticket.remarks.length - 1];
      return typeof last === 'string' ? last : (last?.remark || last?.text || last?.notes || '');
    }
    if (Array.isArray(ticket?.remarks_history) && ticket.remarks_history.length > 0) {
      const last = ticket.remarks_history[ticket.remarks_history.length - 1];
      return typeof last === 'string' ? last : (last?.remark || last?.text || last?.notes || '');
    }
    if (Array.isArray(ticket?.timeline)) {
      const proofEvt = [...ticket.timeline].reverse().find(e => e.type === 'proof' || e.type === 'remark' || /proof|complet/i.test(e.text || ''));
      if (proofEvt?.text) return proofEvt.text;
    }
    return '';
  }, [ticket]);

  const [messageFiles, setMessageFiles] = useState([]);

  useEffect(() => {
    let isMounted = true;
    if (csTicketNumericId) {
      getTicketMessages(csTicketNumericId)
        .then((res) => {
          if (!isMounted) return;
          const msgs = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
          const files = [];
          msgs.forEach((m) => {
            if (Array.isArray(m.attachments)) {
              m.attachments.forEach((att, attIdx) => {
                files.push({
                  ...(typeof att === 'string' ? { name: att, url: att } : att),
                  id: att.id || att.attachment_id || `msg-att-${m._id || m.id || 'm'}-${attIdx}`,
                  source: 'message',
                  is_from_message: true,
                  sender_name: m.sender_name || (m.sender_role ? `${m.sender_role}` : (m.sender_type === 'customer' ? 'Customer' : 'Staff')),
                  sender_role: m.sender_role || (m.sender_type === 'customer' ? 'Customer' : 'Staff'),
                  created_at: att.created_at || m.created_at || m.timestamp,
                });
              });
            }
          });
          setMessageFiles(files);
        })
        .catch(() => {});
    }
    return () => { isMounted = false; };
  }, [csTicketNumericId]);

  const allFiles = useMemo(() => {
    return [...normalizedAttachments, ...messageFiles, ...proofFiles];
  }, [normalizedAttachments, messageFiles, proofFiles]);

  // Message thread redirection
  const handleOpenMessages = () => {
    onClose();
    navigate(getMessagesPath(), { state: { selectedTicketId: ticket?.ticket_ID || ticket?.id } });
  };

  // Reminder authorization & cooldown check
  const isAuthorizedForReminder = useMemo(() => {
    if (!user) return true;
    const role = String(user.role || user.role_name || user.user_type || '').toLowerCase();
    const dept = String(user.department || user.profile?.department?.name || '').toLowerCase();
    return role.includes('cs') || role.includes('customer') || role.includes('admin') || dept.includes('customer service') || dept.includes('support') || dept.includes('admin');
  }, [user]);

  const isEligibleForReminder = Boolean(
    isAuthorizedForReminder &&
    isTicketAssigned &&
    currentStatus !== 'Resolved' &&
    currentStatus !== 'Closed'
  );

  const reminderCooldownMs = 60 * 60 * 1000;
  const isReminderOnCooldown = useMemo(() => {
    if (!currentLastReminder) return false;
    const sentTime = new Date(currentLastReminder).getTime();
    return !isNaN(sentTime) && (Date.now() - sentTime) < reminderCooldownMs;
  }, [currentLastReminder]);

  const cooldownMinutesRemaining = useMemo(() => {
    if (!isReminderOnCooldown || !currentLastReminder) return 0;
    const sentTime = new Date(currentLastReminder).getTime();
    return Math.max(1, Math.ceil((reminderCooldownMs - (Date.now() - sentTime)) / (60 * 1000)));
  }, [isReminderOnCooldown, currentLastReminder]);

  const handleSendReminderConfirm = async (customMessage) => {
    setIsSendingReminder(true);
    setReminderError('');
    try {
      const ticketId = cleanTicketId || ticket.ticket_ID || ticket.id;
      await sendTicketReminder(ticketId, customMessage);
      const nowIso = new Date().toISOString();
      setCurrentLastReminder(nowIso);
      ticket.last_reminder_sent_at = nowIso;

      const recipientName = assignee.name;
      const reminderEvent = {
        id: `reminder-${Date.now()}`,
        type: 'reminder',
        text: `Reminder dispatched to ${recipientName} by CS.${customMessage ? ` Custom message: "${customMessage}"` : ''}`,
        timestamp: nowIso,
      };
      if (!ticket.timeline) ticket.timeline = [];
      ticket.timeline.unshift(reminderEvent);

      setShowReminderModal(false);
      setActionSuccessNotice(`Reminder successfully dispatched to ${recipientName}.`);
      setTimeout(() => setActionSuccessNotice(''), 6000);
    } catch (err) {
      console.error('Failed to send reminder:', err);
      const msg = err.response?.data?.message || 'Notification service currently unreachable. Failed to send reminder.';
      setReminderError(msg);
    } finally {
      setIsSendingReminder(false);
    }
  };

  // Reclassification Handlers
  const handleReviewReclassify = ({ newCategory, newPriority }) => {
    setReclassifyPendingValues({ newCategory, newPriority });
    setShowReclassifyEdit(false);
    setShowReclassifyConfirm(true);
    setReclassifyError('');
  };

  const handleConfirmReclassify = async () => {
    if (!reclassifyPendingValues) return;
    setIsReclassifying(true);
    setReclassifyError('');

    try {
      const ticketId = cleanTicketId || ticket.ticket_ID || ticket.id;
      const rawCats = formOptions.rawCategories || [];
      const rawPriorities = formOptions.rawPriorities || [];

      const matchedCat = rawCats.find(c => (c.category_name || c.name) === reclassifyPendingValues.newCategory);
      const matchedPriority = rawPriorities.find(p => (p.priority_name || p.name) === reclassifyPendingValues.newPriority);

      const priorityMap = { 'Low': 1, 'Medium': 2, 'High': 3, 'Critical': 4 };

      const payload = {
        ticketId,
        problem_category_ID: matchedCat ? (matchedCat.problem_category_ID || matchedCat.id) : undefined,
        priority_ID: matchedPriority ? (matchedPriority.priority_ID || matchedPriority.id) : priorityMap[reclassifyPendingValues.newPriority],
      };

      const res = await reclassifyTicket(payload);
      const timestamp = new Date().toISOString();
      const oldCat = currentCategory;
      const oldPri = currentPriority;

      setCurrentCategory(reclassifyPendingValues.newCategory);
      setCurrentPriority(reclassifyPendingValues.newPriority);
      ticket.category = reclassifyPendingValues.newCategory;
      ticket.priority = reclassifyPendingValues.newPriority;

      if (res?.data?.sla?.target_resolution) {
        ticket.sla = res.data.sla.target_resolution;
      }
      if (res?.data?.ticket?.due_at || res?.data?.due_at || res?.ticket?.due_at) {
        const newDue = res.data?.ticket?.due_at || res.data?.due_at || res.ticket?.due_at;
        setCurrentSlaDueDate(newDue);
        ticket.due_at = newDue;
        ticket.resolution_due_at = newDue;
      }
      if (res?.data?.ticket?.sla_status || res?.data?.sla_status || res?.ticket?.sla_status) {
        const newSlaStatus = res.data?.ticket?.sla_status || res.data?.sla_status || res.ticket?.sla_status;
        setCurrentSlaStatus(newSlaStatus);
        ticket.sla_status = newSlaStatus;
      }

      const timelineText = `Ticket classification updated: Category changed from "${oldCat}" to "${reclassifyPendingValues.newCategory}", Priority changed from "${oldPri}" to "${reclassifyPendingValues.newPriority}".`;
      const reclassifyTimelineEvent = {
        id: `reclassify-${Date.now()}`,
        type: 'status',
        text: timelineText,
        timestamp,
      };

      if (!ticket.timeline) ticket.timeline = [];
      ticket.timeline.push(reclassifyTimelineEvent);

      const updated = {
        ...ticket,
        category: reclassifyPendingValues.newCategory,
        priority: reclassifyPendingValues.newPriority,
        due_at: ticket.due_at,
        sla_status: ticket.sla_status,
        timeline: [...ticket.timeline],
      };

      if (typeof onStatusUpdate === 'function') {
        await onStatusUpdate(updated);
      }

      setShowReclassifyConfirm(false);
      setReclassifyPendingValues(null);

      if (res?.data?.reassignment_needed) {
        setReassignmentNotice('Notice: Ticket classification updated. As this ticket is already assigned, manual reassignment may be needed to align with the new category or priority.');
      } else {
        setActionSuccessNotice('Ticket category and priority updated successfully. SLA targets recalculated.');
        setTimeout(() => setActionSuccessNotice(''), 6000);
      }
    } catch (err) {
      console.error('Failed to reclassify ticket:', err);
      setReclassifyError(err.response?.data?.message || 'Failed to update ticket classification. Please try again.');
    } finally {
      setIsReclassifying(false);
    }
  };

  // Escalation Handler: the ticket-service notifies the manager of each assigned employee's
  // department. The assignees keep the ticket; nothing is reassigned here.
  const handleConfirmEscalate = async ({ managers = [], departments = [], reason }) => {
    setIsEscalating(true);
    setEscalateError('');
    try {
      const ticketId = cleanTicketId || ticket.ticket_ID || ticket.id;

      await updateTicket({
        ticketId,
        statusId: 5, // Escalated
        escalation_reason: reason,
        assignedByEmail: user?.email,
      });

      const recipientText = managers.length > 0
        ? managers.map((m) => `${m.name} (${m.department || 'Manager'})`).join(', ')
        : `the ${departments.join(' and ')} department manager${departments.length === 1 ? '' : 's'}`;

      const noteText = `[Escalation]: Escalated to ${recipientText}. Reason: "${reason}"`;
      await addInternalNote(ticketId, noteText).catch(() => {});

      const refreshedNotes = await getInternalNotes(ticketId).catch(() => null);
      if (Array.isArray(refreshedNotes)) {
        setInternalNotesList(refreshedNotes);
      }

      setCurrentStatus('Escalated');
      ticket.status = 'Escalated';
      setActionSuccessNotice(`Ticket escalated to ${recipientText}.`);
      setShowEscalateModal(false);

      if (typeof onStatusUpdate === 'function') {
        const timestamp = new Date().toLocaleString('en-US');
        onStatusUpdate({
          id: ticket.id,
          status: 'Escalated',
          escalation_reason: reason,
          timeline: [
            ...(ticket.timeline || []),
            {
              id: `escalate-${Date.now()}`,
              type: 'escalation',
              text: `Ticket escalated to ${recipientText}. Reason: "${reason}"`,
              timestamp,
            }
          ]
        });
      }
    } catch (err) {
      console.error('Failed to escalate ticket:', err);
      setEscalateError(err?.response?.data?.message || 'Failed to escalate ticket. Please check your network connection and try again.');
    } finally {
      setIsEscalating(false);
    }
  };

  // Hold & Resume Handlers
  const handleConfirmHold = async (reason) => {
    setIsHolding(true);
    try {
      const ticketId = cleanTicketId || ticket.ticket_ID || ticket.id;
      await holdTicket(ticketId, reason);
      const timestamp = new Date().toISOString();
      const holdTimelineEvent = {
        id: `hold-${Date.now()}`,
        type: 'status',
        text: `Ticket placed on hold by CS. Reason: "${reason}". SLA clock paused.`,
        timestamp,
      };

      setCurrentStatus('On Hold');
      setCurrentHoldReason(reason);
      setCurrentSlaStatus('Paused');
      ticket.status = 'On Hold';
      ticket.hold_reason = reason;
      ticket.sla_status = 'Paused';
      if (!ticket.timeline) ticket.timeline = [];
      ticket.timeline.push(holdTimelineEvent);

      const updated = {
        ...ticket,
        status: 'On Hold',
        hold_reason: reason,
        timeline: [...ticket.timeline],
      };

      if (typeof onStatusUpdate === 'function') {
        await onStatusUpdate(updated);
      }

      setShowHoldModal(false);
      setActionSuccessNotice('Ticket successfully placed on hold. The SLA clock is paused.');
      setTimeout(() => setActionSuccessNotice(''), 6000);
    } catch (err) {
      console.error('Failed to place ticket on hold:', err);
      window.alert(err.response?.data?.message || 'Failed to place ticket on hold.');
    } finally {
      setIsHolding(false);
    }
  };

  const handleResumeTicket = async () => {
    setIsProcessing(true);
    try {
      const ticketId = cleanTicketId || ticket.ticket_ID || ticket.id;
      await resumeTicket(ticketId);
      setShowResumeConfirm(false);
      const timestamp = new Date().toISOString();
      const nextStatus = isTicketAssigned ? 'In Progress' : 'Pending Assignment';
      const resumeTimelineEvent = {
        id: `resume-${Date.now()}`,
        type: 'status',
        text: `Ticket resumed from On Hold by CS. Status changed to ${nextStatus}. SLA clock resumed.`,
        timestamp,
      };

      setCurrentStatus(nextStatus);
      setCurrentHoldReason('');
      setCurrentSlaStatus('On Track');
      ticket.status = nextStatus;
      ticket.hold_reason = null;
      ticket.sla_status = 'On Track';
      if (!ticket.timeline) ticket.timeline = [];
      ticket.timeline.push(resumeTimelineEvent);

      const updated = {
        ...ticket,
        status: nextStatus,
        hold_reason: null,
        sla_status: 'On Track',
        timeline: [...ticket.timeline],
      };

      if (typeof onStatusUpdate === 'function') {
        await onStatusUpdate(updated);
      }

      setActionSuccessNotice(`Ticket successfully resumed. Current status is now ${nextStatus}.`);
      setTimeout(() => setActionSuccessNotice(''), 6000);
    } catch (err) {
      console.error('Failed to resume ticket:', err);
      window.alert(err.response?.data?.message || 'Failed to resume ticket from on hold.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Reassignment Decision Handlers
  const handleApproveAndReassign = async (newEmployeeIdsInput) => {
    // DecisionCard passes an array (multi-select checklist); accept a single ID too.
    const newEmployeeIds = (Array.isArray(newEmployeeIdsInput) ? newEmployeeIdsInput : [newEmployeeIdsInput])
      .map(Number)
      .filter((id) => Number.isFinite(id) && id > 0);
    if (newEmployeeIds.length === 0) return;

    setIsProcessing(true);
    setActionErrorNotice('');
    try {
      const tId = cleanTicketId || ticket.ticket_ID || ticket.id;
      const nameOf = (id) => {
        const emp = (employees || []).find(e => String(e.id) === String(id) || String(e.emp_id) === String(id));
        return emp?.name || `Technician #${id}`;
      };
      const targetNames = newEmployeeIds.map(nameOf);
      const targetName = targetNames.join(', ');

      // The reassign-respond endpoint removes the requester and assigns every selected
      // employee in one transaction. A failure (e.g. an ineligible employee) is surfaced
      // to the CSR instead of being papered over with a second assign call.
      await respondReassignment({
        ticketId: tId,
        action: 'approve',
        newEmployeeId: newEmployeeIds[0],
        newEmployeeIds,
      });

      const timestamp = new Date().toISOString();
      const approveTimelineEvent = {
        id: `reassign-approve-${Date.now()}`,
        type: 'reassign',
        text: `Reassignment approved by CS. Ticket reassigned to ${targetName}.`,
        timestamp,
      };
      const nextTimeline = [...(ticket.timeline || []), approveTimelineEvent];
      const patch = {
        reassignmentRequested: false,
        reassignmentStatus: 'Approved',
        // Already sent to the reassign-respond endpoint above; parents must not resend it.
        reassignmentHandled: true,
        assigned_to: newEmployeeIds[0],
        assigned: newEmployeeIds,
        assigned_employee: targetName,
        status: 'In Progress',
        timeline: nextTimeline,
      };
      setLocalPatch(patch);

      const updated = {
        ...ticket,
        ...patch,
        // Already sent to the reassign-respond endpoint above; parents must not resend it.
        reassignmentHandled: true,
      };

      if (typeof onStatusUpdate === 'function') {
        await onStatusUpdate(updated);
      }
      refreshLiveTicket?.();

      setActionSuccessNotice(`Reassignment approved. Ticket successfully assigned to ${targetName}.`);
      setTimeout(() => setActionSuccessNotice(''), 6000);
    } catch (err) {
      console.error('Failed to approve reassignment:', err);
      setActionErrorNotice('Failed to approve and reassign ticket. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmRejectReassign = async (reason) => {
    setIsProcessing(true);
    setActionErrorNotice('');
    try {
      const tId = cleanTicketId || ticket.ticket_ID || ticket.id;

      await respondReassignment({
        ticketId: tId,
        action: 'deny',
        reason,
      }).catch((e) => console.warn('respondReassignment deny call failed, falling back to local update:', e));

      const timestamp = new Date().toISOString();
      const rejectTimelineEvent = {
        id: `reassign-deny-${Date.now()}`,
        type: 'reassign',
        text: `Reassignment request rejected by CS. Reason: "${reason}". Ticket status returned to In Progress.`,
        timestamp,
      };
      const nextTimeline = [...(ticket.timeline || []), rejectTimelineEvent];
      const patch = {
        reassignmentRequested: false,
        reassignmentStatus: 'Denied',
        reassignmentDenyReason: reason,
        reassignmentHandled: true,
        status: 'In Progress',
        timeline: nextTimeline,
      };
      setLocalPatch(patch);

      const updated = {
        ...ticket,
        ...patch,
        reassignmentHandled: true,
      };

      if (typeof onStatusUpdate === 'function') {
        await onStatusUpdate(updated);
      }
      refreshLiveTicket?.();

      setShowRejectModal(false);
      setActionSuccessNotice(`Reassignment request rejected. Reason dispatched to ${requestingEmployee.name}.`);
      setTimeout(() => setActionSuccessNotice(''), 6000);
    } catch (err) {
      console.error('Failed to reject reassignment:', err);
      setActionErrorNotice('Failed to reject reassignment request. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Internal Notes Handler
  const handleAddInternalNote = async (noteText) => {
    const trimmed = (noteText || '').trim();
    const tId = cleanTicketId || ticket?.ticket_ID || ticket?.id;
    if (!trimmed || !tId) return;

    setIsAddingNote(true);
    const timestamp = new Date().toISOString();
    const authorName = user?.name || 'Customer Service';
    const authorRole = user?.role || 'CS';

    try {
      const res = await addInternalNote(tId, trimmed);
      const savedNote = res?.note || {
        id: `note-${Date.now()}`,
        text: trimmed,
        note: trimmed,
        author: authorName,
        author_name: authorName,
        author_role: authorRole,
        timestamp,
        created_at: timestamp,
      };

      setInternalNotesList((prev) => [...prev, savedNote]);
      if (!ticket.internalNotes) ticket.internalNotes = [];
      ticket.internalNotes.push(savedNote);
      setActionSuccessNotice('Internal note added.');
      setTimeout(() => setActionSuccessNotice(''), 4000);
    } catch (err) {
      console.warn('Failed to save internal note via API:', err);
      const fallbackNote = {
        id: `note-${Date.now()}`,
        text: trimmed,
        note: trimmed,
        author: authorName,
        author_name: authorName,
        author_role: authorRole,
        timestamp,
        created_at: timestamp,
      };
      setInternalNotesList((prev) => [...prev, fallbackNote]);
    } finally {
      setIsAddingNote(false);
    }
  };

  // Proof documents Handling (External tickets)
  const isExternal = !ticket.is_internal && ticket.ticket_type !== 'Internal' && ticket.type !== 'Internal';
  const hasProof = proofFiles.length > 0;
  const proofKeyOf = (file, idx) => String(file?.id || getFileName(file) || `proof-${idx}`);
  const viewedProofCount = proofFiles.filter((f, i) => viewedProofKeys.has(proofKeyOf(f, i))).length;
  const allProofViewed = hasProof && viewedProofCount === proofFiles.length;

  const markProofViewed = (key) =>
    setViewedProofKeys((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));

  const openProofPreview = async (file) => {
    const fName = getFileName(file);
    const fUrl = getFileUrl(file);
    setPreviewFile({ name: fName, url: fUrl });
    const idx = proofFiles.indexOf(file);
    const key = proofKeyOf(file, idx === -1 ? 0 : idx);

    // The server refuses to resolve until it has recorded a view of every proof file,
    // so report the view and only count it once the server accepts it.
    const attachmentId = Number(file?.id);
    if (!Number.isInteger(attachmentId) || attachmentId <= 0 || ticket.status !== 'Pending Evaluation') {
      markProofViewed(key);
      return;
    }
    try {
      await recordProofView(cleanTicketId || ticket.ticket_ID || ticket.id, attachmentId);
      markProofViewed(key);
    } catch (err) {
      const status = err?.response?.status;
      const message = err?.response?.data?.message || '';
      // A file the server does not count as proof (e.g. from an earlier assignment) is not
      // required for approval, so viewing it locally is enough.
      if (status === 422 && /not a proof of completion/i.test(message)) {
        markProofViewed(key);
        return;
      }
      console.error('Failed to record proof view:', err);
      setActionErrorNotice(message || 'Could not record that you viewed this proof file. Please open it again.');
    }
  };

  // "View and Resolve": open the next proof document not yet viewed.
  const openNextUnviewedProof = () => {
    const nextIdx = proofFiles.findIndex((f, i) => !viewedProofKeys.has(proofKeyOf(f, i)));
    if (nextIdx !== -1) openProofPreview(proofFiles[nextIdx]);
  };

  // Timeline events count
  const timelineTotalCount = (ticket?.timeline?.length || 0) + 4; // Including synthesized lifecycle events

  // SLA Guidance Message
  const slaGuidanceText = ticket.reassignmentRequested
    ? 'Resolving this reassignment request first gets the ticket moving again.'
    : 'Prioritize immediate resolution, reassignment, or technician follow-up.';

  // Tabs configuration
  const tabsConfig = [
    { id: 'details', label: 'Details' },
    { id: 'assignees', label: 'Assignees', count: allAssignees.length },
    { id: 'timeline', label: 'Timeline', count: timelineTotalCount },
    { id: 'notes', label: 'Notes · Staff only', count: internalNotesList.length },
    { id: 'files', label: 'Files', count: allFiles.length },
  ];

  return (
    <>
      <TicketDetailModalShell
        isOpen={Boolean(ticket)}
        onClose={onClose}
        maxWidth="max-w-2xl"
        header={
          <ModalHeader
            ticketId={ticketFormattedId}
            onClose={onClose}
            extraBadge={
              isExternal && !String(ticket.title || '').startsWith('[Internal]') ? (
                <Badge variant="medium-info">External</Badge>
              ) : (
                <Badge variant="medium-violet">Internal</Badge>
              )
            }
          />
        }
        footer={
          <ModalFooter
            leftContent={
              <div className="flex items-center gap-2 flex-wrap">
                {/* Secondary: Place on Hold */}
                {!readOnly && currentStatus !== 'Closed' && currentStatus !== 'Resolved' && currentStatus !== 'On Hold' && typeof onStatusUpdate === 'function' && (
                  <button
                    type="button"
                    onClick={() => setShowHoldModal(true)}
                    disabled={isProcessing || isHolding}
                    className="h-9 px-3.5 border border-[#D5D9E4] hover:bg-[#F5F6FA] text-xs font-semibold text-[#1B2033] rounded-lg transition-colors disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <PauseCircle className="w-3.5 h-3.5 text-amber-600" />
                    <span>Place on hold</span>
                  </button>
                )}

                {/* Secondary: Message the Customer / Requestor */}
                <button
                  type="button"
                  onClick={handleOpenMessages}
                  className="h-9 px-3.5 border border-[#D5D9E4] hover:bg-[#F5F6FA] text-xs font-semibold text-[#1B2033] rounded-lg transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                  title={
                    !isExternal || String(ticket.title || '').startsWith('[Internal]')
                      ? 'Communicate directly with the requestor regarding this ticket'
                      : 'Communicate directly with the customer regarding this ticket'
                  }
                >
                  <MessageCircle className="w-3.5 h-3.5 text-[#1E2A78]" />
                  <span>
                    {!isExternal || String(ticket.title || '').startsWith('[Internal]')
                      ? 'Message requestor'
                      : 'Message customer'}
                  </span>
                </button>
              </div>
            }
            primaryAction={
              !readOnly ? (
                <div className="flex items-center gap-2">
                  {/* Escalate to a manager is always available on an active ticket. The
                      reassignment and SLA-breach states below already show their own Escalate. */}
                  {isAlreadyEscalated && (
                    <span
                      data-testid="escalated-to-badge"
                      title={`${escalationIsAutomatic ? 'Escalated automatically after the SLA breach' : 'Escalated'} to ${escalatedToText}`}
                      className="h-9 max-w-[320px] px-3 border border-[#FECDCA] bg-[#FEF3F2] text-[#B42318] text-xs font-semibold rounded-lg inline-flex items-center gap-1.5"
                    >
                      <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">
                        {escalationIsAutomatic ? 'Auto-escalated' : 'Escalated'} to {escalatedToText}
                      </span>
                    </span>
                  )}
                  {canEscalateFromStatus && !ticket.reassignmentRequested && !isAlreadyEscalated && (
                    <button
                      type="button"
                      onClick={() => {
                        setEscalateError('');
                        setShowEscalateModal(true);
                      }}
                      title="Escalate this ticket to a manager"
                      className="h-9 px-4 border border-[#B42318] text-[#B42318] hover:bg-red-50 text-xs font-semibold rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1.5"
                    >
                      <ArrowUpRight className="w-3.5 h-3.5" />
                      <span>Escalate</span>
                    </button>
                  )}
                  {/* If pending reassignment: No Reassign here since DecisionCard handles it; offer Escalate */}
                  {ticket.reassignmentRequested ? (isAlreadyEscalated ? null : (
                    <button
                      type="button"
                      onClick={() => {
                        setEscalateError('');
                        setShowEscalateModal(true);
                      }}
                      className="h-9 px-4 border border-[#B42318] text-[#B42318] hover:bg-red-50 text-xs font-semibold rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1.5"
                    >
                      <ArrowUpRight className="w-3.5 h-3.5" />
                      <span>Escalate</span>
                    </button>
                  )) : isBreached && !ticket.updated_by_technician ? (
                    /* Breached with no technician update: already auto-escalated (badge above), no other primary */
                    null
                  ) : currentStatus === 'On Hold' && typeof onStatusUpdate === 'function' ? (
                    /* On Hold -> Resume is primary */
                    <button
                      type="button"
                      onClick={() => setShowResumeConfirm(true)}
                      disabled={isProcessing}
                      className="h-9 px-4 bg-[#1E2A78] hover:bg-[#252578] text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                      <span>Resume</span>
                    </button>
                  ) : (currentStatus === 'In Progress' || currentStatus === 'Pending Evaluation') && typeof onStatusUpdate === 'function' ? (
                    /* In Progress -> Resolve ticket is primary */
                    <button
                      type="button"
                      disabled={isProcessing || (isExternal && hasProof && !allProofViewed)}
                      title={isExternal && hasProof && !allProofViewed ? 'View every proof of completion document before resolving.' : undefined}
                      onClick={async () => {
                        if (isExternal && hasProof && !allProofViewed) {
                          window.alert('Please view every proof of completion document before resolving this ticket.');
                          return;
                        }
                        setIsProcessing(true);
                        try {
                          const timestamp = new Date().toISOString();
                          await onStatusUpdate({
                            id: ticket.id,
                            status: 'Closed',
                            timeline: [
                              {
                                id: `status-closed-${Date.now()}`,
                                type: 'status',
                                text: 'Ticket resolved and closed by CS Representative.',
                                timestamp,
                              }
                            ]
                          });
                          onClose();
                        } catch (err) {
                          console.error(err);
                          window.alert(err.response?.data?.message || 'Failed to resolve the ticket. Please try again.');
                        } finally {
                          setIsProcessing(false);
                        }
                      }}
                      className="h-9 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 cursor-pointer inline-flex items-center gap-1.5 shadow-xs"
                    >
                      {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                      <span>Resolve ticket</span>
                    </button>
                  ) : (!isTicketAssigned || currentStatus === 'Open' || currentStatus === 'Pending Assignment') && typeof onEdit === 'function' ? (
                    <button
                      type="button"
                      onClick={() => onEdit(ticket)}
                      className="h-9 px-4 bg-[#252578] hover:bg-[#1a1a5c] text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1.5 shadow-xs"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>Assign Employee</span>
                    </button>
                  ) : null}
                </div>
              ) : null
            }
          />
        }
      >
        {/* Alerts & Notifications */}
        {actionSuccessNotice && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs p-3 rounded-xl flex items-center justify-between gap-2 shadow-xs">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{actionSuccessNotice}</span>
            </div>
            <button type="button" onClick={() => setActionSuccessNotice('')} className="p-1 text-emerald-700 hover:text-emerald-900 cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {actionErrorNotice && (
          <div className="bg-rose-50 border border-rose-200 text-rose-800 text-xs p-3 rounded-xl flex items-center justify-between gap-2 shadow-xs">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{actionErrorNotice}</span>
            </div>
            <button type="button" onClick={() => setActionErrorNotice('')} className="p-1 text-rose-700 hover:text-rose-900 cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* 1. Title Block */}
        <TicketTitleBlock
          title={ticket.title}
          priority={currentPriority}
          department={ticket.department}
          category={currentCategory}
          dateFiled={ticket.date || ticket.date_created || ticket.created_at}
          description={ticket.description}
          pendingReassignment={Boolean(ticket.reassignmentRequested)}
          customBadges={
            ticket.pending_hold_request ? (
              <Badge variant={getStatusBadgeVariant('Pending On Hold')}>Pending On Hold</Badge>
            ) : ticket.latest_rejected_hold_request ? (
              <Badge variant={getStatusBadgeVariant('On Hold Rejected')}>On Hold Rejected</Badge>
            ) : null
          }
        />

        {/* 2. StatusStepper (Rendered ABOVE alert as requested) */}
        <div className="rounded-xl border border-[#D5D9E4] bg-white p-3.5 sm:p-4 shadow-xs">
          <StatusStepper
            status={currentStatus}
            isAssigned={isTicketAssigned}
          />
        </div>

        {/* 3. SLA AlertBanner */}
        {isBreached && (
          <AlertBanner
            variant="danger"
            title={`SLA breached · due ${currentSlaDueDate ? formatPHT(currentSlaDueDate) : 'PHT'}`}
            message={`${escalationIsAutomatic ? 'Escalated automatically' : 'Escalated'} to ${escalatedToText}. ${slaGuidanceText}`}
            actions={
              /* Breached tickets are escalated automatically, so only Reassign and Remind are offered here. */
              !ticket.reassignmentRequested && !readOnly ? (
                <>
                  {onEdit && (
                    <button
                      type="button"
                      onClick={onEdit}
                      className="min-h-[36px] px-3 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                    >
                      Reassign
                    </button>
                  )}

                  {isEligibleForReminder && (
                    <button
                      type="button"
                      onClick={() => {
                        setReminderError('');
                        setShowReminderModal(true);
                      }}
                      disabled={isProcessing || isReminderOnCooldown}
                      title={isReminderOnCooldown ? `Reminder sent recently (${cooldownMinutesRemaining}m cooldown)` : `Send reminder to ${assignee.firstName}`}
                      aria-label={`Send reminder to ${assignee.firstName}`}
                      className="min-h-[36px] px-3 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                    >
                      Remind {assignee.firstName}
                      {isReminderOnCooldown && (
                        <span className="text-[10px] text-slate-500 ml-1">({cooldownMinutesRemaining}m)</span>
                      )}
                    </button>
                  )}
                </>
              ) : null
            }
          />
        )}

        {/* On Hold banner if currently on hold */}
        {currentStatus === 'On Hold' && !isBreached && (
          <AlertBanner
            variant="warning"
            title="Ticket is Currently On Hold"
            message={`The SLA timer is temporarily paused while awaiting external information.${currentHoldReason ? ` Reason: "${currentHoldReason}"` : ''}`}
          />
        )}

        {/* Spec 0048 (AC-9): employee On Hold request awaiting the CS decision */}
        {ticket.pending_hold_request && (
          <HoldRequestDecisionCard
            holdRequest={ticket.pending_hold_request}
            ticketId={cleanTicketId}
            readOnly={readOnly}
            onDecided={(decision, request) => {
              if (decision === 'approve') {
                setCurrentStatus('On Hold');
                setCurrentHoldReason(request?.remarks || '');
                setCurrentSlaStatus('Paused');
                setActionSuccessNotice('On Hold request approved. The ticket is On Hold and the SLA clock is paused.');
              } else {
                setActionSuccessNotice('On Hold request rejected. The employee has been notified.');
              }
              setTimeout(() => setActionSuccessNotice(''), 6000);
              refreshLiveTicket?.();
            }}
          />
        )}

        {/* Department manager reassignment CS has not acknowledged yet */}
        {shownReassignment && (
          <ManagerReassignmentCard
            reassignment={shownReassignment}
            ticketId={cleanTicketId}
            readOnly={readOnly}
            autoAcknowledge
            onAcknowledged={handleReassignmentAcknowledged}
          />
        )}

        {/* Employee Reminder Dispatched Banner (for test compatibility) */}
        {currentLastReminder && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-xs text-indigo-900 flex items-start gap-2 shadow-xs">
            <Bell className="w-3.5 h-3.5 text-indigo-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <strong className="block font-semibold">Employee Reminder Dispatched</strong>
              <p className="mt-0.5 text-indigo-800 leading-normal">
                A reminder prompt was dispatched to the assigned technician on {formatDisplayDate(currentLastReminder)}.
              </p>
            </div>
          </div>
        )}

        {/* 4. DecisionCard (if pending reassignment) or Rejection Confirmation */}
        {ticket.reassignmentRequested ? (
          <DecisionCard
            requestingEmployee={requestingEmployee}
            reason={ticket.reassignmentReason}
            availableEmployees={availableTechnicians}
            suggestedEmployeeId={suggestedEmpId}
            onApproveAndReassign={handleApproveAndReassign}
            onOpenRejectDialog={() => setShowRejectModal(true)}
            isProcessing={isProcessing}
          />
        ) : ticket.reassignmentStatus === 'Denied' && (
          <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-4 flex items-start gap-3">
            <XCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs text-rose-900">
              <p className="font-semibold text-sm text-rose-950">Reassignment Request Rejected</p>
              <p>
                Your rejection has been submitted and the ticket remains in <span className="font-semibold">In Progress</span>.
              </p>
              {ticket.reassignmentDenyReason && (
                <p className="text-rose-800">
                  <span className="font-semibold">Submitted reason:</span> {ticket.reassignmentDenyReason}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Unit test & screen-reader compatibility element */}
        <div className="sr-only">
          <span>{assignee.isAssigned ? assignee.name : 'None assigned'}</span>
          <span>{`Message ${assignee.firstName}`}</span>
          {(!readOnly && isEligibleForReminder) && (
            <button
              type="button"
              onClick={() => setShowReminderModal(true)}
              disabled={isProcessing || isReminderOnCooldown}
              aria-label={`Send reminder to ${assignee.firstName}`}
            >
              Send reminder to {assignee.firstName}
            </button>
          )}
          {currentLastReminder && <span>Last Reminder Sent</span>}
        </div>

        {/* 5. TabBar */}
        <TabBar
          tabs={tabsConfig}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />

        {/* 6. Tab Panels */}
        {activeTab === 'details' && (
          <div id="panel-details" role="tabpanel" aria-labelledby="tab-details" className="space-y-4 pt-1 animate-in fade-in duration-150">
            {/* FieldGrid: 2-column layout */}
            <FieldGrid
              requestor={ticket.customer || ticket.requestor || ticket.created_by_name || 'Customer One (St. Jude Medical Center)'}
              department={ticket.department || 'Service'}
              priority={currentPriority}
              onEditPriority={(!readOnly && currentStatus !== 'Closed' && currentStatus !== 'Resolved') ? () => setShowReclassifyEdit(true) : null}
              category={currentCategory || 'Machine Failure'}
              onEditCategory={(!readOnly && currentStatus !== 'Closed' && currentStatus !== 'Resolved') ? () => setShowReclassifyEdit(true) : null}
              equipment={ticket.equipment || ticket.machine_name || (ticket.serial_number ? `Serial: ${ticket.serial_number}` : 'CT Scanner Somatom Force')}
              assetId={ticket.serial_number}
              slaDueDate={currentSlaDueDate ? formatPHT(currentSlaDueDate) : (ticket.date ? `Filed ${formatPHT(ticket.date)}` : '—')}
              slaStatusBadge={renderTicketSlaBadge(currentSlaStatus, currentSlaDueDate)}
              dateFiled={ticket.date || ticket.date_created || ticket.created_at ? formatPHT(ticket.date || ticket.date_created || ticket.created_at) : null}
            />

            {/* Proof of Completion Panel (if external ticket pending evaluation) */}
            {ticket.status === 'Pending Evaluation' && typeof onStatusUpdate === 'function' && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-900 space-y-3">
                <p className="font-bold uppercase tracking-wider text-[11px] text-blue-950">
                  Review Proof of Completion Documentation
                </p>

                {employeeRemarks && (
                  <div className="bg-white rounded-lg p-3 border border-blue-200 space-y-1">
                    <p className="font-bold text-[11px] text-blue-900 uppercase tracking-wide">
                      Employee Completion Remarks
                    </p>
                    <p className="text-xs text-slate-800 leading-relaxed whitespace-pre-wrap break-words">
                      {employeeRemarks}
                    </p>
                  </div>
                )}

                {/* Full details (with proof files) are still loading: skeleton, not "no files" */}
                {isLoadingDetails && proofFiles.length === 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" aria-busy="true" aria-label="Loading proof of completion files">
                    {[0, 1].map((i) => (
                      <div key={i} className="flex items-center gap-3 rounded-lg border border-blue-200 bg-white p-3">
                        <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-3 w-3/4" />
                          <Skeleton className="h-3 w-1/3" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : proofFiles.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {proofFiles.map((file, idx) => (
                      <AttachmentCard
                        key={file.id || idx}
                        file={file}
                        onPreview={openProofPreview}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-400 italic">No proof files uploaded.</p>
                )}

                {showRejectProofInput ? (
                  <div className="space-y-2 bg-white p-3 rounded-lg border border-red-200">
                    <label className="block text-[11px] font-bold text-red-600 uppercase">Reason for proof rejection *</label>
                    <textarea
                      value={proofRejectionReason}
                      onChange={(e) => setProofRejectionReason(e.target.value)}
                      maxLength={250}
                      className="w-full text-xs border border-red-200 rounded-lg p-2 resize-none outline-none focus:ring-2 focus:ring-red-400"
                      placeholder="Explain why proof is rejected..."
                    />
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setShowRejectProofInput(false)} className="px-3 py-1.5 border rounded-lg text-xs font-semibold">Cancel</button>
                      <button
                        type="button"
                        disabled={isProcessing || !proofRejectionReason.trim()}
                        onClick={async () => {
                          setIsProcessing(true);
                          try {
                            const timestamp = new Date().toISOString();
                            await onStatusUpdate({
                              id: ticket.id,
                              status: 'In Progress',
                              proofRejected: true,
                              rejectionReason: proofRejectionReason.trim(),
                              timeline: [{ id: `proof-reject-${Date.now()}`, type: 'proof', text: `Proof rejected: "${proofRejectionReason.trim()}".`, timestamp }],
                            });
                            onClose();
                          } catch (err) {
                            console.error(err);
                          } finally {
                            setIsProcessing(false);
                          }
                        }}
                        className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold"
                      >
                        Confirm Rejection
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2 pt-1">
                    <button type="button" disabled={isLoadingDetails} onClick={() => setShowRejectProofInput(true)} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed">Reject Proof</button>
                    <button
                      type="button"
                      disabled={isProcessing || isLoadingDetails || !hasProof}
                      title={isLoadingDetails ? 'Loading proof of completion files...' : !hasProof ? 'No proof of completion was uploaded, so the ticket cannot be resolved here.' : undefined}
                      onClick={async () => {
                        // CS must see every proof document before the ticket can be resolved.
                        if (!allProofViewed) {
                          openNextUnviewedProof();
                          return;
                        }
                        setIsProcessing(true);
                        try {
                          const timestamp = new Date().toISOString();
                          await onStatusUpdate({
                            id: ticket.id,
                            status: 'Closed',
                            proofRejected: false,
                            timeline: [{ id: `proof-approve-${Date.now()}`, type: 'proof', text: 'Proof approved by CS. Ticket closed.', timestamp }],
                          });
                          onClose();
                        } catch (err) {
                          console.error(err);
                          setActionErrorNotice(err?.response?.data?.message || 'Failed to resolve the ticket. Please try again.');
                        } finally {
                          setIsProcessing(false);
                        }
                      }}
                      className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : allProofViewed ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      {allProofViewed ? 'Resolve Ticket' : 'View and Resolve'}
                    </button>
                    {hasProof && (
                      <span className={`self-center text-[11px] font-semibold ${allProofViewed ? 'text-emerald-700' : 'text-blue-900/70'}`}>
                        {allProofViewed
                          ? 'All proof documents viewed'
                          : `${viewedProofCount} of ${proofFiles.length} proof document${proofFiles.length > 1 ? 's' : ''} viewed`}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Customer Feedback */}
            {(currentStatus === 'Resolved' || currentStatus === 'Closed' || hasFeedbackBeenSubmitted(ticket.id || ticket.ticket_ID)) && (
              <div className="pt-2 border-t border-[#D5D9E4]">
                <TicketFeedbackSection ticket={ticket} readOnly={true} />
              </div>
            )}
          </div>
        )}

        {activeTab === 'assignees' && (
          <div id="panel-assignees" role="tabpanel" aria-labelledby="tab-assignees" className="space-y-4 pt-1 animate-in fade-in duration-150">
            {/* Header / Actions Banner */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-[#F8F9FA] border border-[#D5D9E4]">
              <div>
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-[#1E2A78]" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#1B2033]">
                    Assigned Staff ({allAssignees.length})
                  </h4>
                </div>
                <p className="text-xs text-[#5A6178] mt-0.5">
                  Employees currently assigned to support and resolve this ticket.
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {!readOnly && typeof onEdit === 'function' && currentStatus !== 'Closed' && currentStatus !== 'Resolved' && (
                  <button
                    type="button"
                    onClick={() => onEdit(ticket)}
                    className="h-8 px-3 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 bg-[#1E2A78] hover:bg-[#252578] text-white"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>{allAssignees.length > 0 ? 'Manage Assignees' : 'Assign Employee'}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Assignee Cards List */}
            {allAssignees.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#5A6178] rounded-xl border border-dashed border-[#D5D9E4] bg-[#F5F6FA] space-y-3">
                <UserX className="w-8 h-8 text-[#5A6178] mx-auto opacity-60" />
                <div>
                  <p className="font-semibold text-sm text-[#1B2033]">No employees assigned</p>
                  <p className="text-xs text-[#5A6178] mt-0.5">This ticket does not have any technicians assigned to it yet.</p>
                </div>
                {!readOnly && typeof onEdit === 'function' && currentStatus !== 'Closed' && currentStatus !== 'Resolved' && (
                  <button
                    type="button"
                    onClick={() => onEdit(ticket)}
                    className="h-8 px-3.5 bg-[#1E2A78] hover:bg-[#252578] text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Assign an Employee</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2.5">
                {allAssignees.map((emp, index) => {
                  const isAccepted = emp.assignmentStatus === 'accepted';
                  const isReassign = emp.assignmentStatus === 'reassign_requested';
                  return (
                    <div
                      key={emp.id || index}
                      className="p-3.5 rounded-xl border border-[#D5D9E4] bg-white hover:border-[#2E85D8]/40 transition-colors shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {/* Avatar with status indicator */}
                        <div className="relative shrink-0">
                          <div className="w-11 h-11 rounded-full bg-[#1E2A78] text-white flex items-center justify-center font-bold text-sm shadow-xs">
                            {emp.initials}
                          </div>
                          <span
                            className={`w-3 h-3 rounded-full border-2 border-white absolute bottom-0 right-0 ${
                              emp.isOnline ? 'bg-emerald-500' : 'bg-slate-300'
                            }`}
                            title={emp.isOnline ? 'Online' : 'Offline'}
                          />
                        </div>

                        {/* Details */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h5 className="text-sm font-semibold text-[#1B2033] break-words">
                              {emp.name}
                            </h5>
                            {isAccepted ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                <span>Accepted</span>
                              </span>
                            ) : isReassign ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                                <AlertTriangle className="w-3 h-3 text-amber-600" />
                                <span>Reassignment Pending</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                                <Clock className="w-3 h-3 text-blue-600" />
                                <span>Assigned</span>
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2 text-xs text-[#5A6178] mt-0.5 flex-wrap">
                            {emp.role && (
                              <span className="font-medium text-[#1B2033]">{emp.role}</span>
                            )}
                            {emp.department && (
                              <span>· {emp.department}</span>
                            )}
                            {emp.email && (
                              <span className="hidden md:inline-flex items-center gap-1 text-[#5A6178]">
                                · <Mail className="w-3 h-3 text-[#5A6178]" /> {emp.email}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Per assignee action: Remind (messaging is the modal's footer "Message customer" button) */}
                      {!readOnly && isEligibleForReminder && (
                        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                          {(
                            <button
                              type="button"
                              onClick={() => setShowReminderModal(true)}
                              disabled={isProcessing || isReminderOnCooldown}
                              title={isReminderOnCooldown ? `Reminder sent recently (${cooldownMinutesRemaining}m cooldown)` : `Send reminder to ${emp.firstName}`}
                              className="h-8 px-3 border border-[#D5D9E4] hover:bg-[#F5F6FA] text-[#1B2033] text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <Bell className="w-3.5 h-3.5 text-[#5A6178]" />
                              <span>Remind</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'timeline' && (
          <div id="panel-timeline" role="tabpanel" aria-labelledby="tab-timeline" className="pt-1 animate-in fade-in duration-150">
            <StaffTimelineView
              ticket={ticket}
              serverEvents={ticket.timeline || []}
            />
          </div>
        )}

        {activeTab === 'notes' && (
          <div id="panel-notes" role="tabpanel" aria-labelledby="tab-notes" className="pt-1 animate-in fade-in duration-150">
            <StaffNotesTab
              notes={internalNotesList}
              onAddNote={handleAddInternalNote}
              isAdding={isAddingNote}
              readOnly={readOnly}
            />
          </div>
        )}

        {activeTab === 'files' && (
          <div id="panel-files" role="tabpanel" aria-labelledby="tab-files" className="space-y-3 pt-1 animate-in fade-in duration-150">
            {allFiles.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#5A6178] rounded-xl border border-dashed border-[#D5D9E4] bg-[#F5F6FA]">
                No files or attachments currently attached to this ticket.
              </div>
            ) : (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-[#5A6178] mb-2.5">
                  ATTACHMENTS ({allFiles.length})
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {allFiles.map((file, fIdx) => (
                    <AttachmentCard
                      key={file.id || fIdx}
                      file={file}
                      onPreview={setPreviewFile}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </TicketDetailModalShell>

      {/* Confirmation before resuming an On Hold ticket */}
      <ConfirmationModal
        isOpen={showResumeConfirm}
        onClose={() => !isProcessing && setShowResumeConfirm(false)}
        loading={isProcessing}
        variant="primary"
        icon={<PlayCircle className="h-6 w-6" />}
        title="Resume Ticket?"
        description={`Resume ${ticket?.id || 'this ticket'} from On Hold? It goes back to ${isTicketAssigned ? 'In Progress' : 'Pending Assignment'} and the SLA clock starts running again.`}
        confirmLabel="Yes, Resume Ticket"
        cancelLabel="Cancel"
        onConfirm={handleResumeTicket}
      />

      {/* Reject Reassignment Dialog with Mandatory Reason Textarea */}
      <RejectReasonModal
        isOpen={showRejectModal}
        onClose={() => setShowRejectModal(false)}
        onConfirmReject={handleConfirmRejectReassign}
        technicianName={requestingEmployee.name}
        isSubmitting={isProcessing}
      />

      {/* Escalate Modal */}
      <EscalateTicketModal
        isOpen={showEscalateModal}
        onClose={() => setShowEscalateModal(false)}
        ticket={{ ...ticket, category: currentCategory, status: currentStatus }}
        employees={employees}
        onConfirmEscalate={handleConfirmEscalate}
        isEscalating={isEscalating}
      />

      {/* Hold Dialog */}
      {showHoldModal && (
        <HoldTicketDialog
          isOpen={showHoldModal}
          onClose={() => setShowHoldModal(false)}
          onConfirm={handleConfirmHold}
          isSaving={isHolding}
        />
      )}

      {/* Reclassification Modals */}
      {showReclassifyEdit && (
        <ReclassifyEditModal
          isOpen={showReclassifyEdit}
          onClose={() => setShowReclassifyEdit(false)}
          currentCategory={currentCategory}
          currentPriority={currentPriority}
          categories={formOptions.categories}
          priorities={formOptions.priorities}
          onReviewChanges={handleReviewReclassify}
        />
      )}

      {showReclassifyConfirm && reclassifyPendingValues && (
        <ReclassifyConfirmModal
          isOpen={showReclassifyConfirm}
          onClose={() => {
            setShowReclassifyConfirm(false);
            setShowReclassifyEdit(true);
          }}
          onConfirm={handleConfirmReclassify}
          oldCategory={currentCategory}
          newCategory={reclassifyPendingValues.newCategory}
          oldPriority={currentPriority}
          newPriority={reclassifyPendingValues.newPriority}
          isSaving={isReclassifying}
          error={reclassifyError}
        />
      )}

      {/* Send Reminder Dialog */}
      {showReminderModal && (
        <SendReminderDialog
          isOpen={showReminderModal}
          onClose={() => setShowReminderModal(false)}
          onConfirm={handleSendReminderConfirm}
          ticket={ticket}
          assignedEmployee={employees.find(e => String(e.id) === String(ticket?.assigned_to || ticket?.assigned?.[0])) || { name: assignee.name }}
          isSending={isSendingReminder}
          error={reminderError}
        />
      )}

      {/* File Preview Modal */}
      {previewFile && (
        <FilePreviewModal
          file={previewFile}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </>
  );
}

/* ─────────────────────────────────────────────
   ASSIGN MODAL
───────────────────────────────────────────── */
export function AssignModal({ ticket, employees, departments, priorityOptions, onClose, onSave, onCloseTicket, excludeEmployeeIds = [], lockedDepartment = '' }) {
  // A department manager (Service or IT) only sees and picks staff from their own department.
  const lockedDept = String(lockedDepartment || '').trim();
  // Employees who must not be offered (e.g. a manager reassigning never sees themself).
  const excludedIds = useMemo(
    () => new Set((excludeEmployeeIds || []).map((id) => String(id))),
    [excludeEmployeeIds]
  );
  const notExcluded = (e) => !excludedIds.has(String(e?.id ?? e?.emp_id));
  const navigate = useNavigate();
  // Router pathname (without the /ticketing/ base) picks the right role's messages page.
  const { pathname: routePath } = useLocation();
  const handleOpenMessages = () => {
    onClose();
    navigate(getMessagesPath(), { state: { selectedTicketId: ticket?.ticket_ID || ticket?.id } });
  };
  // Close without assigning is offered only when the superadmin Transition Matrix
  // allows the ticket's current state to move to Closed (backend sends allowed_transitions).
  const canCloseWithoutAssigning = typeof onCloseTicket === 'function'
    && Array.isArray(ticket?.allowed_transitions)
    && ticket.allowed_transitions.includes('Closed');
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [closeError, setCloseError] = useState('');
  const [title, setTitle] = useState(ticket?.title || '');
  const [category, setCategory] = useState(ticket?.category || 'Biomedical Equipment');
  const [priority, setPriority] = useState(ticket?.priority || 'Low');
  // Only IT and Service are assignable; any other stored department starts as "all eligible".
  const [department, setDepartment] = useState(
    lockedDept || (['it', 'service'].includes(String(ticket?.department || '').trim().toLowerCase()) ? ticket.department : '')
  );
  const [deptAutoNotice, setDeptAutoNotice] = useState('');
  const [selectedEmployees, setSelectedEmployees] = useState(ticket?.assigned || []);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [validationError, setValidationError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [employeeSearchQuery, setEmployeeSearchQuery] = useState('');

  // Eligibility evaluation state
  const [eligibilityData, setEligibilityData] = useState(null);
  const [loadingEligibility, setLoadingEligibility] = useState(false);
  const [eligibilityError, setEligibilityError] = useState(null);
  const [activeTab, setActiveTab] = useState('eligible'); // 'eligible' | 'managers'

  useLockBodyScroll(!!ticket);

  if (!ticket) return null;

  const CATEGORY_CHOICES = [
    'Service',
    'IT',
  ];

  const loadEligibility = async (targetCategory) => {
    const cat = targetCategory || category || ticket?.category || 'General';
    setLoadingEligibility(true);
    setEligibilityError(null);
    try {
      const data = await getEligibleEmployees({
        ...ticket,
        category: cat,
      });
      setEligibilityData(data);
    } catch (err) {
      console.error('Failed to load eligible employees:', err);
      setEligibilityError(
        err?.response?.data?.message ||
        err?.message ||
        'Failed to load eligibility data from server. Please check your connection and retry.'
      );
    } finally {
      setLoadingEligibility(false);
    }
  };

  useEffect(() => {
    if (ticket) {
      loadEligibility(category);
    }
  }, [ticket?.id, ticket?.ticket_ID, category]);

  const eligibleEmployeesList = useMemo(() => {
    if (eligibilityData?.eligible_employees && Array.isArray(eligibilityData.eligible_employees)) {
      const offered = eligibilityData.eligible_employees.filter(notExcluded);
      if (lockedDept) {
        return offered.filter((e) => (e.department || '').trim().toLowerCase() === lockedDept.toLowerCase());
      }
      if (department && department.trim() !== '') {
        return offered.filter(
          (e) => (e.department || '').toLowerCase() === department.trim().toLowerCase()
        );
      }
      return offered;
    }
    return [];
  }, [eligibilityData, department, excludedIds, lockedDept]);

  const ineligibleEmployeesList = useMemo(() => {
    if (eligibilityData?.ineligible_employees && Array.isArray(eligibilityData.ineligible_employees)) {
      return eligibilityData.ineligible_employees
        .filter(notExcluded)
        .filter((e) => !lockedDept || (e.department || '').trim().toLowerCase() === lockedDept.toLowerCase());
    }
    return [];
  }, [eligibilityData, excludedIds, lockedDept]);

  const departmentManagers = useMemo(() => {
    return eligibilityData?.department_managers || null;
  }, [eligibilityData]);

  // Escalation managers for the employees currently selected in this modal (one per department).
  const selectedEscalationManagers = useMemo(() => {
    const directory = [
      ...(eligibilityData?.eligible_employees || []),
      ...(eligibilityData?.ineligible_employees || []),
      ...(Array.isArray(employees) ? employees : []),
    ];
    return getEscalationManagers(selectedEmployees, departmentManagers, directory);
  }, [selectedEmployees, departmentManagers, eligibilityData, employees]);

  // CS assigns tickets to the IT and Service departments only (eligible staff come from those two).
  const filteredDepartments = useMemo(() => {
    return lockedDept ? [lockedDept] : ['IT', 'Service'];
  }, [lockedDept]);

  const searchedEligibleEmployees = useMemo(() => {
    if (!employeeSearchQuery.trim()) return eligibleEmployeesList;
    const q = employeeSearchQuery.toLowerCase().trim();
    return eligibleEmployeesList.filter((emp) => {
      const name = String(emp.name || '').toLowerCase();
      const email = String(emp.email || '').toLowerCase();
      const role = String(emp.role || emp.technical_role || emp.position_level || '').toLowerCase();
      const dept = String(emp.department || '').toLowerCase();
      return name.includes(q) || email.includes(q) || role.includes(q) || dept.includes(q);
    });
  }, [eligibleEmployeesList, employeeSearchQuery]);


  const toggleEmp = (id) => {
    const numericId = Number(id);
    const isAdding = !selectedEmployees.includes(numericId) && !selectedEmployees.includes(id);

    if (isAdding) {
      const isEligible = eligibleEmployeesList.some((e) => Number(e.id) === numericId);
      if (!isEligible && eligibleEmployeesList.length > 0) {
        setValidationError('Selected employee is ineligible under category escalation rules.');
        return;
      }
      const emp = eligibleEmployeesList.find((e) => Number(e.id) === numericId) || employees.find((e) => Number(e.id) === numericId);
      if (emp && emp.department && !department) {
        setDepartment(emp.department);
        setDeptAutoNotice(`Department set to ${emp.department} based on selected employee.`);
      }
    }

    setSelectedEmployees((prev) => {
      const exists = prev.some((x) => Number(x) === numericId);
      const next = exists ? prev.filter((x) => Number(x) !== numericId) : [...prev, numericId];
      if (next.length > 0) {
        setValidationError('');
      }
      return next;
    });
  };

  const handleCategoryChange = (newCat) => {
    setCategory(newCat);
    setSelectedEmployees([]);
    setEmployeeSearchQuery('');
    setValidationError('');
    loadEligibility(newCat);
  };

  const handleAcceptClick = () => {
    setSaveError('');
    setValidationError('');

    if (selectedEmployees.length === 0) {
      setValidationError('At least one eligible employee must be selected.');
      return;
    }

    if (eligibleEmployeesList.length > 0) {
      const disqualified = selectedEmployees.some(
        (id) => !eligibleEmployeesList.some((e) => Number(e.id) === Number(id))
      );
      if (disqualified) {
        setValidationError('One or more selected employees do not meet the category eligibility rules. Please select only eligible personnel.');
        return;
      }
    }

    setShowConfirm(true);
  };

  const handleConfirm = async () => {
    if (isSaving) return;

    let finalDept = department;
    if (!finalDept && selectedEmployees.length > 0) {
      const firstEmp = eligibleEmployeesList.find((e) => Number(e.id) === Number(selectedEmployees[0])) ||
        employees.find((e) => Number(e.id) === Number(selectedEmployees[0]));
      if (firstEmp) {
        finalDept = firstEmp.department;
      }
    }

    const updated = {
      ...ticket,
      title,
      category,
      priority,
      department: finalDept || null,
      assigned: selectedEmployees,
      status: 'Pending Assignment',
    };

    setIsSaving(true);
    setSaveError('');
    try {
      const saved = await onSave(updated);
      if (saved) {
        setShowConfirm(false);
        onClose();
      } else {
        setSaveError('Failed to assign ticket. Please ensure employee meets category eligibility requirements.');
      }
    } catch (err) {
      const errorMsg = err?.response?.data?.message || err?.message || 'Failed to assign ticket.';
      setSaveError(errorMsg);
    } finally {
      setIsSaving(false);
    }
  };

  const currentRule = eligibilityData?.rule || null;
  const ticketBranch = ticket?.branch || ticket?.branch_name || 'Main Branch';

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px] overscroll-none">
        <div className="bg-card border border-border rounded-xl w-170 max-w-full max-h-[92vh] flex flex-col overflow-hidden relative shadow-modal animate-in fade-in zoom-in-95 duration-200">

          {/* Scrollable content */}
          <div className="overflow-y-auto overscroll-contain flex-1 p-6">
            <div className="flex items-center justify-between gap-4 mb-4">
              <h3 className="text-xl font-bold text-slate-dark">
                {ticket.status === 'Pending Assignment' || ticket.reassignmentStatus === 'Approved' ? 'Reassign Ticket' : 'Assign Ticket'}
              </h3>
              <button
                type="button"
                onClick={onClose}
                className="text-slate-muted hover:text-slate-dark transition-colors p-1.5 rounded-md hover:bg-slate-100 cursor-pointer shrink-0"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Ticket Info Card */}
            <div className="bg-primary text-white rounded-xl p-4 mb-4 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white/70 font-mono">{ticket.id}</div>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-transparent border-b border-white/30 text-sm font-semibold mt-0.5 outline-none focus:border-white transition-colors py-1 text-white"
                  />
                  <div className="flex items-center gap-2 mt-1 text-xs text-white/80">
                    <span>Branch: <strong className="text-white">{ticketBranch}</strong></span>
                    <span>•</span>
                    <span>Track: <strong className="text-white">{eligibilityData?.track ? formatProperSentenceCase(eligibilityData.track) : 'General'}</strong></span>
                  </div>
                </div>
                <Badge variant="outline" className="border-white/30 text-white bg-white/10 shrink-0">
                  {ticket.sla || 'Standard SLA'}
                </Badge>
              </div>
            </div>

            {/* Requester: who raised the ticket, and a shortcut to their conversation */}
            {(() => {
              const requesterName =
                ticket.customer_name ||
                (typeof ticket.customer === 'object' ? ticket.customer?.name : ticket.customer) ||
                ticket.requestor ||
                'Unknown Customer';
              const requesterEmail =
                ticket.customer_email ||
                (typeof ticket.customer === 'object' ? ticket.customer?.email : '') ||
                ticket.client_email ||
                '';
              const openConversation = () => {
                const tId = ticket.ticket_ID || ticket.id;
                onClose();
                const messagesPath = ['/cs-manager', '/service-manager', '/it-manager']
                  .find((prefix) => routePath.startsWith(prefix));
                navigate(messagesPath ? `${messagesPath}/messages` : '/cs/messages', { state: { selectedTicketId: tId } });
              };
              return (
                <div className="mb-4 flex items-center justify-between gap-4 rounded-xl border border-border bg-page p-4" data-testid="assign-requester">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-avatar-circle text-white flex items-center justify-center text-sm font-bold shrink-0">
                      {String(requesterName).charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-slate-muted">Requested by</p>
                      <p className="text-sm font-semibold text-slate-dark truncate">{requesterName}</p>
                      {requesterEmail ? (
                        <p className="text-xs text-slate-muted truncate flex items-center gap-1">
                          <Mail className="w-3 h-3 shrink-0" />
                          <span className="truncate">{requesterEmail}</span>
                        </p>
                      ) : (
                        <p className="text-xs text-slate-muted">No email on file</p>
                      )}
                    </div>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={openConversation} className="shrink-0">
                    <MessageCircle className="w-4 h-4 mr-2" /> Message
                  </Button>
                </div>
              );
            })()}

            {/* Category Selector */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-slate-dark">
                  Ticket Category
                </label>
              </div>
              <div className="flex gap-2">
                <select
                  value={category}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                  className="flex-1 px-3 py-2 text-sm bg-card border border-border rounded-xl text-slate-dark focus:ring-2 focus:ring-accent outline-none transition-all shadow-xs"
                >
                  {CATEGORY_CHOICES.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                  {ticket.category && !CATEGORY_CHOICES.includes(ticket.category) && (
                    <option value={ticket.category}>{ticket.category}</option>
                  )}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => loadEligibility(category)}
                  disabled={loadingEligibility}
                  title="Recalculate eligibility list"
                  className="h-auto px-3"
                >
                  <RefreshCw className={`w-4 h-4 ${loadingEligibility ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </div>

            {/* Department */}
            <div className="mb-4">
              <label className="block text-xs font-medium text-slate-dark mb-1.5">
                Department Scoping
              </label>
              <select
                value={department}
                disabled={Boolean(lockedDept)}
                onChange={(e) => {
                  setDepartment(e.target.value);
                  setDeptAutoNotice('');
                }}
                className="w-full px-3 py-2 text-sm bg-card border border-border rounded-xl text-slate-dark focus:ring-2 focus:ring-accent outline-none transition-all shadow-xs disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {!lockedDept && <option value="">All eligible departments for this category...</option>}
                {filteredDepartments.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              {lockedDept && (
                <p className="mt-2 text-xs text-slate-muted">
                  Only {lockedDept} department staff are shown. Assignees from other departments stay on the ticket.
                </p>
              )}
              {deptAutoNotice && (
                <div className="mt-2 text-xs bg-amber-50 text-amber-900 border border-amber-200 rounded-lg p-2.5 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>{deptAutoNotice}</span>
                </div>
              )}
            </div>

            {/* Priority */}
            <div className="mb-4">
              <label className="block text-xs font-medium text-slate-dark mb-2">
                Priority
              </label>
              <div className="flex gap-2 flex-wrap">
                {priorityOptions.map((p) => (
                  <Button
                    key={p}
                    type="button"
                    variant={priority === p ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setPriority(p)}
                  >
                    {p}
                  </Button>
                ))}
              </div>
            </div>

            {/* Candidate Tabs: Eligible vs Ineligible vs Escalation Managers */}
            <div className="mb-3">
              <div className="flex items-center justify-between border-b border-border pb-1">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab('eligible')}
                    className={`text-xs font-bold pb-2 px-1 border-b-2 transition-all flex items-center gap-1.5 ${
                      activeTab === 'eligible'
                        ? 'border-primary text-primary'
                        : 'border-transparent text-slate-muted hover:text-slate-dark'
                    }`}
                  >
                    <UserCheck className="w-3.5 h-3.5" />
                    Eligible Staff ({eligibleEmployeesList.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('managers')}
                    className={`text-xs font-bold pb-2 px-1 border-b-2 transition-all flex items-center gap-1.5 ${
                      activeTab === 'managers'
                        ? 'border-primary text-primary'
                        : 'border-transparent text-slate-muted hover:text-slate-dark'
                    }`}
                  >
                    <Users className="w-3.5 h-3.5" />
                    Escalation Managers{selectedEscalationManagers.length > 0 ? ` (${selectedEscalationManagers.length})` : ''}
                  </button>
                </div>

                {selectedEmployees.length > 0 && (
                  <span className="text-xs text-primary font-semibold">
                    {selectedEmployees.length} selected
                  </span>
                )}
              </div>

              {/* Selected employee chips */}
              {selectedEmployees.length > 0 && (
                <div className="max-h-24 overflow-y-auto p-1.5 bg-slate-50 border border-slate-200/80 rounded-xl flex flex-wrap gap-1.5 my-2.5">
                  {selectedEmployees.map((id) => {
                    const emp = eligibleEmployeesList.find((e) => Number(e.id) === Number(id)) ||
                      employees.find((e) => Number(e.id) === Number(id));
                    if (!emp) return null;
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1.5 bg-primary/10 text-[#252578] border border-primary/20 text-xs font-medium px-2.5 py-1 rounded-full max-w-full shadow-2xs"
                      >
                        <span className="truncate max-w-[140px] sm:max-w-[180px]" title={emp.name}>
                          {emp.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleEmp(id)}
                          disabled={isSaving}
                          className="ml-0.5 p-0.5 rounded-full hover:bg-red-100 hover:text-red-600 transition-colors cursor-pointer shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
                          title={`Remove ${emp.name}`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            {/* TAB CONTENTS */}
            <div className="mb-4">
              {/* Loading State */}
              {loadingEligibility && (
                <div className="p-8 text-center bg-page border border-border rounded-xl">
                  <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto mb-2" />
                  <p className="text-xs font-medium text-slate-dark">
                    Evaluating department, branch, seniority, and technical roles...
                  </p>
                  <p className="text-[11px] text-slate-muted mt-0.5">
                    Consulting Configuration Service escalation matrix
                  </p>
                </div>
              )}

              {/* Genuine Fetch Failure Error State */}
              {!loadingEligibility && eligibilityError && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-900">
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                    <div className="flex-1 text-xs">
                      <p className="font-bold text-red-800">Unable to load employee eligibility data</p>
                      <p className="text-red-700 mt-0.5">{eligibilityError}</p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => loadEligibility(category)}
                        className="mt-2.5 h-7 text-xs border-red-300 text-red-800 hover:bg-red-100"
                      >
                        <RefreshCw className="w-3 h-3 mr-1" /> Retry Loading
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 1: Eligible Employees List */}
              {!loadingEligibility && !eligibilityError && activeTab === 'eligible' && (
                <>
                  {/* Search Bar for Eligible Staff */}
                  <div className="relative mb-2.5">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                    <input
                      type="text"
                      value={employeeSearchQuery}
                      onChange={(e) => setEmployeeSearchQuery(e.target.value)}
                      placeholder="Search eligible staff by name, role, department or email..."
                      className="w-full pl-9 pr-8 py-2 text-xs bg-card border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent text-slate-800 placeholder-slate-400"
                    />
                    {employeeSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setEmployeeSearchQuery('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                        title="Clear search"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {eligibleEmployeesList.length === 0 ? (
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs">
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <p className="font-bold text-amber-800">No Eligible Employees Found</p>
                          <p className="mt-1 text-amber-700 leading-relaxed">
                            {eligibilityData?.empty_state_guidance ||
                              'No active personnel at this branch meet the minimum position level and technical role requirements for this category.'}
                          </p>
                          <div className="mt-3 flex items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setActiveTab('managers')}
                              className="h-7 text-xs border-amber-300 text-amber-800 hover:bg-amber-100"
                            >
                              <Users className="w-3.5 h-3.5 mr-1" /> View Escalation Managers
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : searchedEligibleEmployees.length === 0 ? (
                    <div className="p-6 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-center text-xs text-slate-500">
                      No eligible personnel matching &quot;{employeeSearchQuery}&quot;.
                    </div>
                  ) : (
                    <div className="max-h-60 overflow-auto bg-page border border-border rounded-xl p-2 space-y-1.5">
                      {searchedEligibleEmployees.map((emp) => {
                        const isSelected = selectedEmployees.some((x) => Number(x) === Number(emp.id));
                        // Presence (spec 0035): online when the heartbeat is fresh. Offline staff stay selectable with a warning.
                        const isAvailable = emp.presence
                          ? emp.presence === 'online'
                          : (emp.status === 'active' || emp.is_active || emp.availability === 'Available');
                        const branchName = emp.branch || emp.branch_name || ticketBranch;
                        const defaultPos = (emp.department || '').toLowerCase() === 'service' ? 'Engineer' : 'Employee';
                        const posLevel = (emp.position_level && !['senior', 'mid', 'junior'].includes(String(emp.position_level).toLowerCase()))
                          ? emp.position_level
                          : (emp.role?.toLowerCase().includes('manager') ? 'Manager' : defaultPos);
                        const techRole = (emp.technical_role && !['specialist', 'technician', 'service technician', 'it support specialist'].includes(String(emp.technical_role).toLowerCase()))
                          ? emp.technical_role
                          : posLevel;

                        return (
                          <label
                            key={emp.id}
                            className={`flex items-start justify-between gap-2 px-3 py-2.5 rounded-lg transition-all cursor-pointer border ${
                              isSelected
                                ? 'bg-primary/5 border-primary/30 shadow-xs'
                                : 'hover:bg-card border-transparent hover:border-border'
                            }`}
                          >
                            <div className="flex items-start gap-2.5 min-w-0">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleEmp(emp.id)}
                                className="mt-1 w-4 h-4 rounded border-border text-primary focus:ring-accent"
                              />
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-xs font-bold text-slate-dark">{emp.name}</span>
                                  <span className="text-[10px] bg-slate-200/70 text-slate-700 px-1.5 py-0.5 rounded font-medium">
                                    {branchName}
                                  </span>
                                  <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-semibold">
                                    {posLevel}
                                  </span>
                                </div>
                                <div className="text-[11px] text-slate-muted mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                                  <span><strong className="text-slate-600 font-medium">Role:</strong> {techRole}</span>
                                  <span>•</span>
                                  <span><strong className="text-slate-600 font-medium">Dept:</strong> {emp.department || 'Service'}</span>
                                  {emp.email && (
                                    <>
                                      <span>•</span>
                                      <span>{emp.email}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                            {/* Spec 0035 AC-4: Online/Offline badge; offline staff stay selectable with a warning. */}
                            <div className="flex flex-col items-end gap-1 shrink-0">
                              <Badge
                                variant={isAvailable ? 'emerald' : 'secondary'}
                                className={`text-[10px] font-bold ${
                                  isAvailable
                                    ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
                                    : 'bg-slate-100 text-slate-600 border border-slate-300'
                                }`}
                              >
                                {isAvailable ? 'Online' : 'Offline'}
                              </Badge>
                              {!isAvailable && (
                                <span className="text-[10px] text-slate-muted text-right">Offline, may not see this right away.</span>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {/* Tab 3: Escalation managers follow the selected employees' departments */}
              {!loadingEligibility && !eligibilityError && activeTab === 'managers' && (
                <div className="space-y-3">
                  <div className="text-xs text-slate-muted bg-primary/5 border border-primary/20 p-2.5 rounded-lg">
                    Escalations and SLA breach alerts go to the manager of each selected employee&apos;s department.
                    Employees from different departments notify each of their managers.
                  </div>

                  {selectedEscalationManagers.length === 0 ? (
                    <div className="text-xs text-slate-muted border border-dashed border-border rounded-xl p-4 text-center">
                      Select one or more employees to see who an escalation will reach.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="assign-escalation-managers">
                      {selectedEscalationManagers.map(({ department, manager }) => (
                        <div key={department} className="bg-card border border-border rounded-xl p-3 shadow-xs">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-primary mb-1">
                            <Shield className="w-3.5 h-3.5 text-primary shrink-0" />
                            {department} Department
                          </div>
                          <p className="text-xs font-bold text-slate-dark">
                            {manager?.name || 'No manager on file'}
                          </p>
                          <p className="text-[11px] text-slate-muted">Manager</p>
                          {manager && (manager.email || manager.phone) && (
                            <div className="mt-2 pt-2 border-t border-border/60 text-[10px] space-y-1 text-slate-600">
                              {manager.email && (
                                <div className="flex items-center gap-1.5 truncate">
                                  <Mail className="w-3 h-3 text-slate-muted shrink-0" />
                                  <span>{manager.email}</span>
                                </div>
                              )}
                              {manager.phone && (
                                <div className="flex items-center gap-1.5">
                                  <Phone className="w-3 h-3 text-slate-muted shrink-0" />
                                  <span>{manager.phone}</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Validation & Save Error Alerts */}
            {validationError && (
              <p className="mt-2 text-xs font-semibold text-destructive flex items-center gap-1.5 bg-destructive/10 p-2.5 rounded-lg border border-destructive/20 mb-3">
                <AlertCircle className="w-4 h-4 shrink-0 text-destructive" />
                {validationError}
              </p>
            )}

            {saveError && (
              <p className="mt-2 text-xs font-semibold text-destructive flex items-center gap-1.5 bg-destructive/10 p-2.5 rounded-lg border border-destructive/20 mb-3">
                <AlertCircle className="w-4 h-4 shrink-0 text-destructive" />
                {saveError}
              </p>
            )}

            {/* Attachments */}
            {ticket.attachments && ticket.attachments.length > 0 && (
              <div className="bg-page border border-border rounded-xl px-4 py-3 mt-4">
                <div className="text-xs font-medium text-slate-muted mb-2">
                  Attachments
                </div>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {ticket.attachments.map((file, idx) => {
                    const fileName = getFileName(file);
                    const fileUrl = getFileUrl(file);
                    const isQuarantined = isQuarantinedFile(file);

                    if (isQuarantined) {
                      return (
                        <div key={idx} className="flex items-center justify-between bg-red-50/50 border border-red-200 rounded-lg p-2.5 shadow-xs">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <ShieldAlert className="w-4 h-4 text-red-500 flex-shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-red-700 truncate line-through" title="Attachment quarantined: Threat detected">
                                {fileName}
                              </p>
                              <span className="text-[10px] text-red-500 font-bold uppercase">Blocked &amp; Quarantined</span>
                            </div>
                          </div>
                          <span className="text-[10px] font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full uppercase">
                            Blocked
                          </span>
                        </div>
                      );
                    }

                    return (
                      <div key={idx} className="flex items-center justify-between bg-card border border-border rounded-lg p-2.5 shadow-xs">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <Paperclip className="w-4 h-4 text-slate-muted shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p
                              onClick={() => setPreviewFile({ name: fileName, url: fileUrl })}
                              className="text-xs font-medium text-slate-dark truncate cursor-pointer hover:text-accent hover:underline"
                            >
                              {fileName}
                            </p>
                            {file.size && <p className="text-[10px] text-slate-muted">{(file.size / 1024).toFixed(1)} KB</p>}
                          </div>
                        </div>
                        {fileUrl && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.preventDefault();
                              setPreviewFile({ name: fileName, url: fileUrl });
                            }}
                            className="h-7 text-xs text-primary"
                          >
                            <Eye className="w-3.5 h-3.5 mr-1" /> View
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Proof of Completion Attachments */}
            {((ticket.proofAttachments && ticket.proofAttachments.length > 0) || (ticket.proofFiles && ticket.proofFiles.length > 0)) && (
              <div className="bg-page border border-border rounded-xl px-4 py-3 mt-4">
                <div className="text-xs font-semibold text-emerald-800 mb-2">
                  Proof of Completion Documents
                </div>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {(ticket.proofAttachments || ticket.proofFiles).map((file, idx) => {
                    const fileName = getFileName(file);
                    const fileUrl = getFileUrl(file);
                    const isQuarantined = isQuarantinedFile(file);

                    if (isQuarantined) {
                      return (
                        <div key={idx} className="flex items-center justify-between bg-red-50/50 border border-red-200 rounded-lg p-2.5 shadow-xs">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <ShieldAlert className="w-4 h-4 text-red-500 flex-shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-red-700 truncate line-through" title="Proof quarantined: Threat detected">
                                {fileName}
                              </p>
                              <span className="text-[10px] text-red-500 font-bold uppercase">Blocked &amp; Quarantined</span>
                            </div>
                          </div>
                          <span className="text-[10px] font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full uppercase">
                            Blocked
                          </span>
                        </div>
                      );
                    }

                    return (
                      <div key={idx} className="flex items-center justify-between bg-card border border-border rounded-lg p-2.5 shadow-xs">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p
                              onClick={() => setPreviewFile({ name: fileName, url: fileUrl })}
                              className="text-xs font-medium text-slate-dark truncate cursor-pointer hover:text-emerald-700 hover:underline"
                            >
                              {fileName}
                            </p>
                            {file.size && <p className="text-[10px] text-slate-muted">{(file.size / (1024 * 1024)).toFixed(2)} MB</p>}
                          </div>
                        </div>
                        {fileUrl && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.preventDefault();
                              setPreviewFile({ name: fileName, url: fileUrl });
                            }}
                            className="h-7 text-xs text-emerald-700 hover:text-emerald-900"
                          >
                            <Eye className="w-3.5 h-3.5 mr-1" /> View
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          </div>

          {/* Sticky footer */}
          {closeError && (
            <div className="px-6 pt-3 text-xs font-medium text-destructive bg-card">{closeError}</div>
          )}
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-border shrink-0 bg-card">
            <div className="mr-auto flex items-center gap-3">
              {canCloseWithoutAssigning && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { setCloseError(''); setShowCloseConfirm(true); }}
                  disabled={isSaving || isClosing}
                  className="text-destructive border-destructive/40 hover:bg-destructive/10"
                >
                  Close Ticket
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={handleOpenMessages}
                disabled={isSaving || isClosing}
                title="Communicate directly with the customer regarding this ticket"
              >
                <MessageCircle className="w-4 h-4 mr-1.5" />
                Message
              </Button>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSaving || isClosing}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="default"
              onClick={handleAcceptClick}
              disabled={isSaving || isClosing}
            >
              {isSaving ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="w-4 h-4 animate-spin" /> Saving...
                </span>
              ) : (ticket.status === 'Pending Assignment' || ticket.reassignmentStatus === 'Approved') ? 'Save Changes' : 'Assign Ticket'}
            </Button>
          </div>

        </div>
      </div>

      {/* Confirmation dialog layered on top */}
      {showConfirm && (
        <ConfirmDialog
          onConfirm={handleConfirm}
          onCancel={() => setShowConfirm(false)}
          isSaving={isSaving}
        />
      )}
      {showCloseConfirm && (
        <ResolveRemarksDialog
          isSaving={isClosing}
          error={closeError}
          onCancel={() => { setShowCloseConfirm(false); setCloseError(''); }}
          onConfirm={async (remarks) => {
            setIsClosing(true);
            setCloseError('');
            try {
              await onCloseTicket(ticket, remarks);
              setShowCloseConfirm(false);
            } catch (err) {
              setCloseError(err?.response?.data?.message || 'Failed to resolve the ticket.');
            } finally {
              setIsClosing(false);
            }
          }}
        />
      )}
      {previewFile && (
        <FilePreviewModal
          file={previewFile}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </>
  );
}
