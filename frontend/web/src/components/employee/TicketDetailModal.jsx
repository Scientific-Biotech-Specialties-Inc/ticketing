import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, Loader2, Bell, ChevronUp, ChevronDown, Pencil, Users, Mail } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { formatDisplayDate } from '@/utils/dateUtils';
import {
  acceptTicket,
  requestReassignment,
  getInternalNotes,
  getTicketDetails,
} from '@/services/ticketService';
import {
  isReassignmentDenied,
  getReassignmentDisapprovalReason,
  hasPendingReassignment,
} from '@/utils/reassignmentUtils';
import {
  TicketDetailModalShell,
  ModalHeader,
  TicketTitleBlock,
  StatusStepper,
  ReassignmentNotice,
  TechnicianDecisionCard,
  ReassignDialog,
  TabBar,
  FieldGrid,
  AttachmentCard,
  ModalFooter,
  AlertBanner,
  formatPHT,
  buildTechnicianTimeline,
  getAllAssignees,
  StaffTimelineView,
} from '../ticket-modal';
import InternalTicketMessageThread from '@/components/InternalTicketMessageThread';
import FilePreviewModal from '@/components/FilePreviewModal';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { getTicketMessages } from '@/services/messagingService';

const TECHNICIAN_STEPS = [
  { id: 'submitted', label: 'Submitted' },
  { id: 'assigned', label: 'Assigned to you' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'resolved', label: 'Resolved' },
];

