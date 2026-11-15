import { parseUTCDate } from '@/utils/dateUtils';
import { safeUrl } from '@/utils/safeUrl';

/**
 * Format date in Asia/Manila (PHT) timezone.
 * Example: "Nov 9, 8:02 PM PHT" or "Nov 9 PHT"
 */
export const formatPHT = (dateStr, { includeTime = true, showTimezone = true } = {}) => {
  const date = parseUTCDate(dateStr);
  if (!date || isNaN(date.getTime())) return '—';

  const opts = {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
  };
  if (includeTime) {
    opts.hour = 'numeric';
    opts.minute = '2-digit';
    opts.hour12 = true;
  }
  const formatted = new Intl.DateTimeFormat('en-US', opts).format(date);
  return showTimezone ? `${formatted} PHT` : formatted;
};

/**
 * Format relative + absolute PHT time.
 * Example: "Updated 2 hrs ago (Nov 9, 9:08 AM PHT)" or "2h ago (Nov 9, 9:08 AM PHT)"
 */
export const formatRelativePHT = (dateStr, { prefix = '' } = {}) => {
  const date = parseUTCDate(dateStr);
  if (!date || isNaN(date.getTime())) return '—';

  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);
  let rel = '';
  if (diffSec < 60) rel = 'Just now';
  else if (diffSec < 3600) rel = `${Math.floor(diffSec / 60)}m ago`;
  else if (diffSec < 86400) rel = `${Math.floor(diffSec / 3600)}h ago`;
  else if (diffSec < 604800) rel = `${Math.floor(diffSec / 86400)}d ago`;
  else rel = formatPHT(dateStr, { includeTime: false });

  const pht = formatPHT(dateStr, { includeTime: true });
  const base = `${rel} (${pht})`;
  return prefix ? `${prefix} ${base}` : base;
};

/**
 * Extract clean filename from string or object
 */
export const getFileName = (file, fallback = 'Attachment') => {
  if (!file) return fallback;
  if (typeof file === 'string') return file.split('/').pop() || fallback;
  return file.name || file.file_name || fallback;
};

/**
 * Resolve normalized safe attachment URL
 */
export const getFileUrl = (file) => {
  if (!file) return '';
  let raw = '';
  if (typeof file === 'string') {
    raw = file;
  } else {
    raw = file.url || file.file_path || file.path || '';
  }
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('blob:') || raw.startsWith('data:')) {
    return safeUrl(raw);
  }
  let clean = raw.replace(/^\/+/, '');
  while (clean.startsWith('storage/')) {
    clean = clean.substring('storage/'.length).replace(/^\/+/, '');
  }
  if (clean.startsWith('api/ticketing/attachment/storage/')) return safeUrl(`/${clean}`);
  if (clean.startsWith('api/ticketing/attachment/')) return safeUrl(`/${clean}`);
  if (clean.startsWith('api/storage/')) return safeUrl(`/api/ticketing/attachment/${clean.substring(4)}`);
  if (clean.startsWith('api/')) return safeUrl(`/${clean}`);
  return safeUrl(`/api/ticketing/attachment/storage/${clean}`);
};

/**
 * Human readable file size
 */
