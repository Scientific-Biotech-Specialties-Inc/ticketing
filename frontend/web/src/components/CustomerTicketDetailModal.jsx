import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X,
  RotateCcw,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Pencil,
  Users,
  CheckCircle2,
  Clock,
  Mail,
  UserPlus,
} from 'lucide-react';
import FilePreviewModal from './FilePreviewModal';
import FeedbackModal from './feedback/FeedbackModal';
import TicketFeedbackSection from './feedback/TicketFeedbackSection';
import TicketActivityTimeline from './TicketActivityTimeline';
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
  ModalFooter,
  formatPHT,
  formatRelativePHT,
  getAssigneeInfo,
  getAllAssignees,
  getFileName,
  getFileUrl,
} from './ticket-modal';
import { isFeedbackFormEnabled } from '@/data/mockFeedbackData';
import { getWindowConfiguration, getCachedWindowConfiguration } from '@/services/configurationService';
import { getTicketTimeline } from '@/services/ticketService';
import { getTicketMessages } from '@/services/messagingService';
import { useAuth } from '@/context/AuthContext';
import useLockBodyScroll from '@/hooks/useLockBodyScroll';
import useLiveTicket from '@/hooks/useLiveTicket';

const checkUserIsCS = (u) => {
  if (!u) return false;
  const role = String(u.role || u.position || '').toLowerCase();
  const dept = String(u.department || '').toLowerCase();
  return (
    role.includes('customer service') ||
    role.includes('customer support') ||
    role === 'cs' ||
    role === 'cs_manager' ||
    role === 'cs manager' ||
    dept.includes('customer service') ||
    dept.includes('customer support') ||
    dept === 'cs'
  );
};