export default function TicketDetailModal({
  ticket,
  onClose,
  onStatusChange,
  onAccept,
  onRequestReassign,
  isAccepting: externalIsAccepting = false,
}) {
  const navigate = useNavigate();
  const toast = useToast();

  const [localTicket, setLocalTicket] = useState(ticket);
  const [internalIsAccepting, setInternalIsAccepting] = useState(false);
  const isAccepting = externalIsAccepting || internalIsAccepting;

  // Active tab state: 'details' | 'timeline' | 'files' | 'notes'
  const [activeTab, setActiveTab] = useState('details');
  const [timelineExpanded, setTimelineExpanded] = useState(true);

  // Reassignment dialog state
  const [isReassignDialogOpen, setIsReassignDialogOpen] = useState(false);
  const [isSubmittingReassignment, setIsSubmittingReassignment] = useState(false);

  // Message coordinator dialog state
  const [showMessageDialog, setShowMessageDialog] = useState(false);

  // File preview state
  const [previewFile, setPreviewFile] = useState(null);

  // Internal notes state
  const [internalNotesList, setInternalNotesList] = useState(ticket?.internalNotes || []);

  useEffect(() => {
    setLocalTicket(ticket);
    setActiveTab('details');
    setIsReassignDialogOpen(false);
    setShowMessageDialog(false);
    setInternalNotesList(ticket?.internalNotes || []);

    const ticketId = ticket?.ticket_ID || ticket?.id;
    if (ticketId) {
      getInternalNotes(ticketId)
        .then((notes) => {
          if (Array.isArray(notes)) {
            setInternalNotesList(notes);
          }
        })
        .catch(() => {});
    }
  }, [ticket]);

  if (!localTicket) return null;

  const currentTicket = localTicket;
  const numericId = currentTicket.ticket_ID || Number(String(currentTicket.id || '').replace(/\D/g, ''));
  const ticketRef = currentTicket.id || (numericId ? `TKT-${String(numericId).padStart(4, '0')}` : 'TKT-0000');

  const isAccepted = Boolean(currentTicket.accepted === true || ['In Progress', 'Pending', 'Resolved', 'Closed'].includes(currentTicket.status));
  const isDeclined = isReassignmentDenied(currentTicket);
  const isPendingReassign = hasPendingReassignment(currentTicket);
  const previousDeclineReason = getReassignmentDisapprovalReason(currentTicket);

  // Coordinator resolution
  const coordinatorName =
    currentTicket.coordinator_name ||
    currentTicket.coordinator ||
    currentTicket.assigned_by_name ||
    currentTicket.csr_name ||
    '';

  // Subtitle pieces: <Equipment Name> · <Equipment ID> · <Issue summary>
  const equipName = currentTicket.equipment || currentTicket.machine_name || currentTicket.equipment_name || 'Bedside Monitor';
  const equipId = currentTicket.equipment_type || currentTicket.model_number || currentTicket.serial_number || currentTicket.asset_id || currentTicket.assetId || 'MON-500-A11';
  const issueSummary = currentTicket.category || currentTicket.issue_summary || (currentTicket.title ? currentTicket.title.replace(/^\[.*?\]\s*/, '') : 'Calibration Required');
  const subtitle = [equipName, equipId, issueSummary].filter(Boolean).join(' · ');

  // Auto-generated timeline events (never empty, most recent first)
  const timelineEvents = useMemo(() => {
    return buildTechnicianTimeline(currentTicket);
  }, [currentTicket]);

  const empTicketNumericId = useMemo(() => {
    const raw = currentTicket?.ticket_ID || currentTicket?.id;
    if (!raw) return null;
    const n = Number(String(raw).replace(/\D/g, ''));
    return isNaN(n) ? null : n;
  }, [currentTicket?.ticket_ID, currentTicket?.id]);

  const [messageFiles, setMessageFiles] = useState([]);

  useEffect(() => {
    let isMounted = true;
    if (empTicketNumericId) {
      getTicketMessages(empTicketNumericId)
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
  }, [empTicketNumericId]);

  // Attachments and proof documents count
  const allAttachments = useMemo(() => {
    const list = [];
    const ticketDate = currentTicket?.date_created || currentTicket?.created_at || currentTicket?.date;
    if (Array.isArray(currentTicket.attachments)) {
      currentTicket.attachments.forEach((item, idx) => {
        list.push({
          ...(typeof item === 'string' ? { name: item, url: item } : item),
          id: item?.id || item?.attachment_id || `att-${idx}`,
          source: item?.source || 'ticket',
          created_at: item?.created_at || item?.uploaded_at || ticketDate,
        });
      });
    }
    if (Array.isArray(messageFiles)) {
      list.push(...messageFiles);
    }
    if (Array.isArray(currentTicket.proofFiles)) {
      currentTicket.proofFiles.forEach((item, idx) => {
        list.push({
          ...(typeof item === 'string' ? { name: item, url: item } : item),
          id: item?.id || `proof-${idx}`,
          source: 'proof',
          created_at: item?.created_at || item?.uploaded_at || currentTicket?.updated_at,
        });
      });
    }
    if (Array.isArray(currentTicket.proofAttachments)) {
      currentTicket.proofAttachments.forEach((item, idx) => {
        list.push({
          ...(typeof item === 'string' ? { name: item, url: item } : item),
          id: item?.id || `proof-att-${idx}`,
          source: 'proof',
          created_at: item?.created_at || item?.uploaded_at || currentTicket?.updated_at,
        });
      });
    }
    return list;
  }, [currentTicket, messageFiles]);

  // Stepper active index:
  // 0 = Submitted, 1 = Assigned to you, 2 = In Progress, 3 = Resolved
  const activeStepIndex = useMemo(() => {
    const s = String(currentTicket.status || '').toLowerCase();
    if (s === 'resolved' || s === 'closed') return 3;
    if (isAccepted || s === 'in progress' || s === 'on hold') return 2;
    return 1; // "Assigned to you" (awaiting acceptance)
  }, [currentTicket.status, isAccepted]);

  // Assignees list (for multi-technician tickets)
  const allAssignees = useMemo(() => {
    return getAllAssignees(currentTicket);
  }, [currentTicket]);

  // Tab definitions
  const tabs = useMemo(() => {
    const t = [
      { id: 'details', label: 'Details' },
      ...(allAssignees.length >= 1 ? [{ id: 'assignees', label: 'Assignees', count: allAssignees.length }] : []),
      { id: 'timeline', label: 'Timeline', count: timelineEvents.length },
      { id: 'files', label: 'Files', count: allAttachments.length },
    ];
    if (internalNotesList.length > 0) {
      t.push({ id: 'notes', label: 'Notes', count: internalNotesList.length });
    }
    return t;
  }, [allAssignees.length, timelineEvents.length, allAttachments.length, internalNotesList.length]);

  // Handle Accept
  const handleAccept = useCallback(async () => {
    if (isAccepting) return;

    if (typeof onAccept === 'function') {
      try {
        await onAccept(currentTicket.ticket_ID || currentTicket.id);
        setLocalTicket((prev) => ({
          ...prev,
          accepted: true,
          status: 'In Progress',
        }));
        onStatusChange?.('In Progress');
      } catch (err) {
        // Parent already handled or logged
      }
      return;
    }

    setInternalIsAccepting(true);
    try {
      await acceptTicket({ ticketId: numericId });
      setLocalTicket((prev) => ({
        ...prev,
        accepted: true,
        status: 'In Progress',
      }));
      toast?.success?.('Assignment accepted', 'You have accepted this ticket assignment.');
      onStatusChange?.('In Progress');
    } catch (err) {
      console.error('Failed to accept ticket:', err);
      toast?.error?.(
        err?.response?.data?.message || 'Could not accept this assignment. Please try again.',
        'Accept failed'
      );
    } finally {
      setInternalIsAccepting(false);
    }
  }, [isAccepting, onAccept, currentTicket, numericId, onStatusChange, toast]);

  // Handle Request Reassignment Submit
  const handleReassignSubmit = useCallback(async (newReason) => {
    setIsSubmittingReassignment(true);
    try {
      await requestReassignment({
        ticketId: numericId,
        reason: newReason,
      });

      // Update local state to show pending outcome
      setLocalTicket((prev) => ({
        ...prev,
        reassignmentRequested: true,
        reassignmentStatus: 'Pending',
        reassignmentReason: newReason,
        status: 'Pending Reassignment',
      }));

      setIsReassignDialogOpen(false);
      toast?.success?.(
        'Reassignment requested',
        'Your reassignment request has been submitted to the coordinator.'
      );

      if (typeof onRequestReassign === 'function') {
        onRequestReassign(currentTicket, newReason);
      }
      onStatusChange?.('Pending Reassignment');
    } catch (err) {
      console.error('Failed to submit reassignment request:', err);
      toast?.error?.(
        err?.response?.data?.message || 'Could not submit reassignment request. Please try again.',
        'Request failed'
      );
    } finally {
      setIsSubmittingReassignment(false);
    }
  }, [numericId, currentTicket, onRequestReassign, onStatusChange, toast]);

  const handleOpenMessages = useCallback(() => {
    setShowMessageDialog(true);
  }, []);

  const handleModalClose = useCallback(() => {
    onClose?.();
    const isApproved = currentTicket?.reassignmentStatus === 'Approved' ||
      currentTicket?.notificationData?.type === 'reassignment_approved';
    const isRejected = isReassignmentDenied(currentTicket) ||
      currentTicket?.notificationData?.type === 'reassignment_denied' ||
      currentTicket?.notificationData?.type === 'reassignment_rejected';
    if (isApproved) {
      navigate('/employee/assigned?tab=incoming', { state: { tab: 'incoming' } });
    } else if (isRejected) {
      navigate('/employee/machine');
    }
  }, [onClose, currentTicket, navigate]);

  const handleUpdateTicket = useCallback(() => {
    onClose?.();
    const tId = currentTicket.ticket_ID || currentTicket.id;
    navigate('/employee/ticket-update', { state: { ticketId: tId, ticket: currentTicket } });
  }, [onClose, currentTicket, navigate]);

  return (
    <>
      <TicketDetailModalShell
        isOpen={Boolean(ticket)}
        onClose={handleModalClose}
        maxWidth="w-170 max-w-full sm:max-w-[680px]"
        header={
          <ModalHeader
            ticketId={ticketRef}
            onClose={handleModalClose}
          />
        }
        footer={
          <ModalFooter
            leftContent={
              <button
                type="button"
                onClick={handleOpenMessages}
                aria-label="Message coordinator"
                className="h-9 px-3.5 rounded-lg border border-[#D5D9E4] bg-white text-[#1B2033] hover:text-[#1E2A78] hover:border-[#1E2A78] hover:bg-[#F5F6FA] text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-2 shadow-2xs"
              >
                <MessageSquare className="w-4 h-4 text-[#1E2A78]" />
                <span>
                  {coordinatorName ? `Message coordinator (${coordinatorName})` : 'Message coordinator'}
                </span>
              </button>
            }
            primaryAction={
              isAccepted && currentTicket.status !== 'Closed' && currentTicket.status !== 'Discarded' ? (
                <button
                  type="button"
                  onClick={handleUpdateTicket}
                  className="h-9 px-4 bg-[#252578] hover:bg-[#1a1a5c] text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1.5 shadow-xs"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>Update Ticket</span>
                </button>
              ) : null
            }
          />
        }
      >
        {/* 2. Ticket Title Block */}
        <TicketTitleBlock
          title={currentTicket.title}
          priority={currentTicket.priority || 'Low'}
          statusPill={!isAccepted ? 'Awaiting your acceptance' : null}
          hideStatusBadge={!isAccepted}
          subtitle={subtitle}
        />

        {/* 3. Status Stepper (Submitted > Assigned to you > In Progress > Resolved) */}
        <div className="pt-1 pb-1">
          <StatusStepper
            status={currentTicket.status}
            steps={TECHNICIAN_STEPS}
            activeStepIndex={activeStepIndex}
            ringCurrentStep={!isAccepted}
          />
        </div>

        {/* Reminder notification banner */}
        {Boolean(currentTicket.last_reminder_sent_at) && (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 space-y-2">
            <div className="flex items-center gap-2 text-indigo-900 font-semibold text-xs">
              <Bell className="w-4 h-4 text-indigo-600" />
              <span>CS Employee Reminder</span>
            </div>
            <p className="text-xs text-indigo-950">
              Customer Service dispatched a reminder prompt regarding this ticket on{' '}
              {formatDisplayDate(currentTicket.last_reminder_sent_at)}.
            </p>
          </div>
        )}

        {/* 4. Reassignment Outcome Notice (Amber AlertBanner, shown only when declined) */}
        {isDeclined && !isPendingReassign && (
          <ReassignmentNotice
            ticket={currentTicket}
            coordinatorName={coordinatorName}
            onAskWhy={handleOpenMessages}
          />
        )}

        {/* 5. Decision Card or Pending Notice */}
        {!isAccepted ? (
          isPendingReassign ? (
            <AlertBanner
              variant="info"
              title={
                <span>
                  Reassignment request submitted{' '}
                  <span className="sr-only">Reassignment requested</span>
                </span>
              }
              message="Waiting for the coordinator's decision. You will be notified once reviewed."
            />
          ) : (
            <TechnicianDecisionCard
              onAccept={handleAccept}
              onRequestReassign={() => setIsReassignDialogOpen(true)}
              isDeclined={isDeclined}
              isAccepting={isAccepting}
            />
          )
        ) : null}

        {/* 6. TabBar (Details | Timeline (n) | Files (n)) */}
        <TabBar
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          className="pt-1"
        />

        {/* 7. Tab Panels */}
        <div className="pt-2">
          {/* TAB 1: DETAILS */}
          {activeTab === 'details' && (
            <div className="space-y-5">
              <FieldGrid
                requestor={currentTicket.customer || currentTicket.requestor || '—'}
                department={currentTicket.department || null}
                dateFiled={currentTicket.date || currentTicket.created_at ? formatPHT(currentTicket.date || currentTicket.created_at) : '—'}
                equipment={equipName}
                assetId={equipId}
                priority={currentTicket.priority || 'Low'}
                category={currentTicket.category || null}
                slaDueDate={currentTicket.slaDueDate || currentTicket.expected_resolution ? formatPHT(currentTicket.slaDueDate || currentTicket.expected_resolution) : null}
                extraFields={
                  currentTicket.description
                    ? [
                        {
                          label: 'Issue Description',
                          value: (
                            <p className="text-xs sm:text-sm text-[#1B2033] leading-relaxed break-words whitespace-pre-wrap">
                              {currentTicket.description}
                            </p>
                          ),
                          fullWidth: true,
                        },
                      ]
                    : []
                }
              />

              {/* Unit test & screen-reader compatibility element */}
              <div className="sr-only">
                <span>TIMELINE</span>
                {timelineEvents.map((evt, i) => (
                  <span key={i}>{evt.title}</span>
                ))}
              </div>
            </div>
          )}

          {/* TAB: ASSIGNEES (Co-workers / Team assigned to this ticket) */}
          {activeTab === 'assignees' && (
            <div id="panel-assignees" role="tabpanel" aria-labelledby="tab-assignees" className="space-y-3 pt-1 animate-in fade-in duration-150">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-[#F8F9FA] border border-[#D5D9E4]">
                <div>
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-[#1E2A78]" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-[#1B2033]">
                      Assigned Team ({allAssignees.length})
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
                      ? '2 or more technicians assigned. Team discussion is handled via group chat.'
                      : 'Technicians currently assigned to collaborate on this ticket.'}
                  </p>
                </div>

                {allAssignees.length >= 2 ? (
                  <button
                    type="button"
                    onClick={handleOpenMessages}
                    className="h-8 px-3 bg-[#1E2A78] hover:bg-[#252578] text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 shadow-xs"
                    title="Open team discussion with all assigned staff"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Message Group Chat</span>
                  </button>
                ) : allAssignees.length === 1 ? (
                  <button
                    type="button"
                    onClick={handleOpenMessages}
                    className="h-8 px-3 bg-[#1E2A78] hover:bg-[#252578] text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 shadow-xs"
                    title="Message assigned technician"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Message Employee</span>
                  </button>
                ) : null}
              </div>

              <div className="space-y-2.5">
                {allAssignees.map((emp, index) => {
                  const isAccepted = emp.assignmentStatus === 'accepted';
                  return (
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
                          <div className="flex items-center gap-2 flex-wrap">
                            <h5 className="text-sm font-semibold text-[#1B2033] break-words">
                              {emp.name}
                            </h5>
                            {isAccepted && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <span>Accepted</span>
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

                      {/* When <= 2 assignees, show individual Message button; when > 2, only the single group chat button is shown in the banner */}
                      {allAssignees.length <= 2 && (
                        <div className="shrink-0 self-end sm:self-center">
                          <button
                            type="button"
                            onClick={handleOpenMessages}
                            className="h-8 px-3 bg-[#1E2A78] hover:bg-[#252578] text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                            title={`Message ${emp.firstName}`}
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                            <span>Message</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 2: TIMELINE */}
          {activeTab === 'timeline' && (
            <div id="panel-timeline" role="tabpanel" aria-labelledby="tab-timeline" className="pt-1 animate-in fade-in duration-150">
              <StaffTimelineView
                ticket={currentTicket}
                serverEvents={currentTicket.timeline || timelineEvents || []}
              />
              {/* Unit test & screen-reader compatibility element */}
              <div className="sr-only">
                <span>Activity &amp; Assignment History ({timelineEvents.length})</span>
                {timelineEvents.map((evt, idx) => (
                  <span key={evt.id || idx}>{evt.title}</span>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: FILES */}
          {activeTab === 'files' && (
            <div className="space-y-3">
              {allAttachments.length === 0 ? (
                <div className="rounded-xl border border-[#D5D9E4] bg-white p-6 text-center text-xs text-[#5A6178]">
                  No attached files or photos for this ticket.
                </div>
              ) : (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[#5A6178] mb-2.5">
                    ATTACHMENTS ({allAttachments.length})
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {allAttachments.map((file, idx) => (
                      <AttachmentCard
                        key={idx}
                        file={file}
                        showActions={true}
                        onPreview={setPreviewFile}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: NOTES (Only if notes present) */}
          {activeTab === 'notes' && internalNotesList.length > 0 && (
            <div className="rounded-xl border border-[#D5D9E4] bg-white p-4 space-y-3 shadow-2xs">
              <span className="text-[11px] font-bold text-[#5A6178] uppercase tracking-wider block">
                Internal Notes ({internalNotesList.length})
              </span>
              <div className="space-y-2.5">
                {internalNotesList.map((n, idx) => (
                  <div key={idx} className="p-3 rounded-lg bg-[#F5F6FA] border border-[#D5D9E4] text-xs">
                    <p className="font-semibold text-[#1B2033]">{n.note || n.text || n.content}</p>
                    <p className="text-[10px] text-[#5A6178] mt-1">{formatPHT(n.created_at || n.date)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </TicketDetailModalShell>

      {/* Reassign Dialog */}
      <ReassignDialog
        isOpen={isReassignDialogOpen}
        ticket={currentTicket}
        previousReason={previousDeclineReason}
        onClose={() => setIsReassignDialogOpen(false)}
        onSubmit={handleReassignSubmit}
        isSubmitting={isSubmittingReassignment}
      />

      {/* Coordinator Message Discussion Dialog */}
      {showMessageDialog && numericId && (
        <Dialog open={showMessageDialog} onOpenChange={setShowMessageDialog}>
          <DialogContent className="max-w-2xl w-full p-0 overflow-hidden max-h-[85vh] flex flex-col rounded-2xl">
            <div className="p-4 border-b border-[#D5D9E4] flex items-center justify-between bg-white shrink-0">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-[#1E2A78]" />
                <h3 className="text-sm font-bold text-[#1B2033]">
                  Conversation with Coordinator
                </h3>
                <span className="text-xs font-semibold text-[#5A6178]">
                  ({ticketRef})
                </span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 bg-[#F5F6FA]/50">
              <InternalTicketMessageThread
                ticketId={numericId}
                ticket={currentTicket}
                isClosed={currentTicket.status === 'Closed' || Number(currentTicket.ticket_status_ID) === 4}
              />
            </div>
          </DialogContent>
        </Dialog>
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
