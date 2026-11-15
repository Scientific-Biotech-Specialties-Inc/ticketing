import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { buildXlsx, XLSX_MIME } from './xlsx';

/**
 * Downloads raw CSV spreadsheet file formatted for Microsoft Excel / Google Sheets data analysis.
 */
export function downloadCsv(filename, csvContent) {
  let cleanContent = typeof csvContent === 'string' ? csvContent : String(csvContent || '');
  cleanContent = cleanContent.replace(/^\uFEFF/, '').replace(/^ï»¿/, '').replace(/^Â¯Â»Â¿/, '');

  // Prepend \uFEFF character in a standard UTF-8 string blob
  const blob = new Blob(['\uFEFF' + cleanContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename.endsWith('.csv') ? filename : `${filename}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Direct PDF Download helper: Captures DOM element using html2canvas & jsPDF and downloads .pdf file.
 */
export async function downloadPdfFromElement(elementId, filename = 'Report.pdf') {
  const element = document.getElementById(elementId);
  if (!element) {
    console.error(`Element #${elementId} not found for PDF export.`);
    window.print();
    return;
  }

  try {
    const canvas = await html2canvas(element, {
      scale: 1.5,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      windowWidth: document.documentElement.offsetWidth,
      windowHeight: document.documentElement.offsetHeight,
    });

    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4',
    });

    const imgWidth = 297; // A4 landscape width in mm
    const pageHeight = 210; // A4 landscape height in mm
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let heightLeft = imgHeight;
    let position = 0;

    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft >= 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    pdf.save(filename);
  } catch (err) {
    console.error('Canvas capture failed, generating fallback PDF document:', err);
    generateFallbackPdf(filename);
  }
}

function generateFallbackPdf(filename) {
  const doc = new jsPDF();
  doc.setFontSize(18);
  doc.text('Enterprise Analytics & Performance Report', 14, 20);
  doc.setFontSize(11);
  doc.text(`Generated Date: ${new Date().toLocaleDateString()}`, 14, 30);
  doc.text('Report export generated successfully.', 14, 40);
  doc.save(filename);
}

export function triggerPdfPrint() {
  window.print();
}

// ─── Shared helpers for analytics exports ───────────────────────────────────
// Exports only ever contain figures the server returned. A value that is missing is written as
// "Unavailable" so a shared report can never present an invented number as fact.

const UNAVAILABLE = 'Unavailable';
const EXPORT_HEADERS = ['Section', 'Metric', 'Value', 'Unit', 'Note'];

const isPresent = (v) => v !== null && v !== undefined && v !== '' && !(typeof v === 'number' && Number.isNaN(v));
const val = (v) => (isPresent(v) ? v : UNAVAILABLE);