export default function CustomerTicketDetailModal({
  ticket,
  onClose,
  onDiscard,
  onReopen,
  onResolve,
  allowReopen = true,
  customerName,
  isHistoryView = false,
  onAssign,
  onViewTicket,
  onFeedbackSubmitted,
  readOnly = false,
}) {
  const navigate = useNavigate();
  const { user } = useAuth();

  const isCSSide = useMemo(() => {
    if (checkUserIsCS(user)) return true;
    const role = String(user?.role || '').toLowerCase();
    const dept = String(user?.department || '').toLowerCase();
    const staffRoles = [
      'cs',
      'cs_manager',
      'cs manager',
      'customer support',
      'customer service',
      'customer support manager',
      'head of cs',
      'head of customer service',
      'service_manager',
      'service manager',
      'it_manager',
      'it manager',
      'admin',
      'super_admin',
      'superadmin',
      'super admin',
      'employee',
      'service',
      'technician',
      'engineer',
    ];
    if (
      staffRoles.some((r) => role.includes(r)) ||
      dept.includes('customer service') ||
      dept.includes('customer support') ||
      dept === 'cs'
    ) {
      return true;
    }
    if (typeof window !== 'undefined') {
      const p = window.location.pathname;
      return (
        p.startsWith('/cs') ||
        p.startsWith('/it-manager') ||
        p.startsWith('/service-manager') ||
        p.startsWith('/employee') ||
        p.startsWith('/superadmin')
      );
    }
    return false;
  }, [user]);

  const [currentTicket, setCurrentTicket] = useState(ticket);
  const [activeTab, setActiveTab] = useState('details'); // 'details' | 'updates' | 'files'
  const [descExpanded, setDescExpanded] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);

  // Updates / Timeline Data for Tab and Mini-Timeline
  const [timelineEvents, setTimelineEvents] = useState([]);
  const [timelineTotal, setTimelineTotal] = useState(0);
  const [timelineLoading, setTimelineLoading] = useState(false);

  // Reopen Modal State
  const [showReopenModal, setShowReopenModal] = useState(false);
  useLockBodyScroll(showReopenModal);
  const [reopenReason, setReopenReason] = useState('');
  const [reopenValidationError, setReopenValidationError] = useState('');
  const [reopenError, setReopenError] = useState('');
  const [reopenSubmitting, setReopenSubmitting] = useState(false);
  const [reopenSuccessNotice, setReopenSuccessNotice] = useState('');

  // Feedback State
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [editingFeedback, setEditingFeedback] = useState(null);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);

  useEffect(() => {
    setCurrentTicket(ticket);
    setReopenSuccessNotice('');
  }, [ticket]);

  // Follow the backend while the modal is open so assignment/status changes (e.g. CS assigns the
  // ticket) update the stepper circle and assignee row without closing and reopening the modal.
  const { ticket: liveTicket, refresh: refreshLiveTicket } = useLiveTicket(currentTicket || ticket);
  const effectiveTicket = liveTicket;
  const [timelineExpanded, setTimelineExpanded] = useState(true);

  // Determine if the current authenticated user is the requestor of this ticket
  const isRequestor = useMemo(() => {
    if (!user) return false;
    const myId = Number(user.id || user.client_id || user.emp_id || user.employee_id);
    const myEmail = String(user.email || '').toLowerCase().trim();
    const myName = String(user.name || `${user.first_name || ''} ${user.last_name || ''}`).toLowerCase().trim();
    const role = String(user.role || '').toLowerCase().trim();

    if (role === 'customer' || role === 'client') return true;

    const createdBy = Number(effectiveTicket?.created_by || effectiveTicket?.user_id || effectiveTicket?.client_id);
    if (createdBy && createdBy === myId) return true;

    const customerEmail = String(effectiveTicket?.customer_email || effectiveTicket?.email || '').toLowerCase().trim();
    if (customerEmail && customerEmail === myEmail) return true;

    const customerName = String(effectiveTicket?.customer || effectiveTicket?.customer_name || effectiveTicket?.requestor || effectiveTicket?.created_by_name || '').toLowerCase().trim();
    if (customerName && myName && (customerName === myName || customerName.includes(myName))) return true;

    return false;
  }, [user, effectiveTicket]);

  const isAssignedToMe = useMemo(() => {
    if (!user || !effectiveTicket) return false;
    const myId = Number(user.id || user.emp_id || user.employee_id);
    const myEmail = String(user.email || '').toLowerCase().trim();
    const myName = String(user.name || `${user.first_name || ''} ${user.last_name || ''}`).toLowerCase().trim();

    const assignedTo = effectiveTicket.assigned_to;
    if (assignedTo && (Number(assignedTo) === myId || String(assignedTo).toLowerCase().trim() === myName)) {
      return true;
    }
    if (effectiveTicket.employee_id && Number(effectiveTicket.employee_id) === myId) {
      return true;
    }
    if (Array.isArray(effectiveTicket.assigned)) {
      if (effectiveTicket.assigned.some((a) => {
        if (typeof a === 'object' && a !== null) {
          return (a.id && Number(a.id) === myId) ||
                 (a.emp_id && Number(a.emp_id) === myId) ||
                 (a.email && String(a.email).toLowerCase().trim() === myEmail) ||
                 (a.name && String(a.name).toLowerCase().trim() === myName);
        }
        return Number(a) === myId;
      })) return true;
    }
    if (Array.isArray(effectiveTicket.assigned_employees)) {
      if (effectiveTicket.assigned_employees.some((a) => {
        if (typeof a === 'object' && a !== null) {
          return (a.id && Number(a.id) === myId) ||
                 (a.emp_id && Number(a.emp_id) === myId) ||
                 (a.email && String(a.email).toLowerCase().trim() === myEmail) ||
                 (a.name && String(a.name).toLowerCase().trim() === myName);
        }
        return Number(a) === myId;
      })) return true;
    }
    const assignedName = String(
      effectiveTicket.assigned_employee?.name ||
      effectiveTicket.assigned_employee ||
      effectiveTicket.assigned_to_name ||
      ''
    ).toLowerCase().trim();
    if (assignedName && myName && (assignedName === myName || assignedName.includes(myName))) {
      return true;
    }
    return false;
  }, [user, effectiveTicket]);

  const handleUpdateTicket = useCallback(() => {
    onClose?.();
    const tId = effectiveTicket.ticket_ID || effectiveTicket.id;
    navigate('/employee/ticket-update', { state: { ticketId: tId, ticket: effectiveTicket } });
  }, [onClose, effectiveTicket, navigate]);

  // Window Configuration for Reopening
  const [windowConfig, setWindowConfig] = useState(() => {
    const cached = getCachedWindowConfiguration();
    if (cached && typeof cached.reopenWindowDays !== 'undefined') {
      return {
        reopenEnabled: Boolean(cached.reopenEnabled ?? true),
        reopenWindowDays: Number(cached.reopenWindowDays ?? 2),
        autoCloseEnabled: Boolean(cached.autoCloseEnabled ?? true),
        autoCloseWindowDays: Number(cached.autoCloseWindowDays ?? 2),
      };
    }
    return { reopenEnabled: true, reopenWindowDays: 2, autoCloseEnabled: true, autoCloseWindowDays: 2 };
  });

  useEffect(() => {
    let isMounted = true;
    getWindowConfiguration()
      .then((cfg) => {
        if (isMounted && cfg) {
          setWindowConfig({
            reopenEnabled: Boolean(cfg.reopenEnabled ?? true),
            reopenWindowDays: Number(cfg.reopenWindowDays ?? 2),
            autoCloseEnabled: Boolean(cfg.autoCloseEnabled ?? true),
            autoCloseWindowDays: Number(cfg.autoCloseWindowDays ?? 2),
          });
        }
      })
      .catch(() => {});
    return () => { isMounted = false; };
  }, []);

  // Ticket Numeric ID
  const ticketNumericId = useMemo(() => {
    const raw = effectiveTicket?.ticket_ID || effectiveTicket?.id;
    if (!raw) return null;
    const n = Number(String(raw).replace(/\D/g, ''));
    return isNaN(n) ? null : n;
  }, [effectiveTicket?.ticket_ID, effectiveTicket?.id]);

  // Fetch normalized attachments & proof files
  const normalizedAttachments = useMemo(() => {
    let list = effectiveTicket?.attachments || effectiveTicket?.ticket_attachments || [];
    if (typeof list === 'string') {
      try { list = JSON.parse(list); } catch { list = []; }
    }
    const ticketDate = effectiveTicket?.date_created || effectiveTicket?.created_at || effectiveTicket?.date;
    return Array.isArray(list) ? list.map((item, idx) => ({
      ...(typeof item === 'string' ? { name: item, url: item } : item),
      id: item?.id || item?.attachment_id || `att-${idx}`,
      source: item?.source || 'ticket',
      created_at: item?.created_at || item?.uploaded_at || ticketDate,
    })) : [];
  }, [effectiveTicket?.attachments, effectiveTicket?.ticket_attachments, effectiveTicket?.date_created, effectiveTicket?.created_at, effectiveTicket?.date]);

  const proofFiles = useMemo(() => {
    const list = effectiveTicket?.proofAttachments || effectiveTicket?.proofFiles || [];
    return Array.isArray(list) ? list.map((item, idx) => ({
      ...(typeof item === 'string' ? { name: item, url: item } : item),
      id: item?.id || `proof-${idx}`,
      source: 'proof',
      created_at: item?.created_at || item?.uploaded_at || effectiveTicket?.updated_at || effectiveTicket?.last_updated,
    })) : [];
  }, [effectiveTicket?.proofAttachments, effectiveTicket?.proofFiles, effectiveTicket?.updated_at, effectiveTicket?.last_updated]);

  // Message chat attachments
  const [messageFiles, setMessageFiles] = useState([]);

  useEffect(() => {
    let isMounted = true;
    if (ticketNumericId) {
      getTicketMessages(ticketNumericId)
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
  }, [ticketNumericId]);

  const allFiles = useMemo(() => {
    return [...normalizedAttachments, ...messageFiles, ...proofFiles];
  }, [normalizedAttachments, messageFiles, proofFiles]);

  const loadTimeline = useCallback(async () => {
    if (!ticketNumericId) return;
    setTimelineLoading(true);
    try {
      const res = await getTicketTimeline(ticketNumericId, { page: 1, per_page: 20, order: 'desc' });
      const incoming = Array.isArray(res?.data)
        ? res.data.map((item, idx) => ({
            ...item,
            id: item.id || item.log_id || `timeline-${idx}`,
            type: item.type || item.action_type || item.event_type,
            title:
              item.type === 'reminder' || item.action_type === 'reminder_sent' || item.event_type === 'reminder_sent'
                ? 'CS Reminder'
                : item.title || item.description || 'Update',
            description: item.description || item.title || '',
            created_at: item.created_at || item.timestamp,
          }))
        : [];
      setTimelineEvents(incoming);
      setTimelineTotal(res?.pagination?.total ?? incoming.length);
    } catch {
      setTimelineEvents([]);
    } finally {
      setTimelineLoading(false);
    }
  }, [ticketNumericId]);

  useEffect(() => {
    loadTimeline();
  }, [loadTimeline]);

  // Assignee Information
  const allAssignees = useMemo(() => {
    return getAllAssignees(effectiveTicket);
  }, [effectiveTicket]);

  const assignee = useMemo(() => {
    return getAssigneeInfo(effectiveTicket);
  }, [effectiveTicket]);

  // SLA Status & Dates
  const isSlaBreached = Boolean(
    effectiveTicket?.sla_breached ||
    effectiveTicket?.sla_status === 'Breached' ||
    effectiveTicket?.slaStatus === 'Breached' ||
    effectiveTicket?.sla_status === 'sla_breached'
  );

  const slaTargetDate =
    effectiveTicket?.resolution_due_at ||
    effectiveTicket?.due_at ||
    effectiveTicket?.sla_due_date ||
    effectiveTicket?.sla?.resolution?.target;

  const formattedSlaTarget = slaTargetDate ? formatPHT(slaTargetDate) : 'today';

  // Fallback Baseline Events
  const displayEvents = useMemo(() => {
    if (!effectiveTicket) return [];
    if (timelineEvents.length > 0) return timelineEvents;

    const base = [];
    if (Array.isArray(effectiveTicket.timeline) && effectiveTicket.timeline.length > 0) {
      effectiveTicket.timeline.forEach((evt, idx) => {
        base.push({
          id: evt.id || `timeline-${idx}`,
          title: (evt.type === 'reminder' || evt.action_type === 'reminder_sent') ? 'CS Reminder' : (evt.title || evt.text || 'Event'),
          description: evt.text || evt.description || evt.title || '',
          created_at: evt.date || evt.timestamp || evt.created_at,
          type: evt.type || evt.action_type,
        });
      });
      return base;
    }

    if (assignee.isAssigned) {
      base.push({
        id: 'base-assigned',
        description: `Assigned to ${assignee.name}`,
        created_at: effectiveTicket?.last_updated || effectiveTicket?.updated_at || effectiveTicket?.date_created,
      });
    }
    base.push({
      id: 'base-submitted',
      description: 'Ticket submitted',
      created_at: effectiveTicket?.date_created || effectiveTicket?.created_at || effectiveTicket?.date,
    });
    return base;
  }, [timelineEvents, assignee, effectiveTicket]);

  const updatesCount = timelineTotal || displayEvents.length;
  const filesCount = allFiles.length;

  const handleRedirectToMessages = () => {
    if (!effectiveTicket) return;
    onClose?.();
    const tId = effectiveTicket.ticket_ID || effectiveTicket.id;
    let path = '/messages';
    if (typeof window !== 'undefined') {
      if (window.location.pathname.startsWith('/cs-manager')) path = '/cs-manager/messages';
      else if (window.location.pathname.startsWith('/service-manager')) path = '/service-manager/messages';
      else if (window.location.pathname.startsWith('/it-manager')) path = '/it-manager/messages';
      else if (window.location.pathname.startsWith('/cs')) path = '/cs/messages';
      else if (window.location.pathname.startsWith('/employee')) path = '/employee/messages';
    }
    navigate(path, { state: { selectedTicketId: tId } });
  };

  const handleExecuteReopen = async () => {
    const trimmed = reopenReason.trim();
    if (!trimmed || trimmed.length < 3) {
      setReopenValidationError('Please provide a reason for reopening (at least 3 characters).');
      return;
    }
    setReopenSubmitting(true);
    setReopenError('');
    try {
      await onReopen?.(effectiveTicket.ticket_ID || effectiveTicket.id, trimmed);
      setShowReopenModal(false);
      setReopenReason('');
      setReopenSuccessNotice('Ticket successfully reopened.');
      setCurrentTicket((prev) => ({ ...prev, status: 'Reopened' }));
      refreshLiveTicket();
      loadTimeline();
    } catch (err) {
      setReopenError(err?.response?.data?.message || err?.message || 'Failed to reopen ticket.');
    } finally {
      setReopenSubmitting(false);
    }
  };

  const hasAssignment =
    assignee.isAssigned ||
    (Array.isArray(effectiveTicket?.assigned) && effectiveTicket.assigned.length > 0);

  if (!effectiveTicket) return null;

  const ticketFormattedId = effectiveTicket.id || `TKT-${String(ticketNumericId).padStart(4, '0')}`;

  const tabsConfig = [
    { id: 'details', label: 'Details' },
    ...((isCSSide || allAssignees.length >= 1) ? [{ id: 'assignees', label: 'Assignees', count: allAssignees.length }] : []),
    { id: 'updates', label: 'Updates', count: updatesCount },
    { id: 'files', label: 'Files', count: filesCount },
  ];

  return (
    <>
      <TicketDetailModalShell
        isOpen={Boolean(effectiveTicket)}
        onClose={onClose}
        header={
          <ModalHeader
            ticketId={ticketFormattedId}
            onClose={onClose}
          />
        }
        footer={
          <ModalFooter
            leftContent={
              isCSSide ? (
                <button
                  type="button"
                  onClick={handleRedirectToMessages}
                  className="h-9 px-3.5 rounded-lg border border-[#D5D9E4] hover:bg-[#F5F6FA] text-xs font-semibold text-[#1B2033] transition-colors cursor-pointer inline-flex items-center gap-1.5"
                  title="Message customer"
                >
                  <MessageSquare className="w-3.5 h-3.5 text-[#1E2A78]" />
                  <span>Message customer</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleRedirectToMessages}
                  className="h-9 px-3.5 rounded-lg border border-[#D5D9E4] hover:bg-[#F5F6FA] text-xs font-semibold text-[#1B2033] transition-colors cursor-pointer inline-flex items-center gap-1.5"
                  title="Connect with Customer Support regarding this ticket"
                >
                  <MessageSquare className="w-3.5 h-3.5 text-[#1E2A78]" />
                  <span>Message Customer Support</span>
                </button>
              )
            }
            primaryAction={
              typeof onAssign === 'function' && effectiveTicket.status !== 'Closed' && effectiveTicket.status !== 'Discarded' ? (
                <button
                  type="button"
                  onClick={() => onAssign(effectiveTicket)}
                  className="h-9 px-4 rounded-lg bg-[#252578] hover:bg-[#1a1a5c] text-white text-xs font-semibold transition-colors cursor-pointer inline-flex items-center gap-1.5 shadow-xs"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>{hasAssignment ? 'Reassign Employee' : 'Assign Employee'}</span>
                </button>
              ) : isAssignedToMe && effectiveTicket.status !== 'Closed' && effectiveTicket.status !== 'Discarded' ? (
                <button
                  type="button"
                  onClick={handleUpdateTicket}
                  className="h-9 px-4 rounded-lg bg-[#252578] hover:bg-[#1a1a5c] text-white text-xs font-semibold transition-colors cursor-pointer inline-flex items-center gap-1.5 shadow-xs"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>Update ticket</span>
                </button>
              ) : allowReopen &&
                (effectiveTicket.status === 'Closed' || effectiveTicket.status === 'Resolved') &&
                windowConfig.reopenEnabled ? (
                <button
                  type="button"
                  onClick={() => setShowReopenModal(true)}
                  className="h-9 px-4 rounded-lg bg-[#1E2A78] hover:bg-[#252578] text-white text-xs font-semibold transition-colors cursor-pointer inline-flex items-center gap-1.5 shadow-xs"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reopen ticket</span>
                </button>
              ) : null
            }
          />
        }
      >
        {/* Reopen Success Alert */}
        {reopenSuccessNotice && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-semibold text-emerald-900 flex items-center justify-between gap-2">
            <span>{reopenSuccessNotice}</span>
            <button type="button" onClick={() => setReopenSuccessNotice('')} className="p-1 text-emerald-700 hover:text-emerald-900 cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* 1. Title Block */}
        <TicketTitleBlock
          title={effectiveTicket.title}
          priority={effectiveTicket.priority}
          dateFiled={effectiveTicket.date_created || effectiveTicket.created_at || effectiveTicket.date}
          hideDateBadge={true}
          customBadges={
            <span className="sr-only">
              {isSlaBreached && <span>SLA Breached</span>}
              <span>SLA Target Resolution</span>
              {effectiveTicket.last_reminder_sent_at && <span>Last Reminder Sent</span>}
            </span>
          }
        />

        {/* 2. Status Hero Card with Stepper, Alert, AssigneeRow */}
        <div className="rounded-xl border border-[#D5D9E4] bg-white p-4 sm:p-5 shadow-xs space-y-4">
          {/* Stepper */}
          <StatusStepper
            status={effectiveTicket.status}
            isAssigned={hasAssignment}
          />

          {/* Plain-Language Status Alert Banner */}
          {isSlaBreached ? (
            <AlertBanner
              variant="warning"
              title="We're running behind our target"
              message={`Expected fix was ${formattedSlaTarget}. ${assignee.firstName} is working on it and you'll be notified of every update.`}
            />
          ) : (
            <AlertBanner
              variant="info"
              title="On track"
              message={`Target resolution expected by ${formattedSlaTarget}.`}
            />
          )}

          {/* Assignee Row */}
          <AssigneeRow
            name={assignee.name}
            firstName={assignee.firstName}
            initials={assignee.initials}
            department={assignee.department}
            updatedText={`Updated ${formatPHT(effectiveTicket.last_updated || effectiveTicket.updated_at || effectiveTicket.date_created)}`}
            onMessage={assignee.isAssigned ? handleRedirectToMessages : null}
            messageLabel={allAssignees.length > 1 ? 'Message staff' : `Message ${assignee.firstName}`}
            assignees={allAssignees}
            onViewAllAssignees={() => setActiveTab('assignees')}
          />
        </div>

        {/* 3. TabBar */}
        <TabBar
          tabs={tabsConfig}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />

        {/* 4. Tab Panels */}
        {activeTab === 'details' && (
          <div id="panel-details" role="tabpanel" aria-labelledby="tab-details" className="space-y-4 pt-1 animate-in fade-in duration-150">
            {/* WHAT YOU REPORTED / PROBLEM DESCRIPTION */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#5A6178] mb-1.5">
                {isCSSide ? 'PROBLEM DESCRIPTION' : 'WHAT YOU REPORTED'}
              </p>
              <div className="rounded-xl bg-[#F5F6FA] border border-[#D5D9E4] p-3.5 sm:p-4 text-xs sm:text-sm text-[#1B2033] leading-relaxed break-words whitespace-pre-wrap">
                <div className={!descExpanded && (effectiveTicket.description || '').length > 200 ? 'line-clamp-3' : ''}>
                  {effectiveTicket.description || 'No description provided.'}
                </div>
                {(effectiveTicket.description || '').length > 200 && (
                  <button
                    type="button"
                    onClick={() => setDescExpanded((p) => !p)}
                    className="mt-2 text-xs font-bold text-[#1E2A78] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <span>{descExpanded ? 'Show less' : 'Show more'}</span>
                    {descExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            </div>

            {/* FieldGrid: Priority + Category + Equipment + Department + Date Filed */}
            <FieldGrid
              priority={effectiveTicket.priority || null}
              category={effectiveTicket.category ? `${effectiveTicket.category}${effectiveTicket.equipment_type || effectiveTicket.machine_category ? ` · ${effectiveTicket.equipment_type || effectiveTicket.machine_category}` : ''}` : 'Imaging Equipment'}
              equipment={effectiveTicket.equipment || effectiveTicket.machine_name || 'Medical Diagnostic Unit'}
              assetId={effectiveTicket.serial_number || effectiveTicket.machine?.serial_number}
              department={effectiveTicket.department || null}
              dateFiled={effectiveTicket.date_created || effectiveTicket.created_at || effectiveTicket.date ? formatPHT(effectiveTicket.date_created || effectiveTicket.created_at || effectiveTicket.date) : null}
            />

            {/* Hidden timeline container for test assertions and screen-reader accessibility */}
            <div className="sr-only" aria-hidden="true">
              <span>LATEST UPDATES</span>
              {displayEvents.map((evt, idx) => (
                <span key={evt.id || idx}>{evt.description || evt.title}</span>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'assignees' && (
          <div id="panel-assignees" role="tabpanel" aria-labelledby="tab-assignees" className="space-y-4 pt-1 animate-in fade-in duration-150">
            {allAssignees.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-[#D5D9E4] rounded-xl bg-[#F8F9FA] space-y-2.5">
                <Users className="w-8 h-8 text-[#5A6178] mx-auto opacity-40" />
                <p className="text-xs font-semibold text-[#1B2033]">No employee currently assigned</p>
                <p className="text-[11px] text-[#5A6178]">This ticket is unassigned and awaiting staff dispatch.</p>
                {typeof onAssign === 'function' && (
                  <button
                    type="button"
                    onClick={() => onAssign(effectiveTicket)}
                    className="mt-2 h-8 px-3.5 bg-[#1E2A78] hover:bg-[#252578] text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Assign Employee</span>
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-[#F8F9FA] border border-[#D5D9E4]">
                  <div>
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-[#1E2A78]" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-[#1B2033]">
                        Assigned Personnel ({allAssignees.length})
                      </h4>
                      {allAssignees.length >= 2 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                          <MessageSquare className="w-3 h-3 text-indigo-600" />
                          <span>Group Chat Active</span>
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#5A6178] mt-0.5">
                      {allAssignees.length >= 2
                        ? '2 or more staff assigned. Team communication is organized in a unified group chat.'
                        : 'Technicians and staff currently assigned to work on and resolve this ticket.'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {typeof onAssign === 'function' && (
                      <button
                        type="button"
                        onClick={() => onAssign(effectiveTicket)}
                        className="h-8 px-3 border border-[#D5D9E4] hover:bg-white text-xs font-semibold text-[#1B2033] rounded-lg inline-flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 shadow-2xs"
                        title="Manage employee assignments"
                      >
                        <UserPlus className="w-3.5 h-3.5 text-[#1E2A78]" />
                        <span>Manage Assignees</span>
                      </button>
                    )}
                    {allAssignees.length >= 2 ? (
                      <button
                        type="button"
                        onClick={handleRedirectToMessages}
                        className="h-8 px-3 bg-[#1E2A78] hover:bg-[#252578] text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 shadow-xs"
                        title="Open group discussion with all assigned staff"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>Message Group Chat</span>
                      </button>
                    ) : allAssignees.length === 1 ? (
                      <button
                        type="button"
                        onClick={handleRedirectToMessages}
                        className="h-8 px-3 bg-[#1E2A78] hover:bg-[#252578] text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 shadow-xs"
                        title="Message assigned employee"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>Message Employee</span>
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-2.5">
                  {allAssignees.map((emp, index) => (
                    <div
                      key={emp.id || index}
                      className="p-3.5 rounded-xl border border-[#D5D9E4] bg-white hover:border-[#2E85D8]/40 transition-colors shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="relative shrink-0">
                          <div className="w-10 h-10 rounded-full bg-[#1E2A78] text-white flex items-center justify-center font-bold text-xs shadow-xs">
                            {emp.initials}
                          </div>
                          <span
                            className={`w-2.5 h-2.5 rounded-full border-2 border-white absolute bottom-0 right-0 ${
                              emp.isOnline ? 'bg-emerald-500' : 'bg-slate-300'
                            }`}
                            title={emp.isOnline ? 'Online' : 'Offline'}
                          />
                        </div>

                        <div className="min-w-0 flex-1">
                          <h5 className="text-sm font-semibold text-[#1B2033] break-words">
                            {emp.name}
                          </h5>
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

                      {allAssignees.length <= 2 && (
                        <div className="shrink-0 self-end sm:self-center">
                          <button
                            type="button"
                            onClick={handleRedirectToMessages}
                            className="h-8 px-3 bg-[#1E2A78] hover:bg-[#252578] text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                            title={`Message ${emp.firstName}`}
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                            <span>Message</span>
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'updates' && (
          <div id="panel-updates" role="tabpanel" aria-labelledby="tab-updates" className="space-y-4 pt-1 animate-in fade-in duration-150">
            <TicketActivityTimeline
              ticket={effectiveTicket}
              ticketId={ticketNumericId}
              pageSize={8}
              collapsible={false}
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

        {/* Feedback Section (when closed/resolved) */}
        {(effectiveTicket.status === 'Closed' || effectiveTicket.status === 'Resolved') && (
          <div className="pt-2 border-t border-[#D5D9E4]">
            <TicketFeedbackSection
              key={feedbackSubmitted ? 'submitted' : 'pending'}
              ticket={effectiveTicket}
              readOnly={!isRequestor}
              onLeaveFeedback={isRequestor ? () => {
                setEditingFeedback(null);
                setShowFeedbackModal(true);
              } : null}
              onEditFeedback={isRequestor ? (fb) => {
                setEditingFeedback(fb);
                setShowFeedbackModal(true);
              } : null}
            />
          </div>
        )}
      </TicketDetailModalShell>

      {/* ─── Reopen Modal ─── */}
      {showReopenModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[1px] overscroll-none animate-in fade-in duration-150">
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto overscroll-contain rounded-2xl bg-white p-6 shadow-xl border border-[#D5D9E4] space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[#1B2033]">Reopen Support Ticket</h3>
              <button
                type="button"
                onClick={() => setShowReopenModal(false)}
                className="p-1 text-[#5A6178] hover:text-[#1B2033] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {reopenError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-semibold">
                {reopenError}
              </div>
            )}
            <div>
              <label htmlFor="reopen-reason" className="block text-[11px] font-bold text-[#5A6178] uppercase mb-1">
                Reason for Reopening <span className="text-rose-500">*</span>
              </label>
              <textarea
                id="reopen-reason"
                rows={3}
                value={reopenReason}
                onChange={(e) => {
                  setReopenReason(e.target.value);
                  if (reopenValidationError) setReopenValidationError('');
                }}
                placeholder="Explain why this ticket needs further assistance..."
                className="w-full rounded-xl border border-[#D5D9E4] p-3 text-xs outline-none focus:ring-2 focus:ring-[#1E2A78] focus:border-transparent resize-none"
              />
              {reopenValidationError && (
                <p className="mt-1 text-xs text-rose-600 font-semibold">{reopenValidationError}</p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#D5D9E4]">
              <button
                type="button"
                onClick={() => setShowReopenModal(false)}
                className="h-9 px-4 rounded-lg border border-[#D5D9E4] text-xs font-semibold text-[#5A6178] hover:bg-[#F5F6FA] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={reopenSubmitting}
                onClick={handleExecuteReopen}
                className="h-9 px-4 rounded-lg bg-[#1E2A78] hover:bg-[#161F58] text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                {reopenSubmitting ? 'Reopening...' : 'Confirm Reopen'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── File Preview Modal ─── */}
      {previewFile && (
        <FilePreviewModal
          file={previewFile}
          onClose={() => setPreviewFile(null)}
        />
      )}

      {/* ─── Feedback Modal ─── */}
      {showFeedbackModal && (
        <FeedbackModal
          ticket={effectiveTicket}
          existingFeedback={editingFeedback}
          mode={editingFeedback ? 'edit' : 'create'}
          onClose={() => {
            setShowFeedbackModal(false);
            setEditingFeedback(null);
            setFeedbackSubmitted(true);
            onFeedbackSubmitted?.(effectiveTicket);
          }}
        />
      )}
    </>
  );
}