export const formatFileSize = (bytes) => {
  if (!bytes || isNaN(bytes)) return '';
  const b = Number(bytes);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Determine if a file is quarantined/blocked by ClamAV
 */
export const isQuarantinedFile = (file) => {
  if (!file) return false;
  return Boolean(
    file.is_quarantined ||
    file.quarantined ||
    file.virus_detected ||
    file.threat_found ||
    file.status === 'quarantined' ||
    file.status === 'blocked'
  );
};

/**
 * 4-Step Stepper Definition
 */
export const STEPPER_STEPS = [
  { id: 'submitted', label: 'Submitted' },
  { id: 'assigned', label: 'Assigned' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'resolved', label: 'Resolved' },
];

/**
 * Calculate active stepper step index (0 to 3) based on status
 */
export const getStepIndex = (status, isAssigned) => {
  const norm = String(status || '').trim().toLowerCase();
  if (norm === 'resolved' || norm === 'closed') return 3;
  if (norm === 'in progress' || norm === 'on hold' || norm === 'reopened' || norm === 'pending evaluation' || norm === 'escalated') return 2;
  if (norm === 'assigned' || isAssigned) return 1;
  return 0; // Submitted
};

/**
 * Parse all assignee details into a normalized array of employee objects.
 * Handles ticket.assigned_employees (array of objects/ids), ticket.assigned (array of objects/ids),
 * or single string/object properties like ticket.assigned_employee.
 */
export const getAllAssignees = (ticket, employees = []) => {
  if (!ticket) return [];
  const list = [];
  const seenIds = new Set();
  const seenNames = new Set();

  const addAssignee = (raw, idx = 0) => {
    if (!raw) return;
    let id = null;
    let name = '';
    let department = ticket?.department || 'Support Department';
    let role = 'Assigned Technician';
    let email = '';
    let assignmentStatus = 'assigned';
    let isOnline = true;

    if (typeof raw === 'object' && raw !== null) {
      id = raw.id || raw.emp_id || raw.employee_id;
      name = raw.name || raw.full_name || (raw.first_name ? `${raw.first_name} ${raw.last_name || ''}`.trim() : '');
      department = raw.department || raw.dept || department;
      role = raw.role || raw.position || raw.job_title || role;
      email = raw.email || '';
      assignmentStatus = raw.assignment_status || raw.status || 'assigned';
      isOnline = raw.is_online ?? raw.online ?? true;
    } else if (typeof raw === 'string' || typeof raw === 'number') {
      const match = (employees || []).find(
        (e) =>
          String(e.id) === String(raw) ||
          String(e.emp_id) === String(raw) ||
          (typeof raw === 'string' && e.name && e.name.toLowerCase() === raw.toLowerCase())
      );
      if (match) {
        id = match.id || match.emp_id;
        name = match.name || match.full_name || '';
        department = match.department || department;
        role = match.role || match.position || match.job_title || role;
        email = match.email || '';
        isOnline = match.is_online ?? match.online ?? true;
      } else if (typeof raw === 'string' && raw.toLowerCase() !== 'unassigned') {
        name = raw;
      }
    }

    if (!name || name.toLowerCase() === 'unassigned') return;

    // Try to enrich from employees array if info is missing
    if (Array.isArray(employees) && employees.length > 0) {
      const matched = employees.find(
        (e) =>
          (id && (String(e.id) === String(id) || String(e.emp_id) === String(id))) ||
          (name && e.name && e.name.toLowerCase() === name.toLowerCase())
      );
      if (matched) {
        id = id || matched.id || matched.emp_id;
        if (!email && matched.email) email = matched.email;
        if ((department === 'Support Department' || !department) && matched.department) {
          department = matched.department;
        }
        if (role === 'Assigned Technician' && (matched.role || matched.position)) {
          role = matched.role || matched.position;
        }
      }
    }

    const key = id ? `id-${id}` : `name-${name.toLowerCase()}`;
    if (seenIds.has(key) || seenNames.has(name.toLowerCase())) return;
    if (id) seenIds.add(key);
    seenNames.add(name.toLowerCase());

    const firstName = name.split(' ')[0] || 'Staff';
    const initials =
      name
        .split(' ')
        .filter(Boolean)
        .map((p) => p[0])
        .join('')
        .slice(0, 2)
        .toUpperCase() || 'ST';

    list.push({
      id: id || `assignee-${idx}`,
      name,
      firstName,
      initials,
      department,
      role,
      email,
      assignmentStatus,
      isOnline,
    });
  };

  // 1. Check ticket.assigned_employees array
  if (Array.isArray(ticket.assigned_employees) && ticket.assigned_employees.length > 0) {
    ticket.assigned_employees.forEach((emp, i) => addAssignee(emp, i));
  }

  // 2. Check ticket.assigned array
  if (Array.isArray(ticket.assigned) && ticket.assigned.length > 0) {
    ticket.assigned.forEach((emp, i) => addAssignee(emp, i));
  }

  // 3. Check single assignee properties if still empty
  if (list.length === 0) {
    const single =
      ticket.assigned_employee ||
      ticket.assigned_employee_name ||
      ticket.assigned_to_name ||
      ticket.assigned_to;
    if (single) addAssignee(single, 0);
  }

  return list;
};

/**
 * Parse primary assignee details with full backward-compatible interface
 */
export const getAssigneeInfo = (ticket, employees = []) => {
  const all = getAllAssignees(ticket, employees);
  if (all.length > 0) {
    const first = all[0];
    return {
      isAssigned: true,
      name: first.name,
      firstName: first.firstName,
      initials: first.initials,
      department: first.department,
      count: all.length,
      assignees: all,
    };
  }

  return {
    isAssigned: false,
    name: 'Unassigned',
    firstName: 'Support',
    initials: 'CS',
    department: ticket?.department || 'Support Department',
    count: 0,
    assignees: [],
  };
};

/**
 * Auto-generate chronological timeline events for Technician View
 * Never empty; sorted most recent first.
 */
export const buildTechnicianTimeline = (ticket) => {
  if (!ticket) return [];
  const events = [];

  // Check for declined reassignment
  const isDeclined = Boolean(
    ticket.reassignmentDenied ||
    ticket.reassignmentDisapproved ||
    ticket.reassignmentFailed ||
    ticket.deniedReassignment ||
    ticket.reassignmentDenyReason ||
    ticket.disapprovalReason ||
    ticket.reassignment_reject_reason ||
    String(ticket.reassignmentStatus || '').toLowerCase() === 'denied' ||
    String(ticket.reassignmentStatus || '').toLowerCase() === 'rejected' ||
    String(ticket.reassignmentStatus || '').toLowerCase() === 'disapproved'
  );

  const declineReason =
    ticket.reassignmentDenyReason ||
    ticket.disapprovalReason ||
    ticket.reassignmentDisapprovalReason ||
    ticket.reassignmentDenialReason ||
    ticket.reassignment_reject_reason ||
    ticket.denialReason ||
    '';

  if (isDeclined) {
    events.push({
      id: 'evt-declined',
      title: 'Reassignment request declined',
      description: declineReason ? `Reason: "${declineReason}"` : 'No reason given',
      timestamp: ticket.reassignmentDeniedAt || ticket.disapprovedAt || ticket.updated_at || ticket.lastUpdate || ticket.date,
      variant: 'warning',
    });
  }

  // Check for reassignment requested
  const isRequested = Boolean(
    ticket.reassignmentRequested ||
    ticket.reassignmentReason ||
    ticket.reassignment_reason ||
    String(ticket.reassignmentStatus || '').toLowerCase() === 'pending' ||
    ticket.status === 'Pending Reassignment' ||
    isDeclined
  );

  if (isRequested) {
    const reqReason = ticket.reassignmentReason || ticket.reassignment_reason || '';
    events.push({
      id: 'evt-requested',
      title: 'You requested reassignment',
      description: reqReason ? `Reason: "${reqReason}"` : null,
      timestamp: ticket.reassignmentRequestedAt || ticket.updated_at || ticket.date,
      variant: 'info',
    });
  }

  // Assigned to technician (always present in assigned view)
  events.push({
    id: 'evt-assigned',
    title: 'Assigned to you',
    description: null,
    timestamp: ticket.assigned_at || ticket.date || ticket.created_at,
    variant: 'primary',
  });

  // Ticket submitted
  if (ticket.date || ticket.created_at) {
    events.push({
      id: 'evt-submitted',
      title: 'Submitted',
      description: ticket.customer ? `Filed by ${ticket.customer}` : null,
      timestamp: ticket.created_at || ticket.date,
      variant: 'neutral',
    });
  }

  // Merge any explicit ticket.timeline events if present
  if (Array.isArray(ticket.timeline) && ticket.timeline.length > 0) {
    ticket.timeline.forEach((item, idx) => {
      const isReminder = item.type === 'reminder' || item.action_type === 'reminder_sent' || item.event_type === 'reminder_sent';
      const text = String(item.text || item.title || item.description || (isReminder ? 'CS Reminder' : ''));
      const title = isReminder ? 'CS Reminder' : text;
      const desc = isReminder ? (item.text || item.title || item.description || null) : (item.details || null);
      if (title && !events.some((e) => e.title.toLowerCase() === title.toLowerCase())) {
        events.push({
          id: item.id || `raw-${idx}`,
          title: title,
          description: desc,
          timestamp: item.timestamp || item.date || item.created_at || ticket.date,
          variant: isReminder ? 'info' : 'neutral',
        });
      }
    });
  }

  // If reminder timestamp is present on ticket and not yet in events
  if (ticket.last_reminder_sent_at && !events.some((e) => e.title === 'CS Reminder')) {
    events.push({
      id: 'evt-reminder',
      title: 'CS Reminder',
      description: 'Customer Service dispatched a reminder prompt regarding this ticket',
      timestamp: ticket.last_reminder_sent_at,
      variant: 'info',
    });
  }

  // Sort most recent first
  events.sort((a, b) => {
    const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return timeB - timeA;
  });

  return events;
};