const csvCell = (value) => {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

function rowsToCsv(headers, rows, metaLines = []) {
  const lines = [...metaLines.map((m) => m.map(csvCell).join(',')), ...(metaLines.length ? [''] : [])];
  lines.push(headers.map(csvCell).join(','));
  rows.forEach((r) => lines.push(r.map(csvCell).join(',')));
  return lines.join('\r\n') + '\r\n';
}

/** Branch dashboard payload: `{ kpis, status_distribution, sla, csat, workload, departments, employee_performance, recurring_issues }`. */
function branchAnalyticsRows(data) {
  const k = data.kpis || {};
  const rows = [];
  const add = (section, metric, value, unit = '', note = '') => rows.push([section, metric, val(value), unit, note]);

  add('Tickets', 'Total tickets', k.total_tickets);
  add('Tickets', 'Resolved tickets', k.resolved_tickets, '', 'Resolved plus closed');
  add('Tickets', 'Open tickets', k.open_tickets);
  add('Tickets', 'In progress tickets', k.in_progress_tickets);
  add('Tickets', 'On hold tickets', k.on_hold_tickets);
  add('Tickets', 'Closed tickets', k.closed_tickets);
  add('Resolution', 'Average resolution time', k.avg_resolution_hours, 'hours');
  add('SLA', 'SLA compliance rate', k.sla_compliance_rate, '%');
  add('SLA', 'Within SLA', k.sla_met_count, 'tickets');
  add('SLA', 'Breached', k.sla_breached_count, 'tickets');
  add('Customer satisfaction', 'Average CSAT', k.csat_score, 'out of 5',
    isPresent(k.csat_score) ? '' : 'Customer feedback service did not return a score');
  add('Customer satisfaction', 'Feedback reviews', k.total_csat_reviews, 'reviews');
  add('Staffing', 'Active employees', k.active_employees_count);

  (data.recurring_issues?.top_categories || []).forEach((c) =>
    add('Recurring issues: categories', c.name, c.count, 'tickets', isPresent(c.percentage) ? `${c.percentage}% of period tickets` : ''));
  (data.recurring_issues?.top_equipment || []).forEach((m) =>
    add('Recurring issues: equipment', m.name, m.count, 'tickets', isPresent(m.percentage) ? `${m.percentage}% of period tickets` : ''));

  const byEmployee = data.workload?.by_employee;
  (byEmployee?.labels || []).forEach((label, i) =>
    add('Employee workload', label, byEmployee.data?.[i], 'open tickets'));

  (data.departments?.departments || data.departments || []).forEach((d) => {
    if (!d || !d.department) return;
    add(`Department: ${d.department}`, 'Tickets handled', d.has_data === false ? 'No data for this period' : d.total_tickets);
    add(`Department: ${d.department}`, 'SLA compliance', d.sla_compliance_rate, '%');
    add(`Department: ${d.department}`, 'Open (within SLA)', d.open_tickets_count, 'tickets');
    add(`Department: ${d.department}`, 'Overdue (breached)', d.overdue_tickets_count, 'tickets');
  });

  return rows;
}

/** Super Admin system dashboard payload after adaptSystemDashboard(). */
function systemAnalyticsRows(data) {
  const rows = [];
  const add = (section, metric, value, unit = '', note = '') => rows.push([section, metric, val(value), unit, note]);
  const u = data.totalUsers || {};
  const kp = data.systemKpis || {};

  add('Users', 'Total users', u.total);
  add('Users', 'Customers', u.customer);
  add('Users', 'Employees', u.employee);
  add('Users', 'Customer service', u.cs);
  add('Users', 'Admins', u.admin);
  add('Users', 'Super admins', u.superAdmin);
  add('Tickets', 'Total tickets', data.totalTickets);
  add('Tickets', 'Active tickets', data.activeEscalated);
  add('Tickets', 'Escalated tickets', data.escalatedTickets);
  add('Tickets', 'SLA breaches', data.slaBreaches);
  add('Tickets', 'Created today', data.ticketsCreatedToday, '', 'Always today, not filtered by period');
  add('System KPIs', 'Overall SLA compliance', kp.overallSlaCompliance, '%');
  add('System KPIs', 'Overall average CSAT', kp.overallAvgCsat, 'out of 5',
    isPresent(kp.overallAvgCsat) ? '' : 'Customer feedback service did not return a score');
  add('System KPIs', 'Overall resolution time', kp.overallResolutionTime, 'hours');

  (data.branchComparison || []).forEach((b) => {
    add(`Branch: ${b.name}`, 'Total tickets', b.totalTickets);
    add(`Branch: ${b.name}`, 'Resolved tickets', b.resolvedTickets);
    add(`Branch: ${b.name}`, 'SLA compliance', b.totalTickets === 0 ? 'No data for this period' : b.slaCompliance, '%');
    add(`Branch: ${b.name}`, 'Average resolution time', b.avgResolutionTime, 'hours');
    add(`Branch: ${b.name}`, 'Average CSAT', b.avgCsat, 'out of 5');
  });

  return rows;
}

/** One entry point for both dashboards. Returns Section / Metric / Value / Unit / Note rows. */
export function buildAnalyticsExportRows(data) {
  if (data?.kpis) return branchAnalyticsRows(data);
  if (data?.systemKpis) return systemAnalyticsRows(data);
  return [['Report', 'Dashboard data', UNAVAILABLE, '', 'No dashboard data was loaded when the export was requested']];
}

/** Predictive payload from `GET /admin-reports/predictive-insights`. */
export function buildPredictiveExportRows(data) {
  const rows = [];
  const add = (section, metric, value, unit = '', note = '') => rows.push([section, metric, val(value), unit, note]);

  if (!data || (!data.volume_forecast && !data.recurring_issues && !data.status)) {
    return [['Forecast', 'Predictive data', UNAVAILABLE, '', 'The forecast was not available when the export was requested']];
  }

  const basis = data.historical_basis || {};
  add('Basis', 'Model', basis.model);
  add('Basis', 'Days of history used', basis.days_used, 'days', 'A forecast is an estimate, not a guarantee');
  if (data.status === 'insufficient_data') {
    add('Basis', 'Status', data.message || 'Not enough history for a reliable forecast', '', `At least ${basis.minimum_days_required ?? 14} days are needed`);
  }

  (data.volume_forecast || []).forEach((d) =>
    add('Projected ticket volume', d.date, d.predicted_volume, 'tickets', `Range ${d.lower_bound ?? '?'} to ${d.upper_bound ?? '?'} (${d.day_of_week || ''})`.trim()));

  const trendNote = (t) => {
    const change = isPresent(t.change_percentage) ? `${Number(t.change_percentage) > 0 ? '+' : ''}${Number(t.change_percentage).toFixed(1)}% vs baseline` : '';
    return [change, isPresent(t.baseline_frequency) ? `baseline ${t.baseline_frequency}` : ''].filter(Boolean).join(', ');
  };
  (data.recurring_issues?.categories || []).forEach((t) =>
    add('Rising categories', t.item_name, t.recent_frequency, 'tickets (recent)', trendNote(t)));
  (data.recurring_issues?.machines || []).forEach((t) =>
    add('Rising equipment', t.item_name, t.recent_frequency, 'tickets (recent)', trendNote(t)));

  return rows;
}

const todayStamp = () => new Date().toISOString().split('T')[0];

const formatPeriodString = (period, dateFrom, dateTo) => {
  if (period === 'Custom Range' && dateFrom && dateTo) {
    return `Custom Range (${dateFrom} to ${dateTo})`;
  }
  if (dateFrom && dateTo && period) {
    return `${period} (${dateFrom} to ${dateTo})`;
  }
  return period || 'All Time';
};

/**
 * Builds dynamic rows and sections for the Operational Analytics export
 * reflecting the active tab, date range, branch, and live metrics.
 */
export function buildDynamicAnalyticsCsv(data, options = {}) {
  const activeTab = options.activeTab || 'overview';
  const branchName = options.branchName || 'Main Branch';
  const periodText = formatPeriodString(options.period, options.dateFrom, options.dateTo);
  const timestampPHT = new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' });

  const reportTitle = activeTab === 'departments'
    ? 'Department Performance & Workload Report'
    : activeTab === 'employees'
    ? 'Technician Workload & Performance Report'
    : activeTab === 'predictive'
    ? 'Predictive Risk & Volume Forecast Report'
    : 'Operational Analytics Report';

  let csv = `${csvCell(reportTitle)}\r\n`;
  csv += `Generated At:,${csvCell(timestampPHT + ' PHT')}\r\n`;
  csv += `Branch Scope:,${csvCell(branchName)}\r\n`;
  csv += `Date Range:,${csvCell(periodText)}\r\n`;
  csv += `Department:,${csvCell(options.department || 'All Departments')}\r\n\r\n`;

  if (activeTab === 'departments') {
    csv += `"1. DEPARTMENT WORKLOAD & PERFORMANCE SUMMARY"\r\n`;
    const headers = ['Department', 'Staff Count', 'Total Tickets Handled', 'Resolved Tickets', 'Open Tickets', 'Overdue / Breached Tickets', 'Avg Resolution Time (hrs)', 'SLA Compliance Rate (%)'];
    csv += headers.map(csvCell).join(',') + '\r\n';

    const depts = data?.departments?.departments || data?.departments || options.analyticsData?.departments?.departments || [];
    let sumStaff = 0, sumTotal = 0, sumResolved = 0, sumOpen = 0, sumOverdue = 0;

    depts.forEach((d) => {
      const name = d.department || d.name || 'Unassigned';
      const staff = Number(d.staff_count ?? d.staffCount ?? 0);
      const total = Number(d.total_tickets ?? d.totalTickets ?? 0);
      const resolved = Number(d.resolved_tickets ?? d.resolvedTickets ?? 0);
      const open = Number(d.open_tickets_count ?? d.openCount ?? 0);
      const overdue = Number(d.overdue_tickets_count ?? d.overdueCount ?? 0);
      const avgRes = isPresent(d.avg_resolution_hours) ? `${Number(d.avg_resolution_hours).toFixed(1)}h` : (d.avgResolutionTime ? `${d.avgResolutionTime}h` : '—');
      const slaRate = isPresent(d.sla_compliance_rate) ? `${Number(d.sla_compliance_rate).toFixed(1)}%` : (d.slaCompliance != null ? `${d.slaCompliance}%` : '—');

      sumStaff += staff;
      sumTotal += total;
      sumResolved += resolved;
      sumOpen += open;
      sumOverdue += overdue;

      csv += [name, staff, total, resolved, open, overdue, avgRes, slaRate].map(csvCell).join(',') + '\r\n';
    });

    if (depts.length > 0) {
      csv += `\r\n`;
      csv += ['SUMMARY TOTALS', sumStaff, sumTotal, sumResolved, sumOpen, sumOverdue, '—', '—'].map(csvCell).join(',') + '\r\n';
    }
    return csv;
  }

  if (activeTab === 'employees') {
    csv += `"1. TECHNICIAN WORKLOAD & PERFORMANCE RECORDS"\r\n`;
    const headers = ['Technician Name', 'Department', 'Role', 'Active Open Tickets', 'Resolved Tickets', 'Total Tickets Handled', 'SLA Compliance Rate (%)', 'Avg Resolution Time (hrs)'];
    csv += headers.map(csvCell).join(',') + '\r\n';

    const emps = data?.employee_performance?.employees || data?.employee_performance?.list || (Array.isArray(data?.employee_performance) ? data.employee_performance : []) || options.analyticsData?.performance?.employees || [];
    let sumActive = 0, sumResolved = 0, sumTotal = 0;

    emps.forEach((emp) => {
      const name = emp.name || `Employee #${emp.id || emp.emp_id}`;
      const dept = emp.department || 'Service';
      const role = emp.role || emp.technical_role || 'Technician';
      const active = Number(emp.active_tickets ?? emp.activeTickets ?? emp.open_tickets ?? 0);
      const resolved = Number(emp.resolved_tickets ?? emp.resolvedTickets ?? 0);
      const total = active + resolved;
      const slaRate = isPresent(emp.sla_compliance_rate) ? `${Number(emp.sla_compliance_rate).toFixed(1)}%` : (isPresent(emp.compliance_rate) ? `${Number(emp.compliance_rate).toFixed(1)}%` : '—');
      const avgRes = isPresent(emp.avg_resolution_hours) ? `${Number(emp.avg_resolution_hours).toFixed(1)}h` : (isPresent(emp.avg_resolution_time) ? `${emp.avg_resolution_time}h` : '—');

      sumActive += active;
      sumResolved += resolved;
      sumTotal += total;

      csv += [name, dept, role, active, resolved, total, slaRate, avgRes].map(csvCell).join(',') + '\r\n';
    });

    if (emps.length > 0) {
      csv += `\r\n`;
      csv += ['PORTFOLIO TOTALS', '—', '—', sumActive, sumResolved, sumTotal, '—', '—'].map(csvCell).join(',') + '\r\n';
    }
    return csv;
  }

  // Default: Overview Tab
  const k = data?.kpis || {};
  csv += `"1. EXECUTIVE OPERATIONAL METRICS & KPIS"\r\n`;
  csv += ['Category', 'Metric Name', 'Current Value', 'Target / Unit', 'Status / Operational Notes'].map(csvCell).join(',') + '\r\n';

  const addMetric = (cat, name, val, unit = '', note = '') => {
    csv += [cat, name, isPresent(val) ? val : 'Unavailable', unit, note].map(csvCell).join(',') + '\r\n';
  };

  addMetric('Ticket Volume', 'Total Tickets Logged', k.total_tickets, 'tickets', 'Overall period volume');
  addMetric('Ticket Volume', 'Resolved Tickets', k.resolved_tickets, 'tickets', 'Resolved and closed tickets');
  addMetric('Ticket Volume', 'Open Backlog', k.open_tickets, 'tickets', 'Currently active pending triage/resolution');
  addMetric('Ticket Volume', 'In Progress Workload', k.in_progress_tickets, 'tickets', 'Under active technician servicing');
  addMetric('Ticket Volume', 'On Hold Tickets', k.on_hold_tickets, 'tickets', 'Awaiting customer or external parts');
  addMetric('Ticket Volume', 'Closed Records', k.closed_tickets, 'tickets', 'Final closed status');
  addMetric('SLA Adherence', 'SLA Compliance Rate', isPresent(k.sla_compliance_rate) ? `${Number(k.sla_compliance_rate).toFixed(1)}%` : 'Unavailable', 'Target ≥ 90%', Number(k.sla_compliance_rate) >= 90 ? 'Compliant' : 'Needs Attention');
  addMetric('SLA Adherence', 'Tickets Within SLA', k.sla_met_count, 'tickets', 'Met resolution deadline');
  addMetric('SLA Adherence', 'Tickets Breached SLA', k.sla_breached_count, 'tickets', 'Exceeded target deadline');
  addMetric('Resolution Speed', 'Average Resolution Time', isPresent(k.avg_resolution_hours) ? `${Number(k.avg_resolution_hours).toFixed(1)}` : 'Unavailable', 'Target ≤ 8.0 hrs', 'Mean time from creation to resolution');
  addMetric('Client Satisfaction', 'Average CSAT Score', isPresent(k.csat_score) ? `${Number(k.csat_score).toFixed(1)} / 5.0` : 'Unavailable', 'Target ≥ 4.5', isPresent(k.csat_score) ? 'Based on verified customer feedback' : 'No survey ratings collected in period');
  addMetric('Client Satisfaction', 'Total Feedback Reviews', k.total_csat_reviews, 'surveys', 'Customer CSAT submissions');
  addMetric('Workforce Capacity', 'Active Service Technicians', k.active_employees_count, 'personnel', 'Available duty technicians');

  csv += `\r\n`;

  // Status breakdown
  const st = data?.status_distribution || {};
  if (Object.keys(st).length > 0) {
    csv += `"2. TICKET STATUS BREAKDOWN"\r\n`;
    csv += ['Status Name', 'Ticket Count'].map(csvCell).join(',') + '\r\n';
    Object.entries(st).forEach(([sName, count]) => {
      csv += [sName, count].map(csvCell).join(',') + '\r\n';
    });
    csv += `\r\n`;
  }

  // Recurring categories
  const categories = data?.recurring_issues?.top_categories || [];
  if (categories.length > 0) {
    csv += `"3. TOP RECURRING PROBLEM CATEGORIES"\r\n`;
    csv += ['Category', 'Incidents Count', 'Percentage of Volume'].map(csvCell).join(',') + '\r\n';
    categories.forEach((c) => {
      csv += [c.name, c.count, isPresent(c.percentage) ? `${c.percentage}%` : '—'].map(csvCell).join(',') + '\r\n';
    });
    csv += `\r\n`;
  }

  // Recurring equipment
  const equipment = data?.recurring_issues?.top_equipment || [];
  if (equipment.length > 0) {
    csv += `"4. TOP RECURRING EQUIPMENT ISSUES"\r\n`;
    csv += ['Equipment / Model', 'Incident Count', 'Percentage of Volume'].map(csvCell).join(',') + '\r\n';
    equipment.forEach((m) => {
      csv += [m.name, m.count, isPresent(m.percentage) ? `${m.percentage}%` : '—'].map(csvCell).join(',') + '\r\n';
    });
    csv += `\r\n`;
  }

  // Branch comparisons (if present)
  const branches = data?.branch_comparisons || data?.branchComparison || [];
  if (branches.length > 0) {
    csv += `"5. HOSPITAL BRANCH COMPARATIVE PERFORMANCE"\r\n`;
    csv += ['Branch Name', 'Total Tickets', 'Resolved Tickets', 'SLA Compliance (%)', 'Avg Resolution (hrs)', 'CSAT Rating'].map(csvCell).join(',') + '\r\n';
    branches.forEach((b) => {
      csv += [b.name, b.total_tickets ?? b.totalTickets ?? 0, b.resolved_tickets ?? b.resolvedTickets ?? 0, `${b.sla_compliance_rate ?? b.slaCompliance ?? 0}%`, b.avg_resolution_hours ?? b.avgResolutionTime ?? '—', b.csat_score ?? b.avgCsat ?? '—'].map(csvCell).join(',') + '\r\n';
    });
  }

  return csv;
}

/** CSV for the operational dashboards (Branch and System) - Dynamic & Filter-Aware. */
export function exportAnalyticsToCsv(data, periodOrOptions = '', options = {}) {
  const opts = typeof periodOrOptions === 'object' && periodOrOptions !== null
    ? periodOrOptions
    : { period: periodOrOptions, ...options };

  const csvContent = buildDynamicAnalyticsCsv(data, opts);
  const tabSlug = (opts.activeTab || 'Operational').replace(/\s+/g, '_');
  const filename = `SBSI_${tabSlug}_Analytics_${todayStamp()}.csv`;
  downloadCsv(filename, csvContent);
}

/** CSV for the predictive forecast - Dynamic & Filter-Aware. */
export function exportPredictiveToCsv(data, periodOrOptions = '', options = {}) {
  const opts = typeof periodOrOptions === 'object' && periodOrOptions !== null
    ? periodOrOptions
    : { period: periodOrOptions, ...options };

  const periodText = formatPeriodString(opts.period, opts.dateFrom, opts.dateTo);
  const branchName = opts.branchName || 'Main Branch';
  const timestampPHT = new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' });

  let csv = `${csvCell('Predictive Risk & Volume Forecast Report')}\r\n`;
  csv += `Generated At:,${csvCell(timestampPHT + ' PHT')}\r\n`;
  csv += `Branch Scope:,${csvCell(branchName)}\r\n`;
  csv += `Historical Analysis Window:,${csvCell(periodText)}\r\n`;
  csv += `Model Engine:,${csvCell('Gemini AI 2.0 & Regression Trend Baseline')}\r\n\r\n`;

  const rows = buildPredictiveExportRows(data);
  csv += EXPORT_HEADERS.map(csvCell).join(',') + '\r\n';
  rows.forEach((r) => {
    csv += r.map(csvCell).join(',') + '\r\n';
  });

  downloadCsv(`SBSI_Predictive_Forecast_${todayStamp()}.csv`, csv);
}

/** Kept for existing callers: the master report is the operational analytics report. */
export function exportMasterReportToCsv(data) {
  exportAnalyticsToCsv(data);
}

/**
 * Structured CSV Export with Clean Metadata & Table Layout (Pic 3 Design)
 */
export function exportStructuredCsv(filename, headers, rows, filterSummary = {}) {
  const dateStr = new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' });
  const title = filterSummary.reportType || 'Operational Analytics Report';

  let csv = `${csvCell(title)}\r\n`;
  csv += `Generated At:,${csvCell(dateStr + ' PHT')}\r\n`;
  csv += `Branch Scope:,${csvCell(filterSummary.branch || 'All Branches')}\r\n`;
  csv += `Date Range:,${csvCell(filterSummary.dateRange || 'Standard Period')}\r\n`;
  csv += `Department:,${csvCell(filterSummary.department || 'All Departments')}\r\n`;
  if (filterSummary.priority && filterSummary.priority !== 'All') {
    csv += `Priority:,${csvCell(filterSummary.priority)}\r\n`;
  }
  csv += `Total Records:,${csvCell(rows.length)}\r\n\r\n`;

  // Headers
  csv += headers.map(csvCell).join(',') + '\r\n';

  // Rows
  rows.forEach((r) => {
    let rowValues;
    if (Array.isArray(r)) {
      rowValues = headers.map((_, i) => csvCell(r[i]));
    } else {
      rowValues = headers.map((h) => {
        const val = r[h] !== undefined ? r[h] : (r[h.toLowerCase().replace(/\s+/g, '_')] ?? '');
        return csvCell(val);
      });
    }
    csv += rowValues.join(',') + '\r\n';
  });

  downloadCsv(filename.endsWith('.csv') ? filename : `${filename}.csv`, csv);
}

function downloadBytes(filename, bytes, mime) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const ensureXlsx = (filename) => filename.replace(/\.(xlsx|csv|pdf)$/i, '') + '.xlsx';

/**
 * Structured Excel export (spec 0029 AC-16): a genuine .xlsx workbook with a title, filter summary,
 * a frozen filterable header row and real numeric cells.
 */
export function exportStructuredExcel(filename, reportTitle, headers, rows, filterSummary = {}) {
  const generated = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const matrix = rows.map((r) => {
    if (Array.isArray(r)) return r;
    return headers.map((h) => (r[h] !== undefined ? r[h] : (r[h.toLowerCase().replace(/\s+/g, '_')] ?? '')));
  });

  const meta = [
    ['Generated At:', generated],
    ['Branch Scope:', filterSummary.branch || 'All Branches'],
    ['Date Range:', filterSummary.dateRange || 'Standard Period'],
    ['Department:', filterSummary.department || 'All Departments'],
  ];
  if (filterSummary.priority && filterSummary.priority !== 'All') {
    meta.push(['Priority:', filterSummary.priority]);
  }
  meta.push(['Total Records:', String(matrix.length)]);

  const bytes = buildXlsx({
    sheetName: 'Report',
    title: reportTitle,
    meta,
    headers,
    rows: matrix,
  });
  downloadBytes(ensureXlsx(filename), bytes, XLSX_MIME);
}

/** Excel for the operational dashboards (Branch and System) - Dynamic & Filter-Aware. */
export function exportAnalyticsToExcel(data, periodOrOptions = 'Active Period', options = {}) {
  const opts = typeof periodOrOptions === 'object' && periodOrOptions !== null
    ? periodOrOptions
    : { period: periodOrOptions, ...options };

  const activeTab = opts.activeTab || 'overview';
  const periodText = formatPeriodString(opts.period, opts.dateFrom, opts.dateTo);
  const branchName = opts.branchName || 'Main Branch';

  if (activeTab === 'departments') {
    const headers = ['Department', 'Staff Count', 'Total Tickets', 'Resolved Tickets', 'Open Tickets', 'Overdue Tickets', 'Avg Resolution (hrs)', 'SLA Compliance (%)'];
    const depts = data?.departments?.departments || data?.departments || opts.analyticsData?.departments?.departments || [];
    const matrix = depts.map((d) => [
      d.department || d.name || 'Unassigned',
      Number(d.staff_count ?? d.staffCount ?? 0),
      Number(d.total_tickets ?? d.totalTickets ?? 0),
      Number(d.resolved_tickets ?? d.resolvedTickets ?? 0),
      Number(d.open_tickets_count ?? d.openCount ?? 0),
      Number(d.overdue_tickets_count ?? d.overdueCount ?? 0),
      isPresent(d.avg_resolution_hours) ? `${Number(d.avg_resolution_hours).toFixed(1)}h` : (d.avgResolutionTime ? `${d.avgResolutionTime}h` : '—'),
      isPresent(d.sla_compliance_rate) ? `${Number(d.sla_compliance_rate).toFixed(1)}%` : (d.slaCompliance != null ? `${d.slaCompliance}%` : '—'),
    ]);
    exportStructuredExcel(`SBSI_Department_Performance_${todayStamp()}.xlsx`, 'Department Performance & Workload Report', headers, matrix, {
      branch: branchName,
      dateRange: periodText,
      department: 'All Departments',
    });
    return;
  }

  if (activeTab === 'employees') {
    const headers = ['Technician Name', 'Department', 'Role', 'Active Tickets', 'Resolved Tickets', 'Total Handled', 'SLA Compliance (%)', 'Avg Resolution (hrs)'];
    const emps = data?.employee_performance?.employees || data?.employee_performance?.list || (Array.isArray(data?.employee_performance) ? data.employee_performance : []) || opts.analyticsData?.performance?.employees || [];
    const matrix = emps.map((emp) => [
      emp.name || `Employee #${emp.id || emp.emp_id}`,
      emp.department || 'Service',
      emp.role || emp.technical_role || 'Technician',
      Number(emp.active_tickets ?? emp.activeTickets ?? emp.open_tickets ?? 0),
      Number(emp.resolved_tickets ?? emp.resolvedTickets ?? 0),
      Number(emp.active_tickets ?? emp.activeTickets ?? emp.open_tickets ?? 0) + Number(emp.resolved_tickets ?? emp.resolvedTickets ?? 0),
      isPresent(emp.sla_compliance_rate) ? `${Number(emp.sla_compliance_rate).toFixed(1)}%` : (isPresent(emp.compliance_rate) ? `${Number(emp.compliance_rate).toFixed(1)}%` : '—'),
      isPresent(emp.avg_resolution_hours) ? `${Number(emp.avg_resolution_hours).toFixed(1)}h` : (isPresent(emp.avg_resolution_time) ? `${emp.avg_resolution_time}h` : '—'),
    ]);
    exportStructuredExcel(`SBSI_Technician_Performance_${todayStamp()}.xlsx`, 'Technician Workload & Performance Report', headers, matrix, {
      branch: branchName,
      dateRange: periodText,
      department: 'All Departments',
    });
    return;
  }

  // Default Overview
  const rows = buildAnalyticsExportRows(data).map(([section, metric, value, unit, note]) => ({
    Section: section, Metric: metric, Value: value, Unit: unit, Note: note,
  }));
  exportStructuredExcel(`SBSI_Operational_Analytics_${todayStamp()}.xlsx`, 'Operational Analytics Executive Report', EXPORT_HEADERS, rows, {
    branch: branchName,
    dateRange: periodText,
    department: 'All Departments',
  });
}

/** Excel for the predictive forecast. */
export function exportPredictiveToExcel(data, period = '') {
  const rows = buildPredictiveExportRows(data).map(([section, metric, value, unit, note]) => ({
    Section: section, Metric: metric, Value: value, Unit: unit, Note: note,
  }));
  exportStructuredExcel(`Predictive_Analytics_${todayStamp()}.xlsx`, 'Predictive Analytics Report', EXPORT_HEADERS, rows, {
    dateRange: period || 'Next 7 and 30 days',
    department: 'Branch forecast',
  });
}

/**
 * Structured PDF Export using jsPDF with proper page layout & headers (TS061)
 */
export function exportStructuredPdf(filename, reportTitle, headers, rows, filterSummary = {}) {
  const cleanFilename = filename.replace(/\.(pdf|csv|xlsx)$/i, '') + '.pdf';
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const dateStr = new Date().toISOString().replace('T', ' ').substring(0, 19);

  const pageWidth = 297;
  const pageHeight = 210;
  const margin = 14;
  let currentY = 18;

  // Header Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(37, 37, 120); // Brand primary
  doc.text(reportTitle, margin, currentY);

  currentY += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(`Generated on: ${dateStr} | Enterprise IT Service Desk`, margin, currentY);

  // Filter Summary Box
  currentY += 5;
  doc.setDrawColor(226, 232, 240);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(margin, currentY, pageWidth - margin * 2, 12, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(30, 41, 59);
  const filterText = `Filters: Branch Scope: [${filterSummary.branch || 'All'}] | Range: [${filterSummary.dateRange || 'All'}] | Dept: [${filterSummary.department || 'All'}]`;
  doc.text(filterText, margin + 4, currentY + 7);

  // Table Setup
  currentY += 18;
  const colWidth = (pageWidth - margin * 2) / headers.length;

  // Draw Table Headers
  doc.setFillColor(37, 37, 120);
  doc.rect(margin, currentY, pageWidth - margin * 2, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);

  headers.forEach((h, idx) => {
    doc.text(String(h), margin + idx * colWidth + 2, currentY + 5.5);
  });

  currentY += 8;

  // Draw Rows
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(30, 41, 59);

  let pageNum = 1;

  rows.forEach((r, rowIdx) => {
    if (currentY + 7 > pageHeight - 15) {
      // Add page break
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text(`Page ${pageNum}`, pageWidth - margin - 15, pageHeight - 8);

      doc.addPage();
      pageNum++;
      currentY = 16;

      // Repeat Table Header
      doc.setFillColor(37, 37, 120);
      doc.rect(margin, currentY, pageWidth - margin * 2, 8, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(255, 255, 255);
      headers.forEach((h, idx) => {
        doc.text(String(h), margin + idx * colWidth + 2, currentY + 5.5);
      });
      currentY += 8;
    }

    // Row alternating background
    if (rowIdx % 2 === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, currentY, pageWidth - margin * 2, 7, 'F');
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(30, 41, 59);

    headers.forEach((h, colIdx) => {
      const val = r[h] !== undefined ? r[h] : (r[h.toLowerCase().replace(/\s+/g, '_')] ?? '');
      const text = String(val).substring(0, 32);
      doc.text(text, margin + colIdx * colWidth + 2, currentY + 4.8);
    });

    currentY += 7;
  });

  // Footer page number
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text(`Page ${pageNum}`, pageWidth - margin - 15, pageHeight - 8);

  doc.save(cleanFilename);
}
