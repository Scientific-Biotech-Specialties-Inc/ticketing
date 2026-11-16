/**
 * Mock & Persistence Layer for Smart Expense Reimbursement Management System (SERMS) Integration
 *
 * Allows employees/technicians to file job-related expense claims (fare, fuel, parts, meals)
 * linked to completed service tickets.
 */

const STORAGE_PREFIX = 'ts_serms_reimbursement_';

export const EXPENSE_CATEGORIES = [
  'Transportation & Travel Fare',
  'Fuel & Gas Allowance',
  'Emergency Spare Parts & Consumables',
  'Meals & Per Diem Allowance',
  'Client Site Parking & Toll Fees',
  'Equipment Calibration / Tool Rental',
];

export function getTicketReimbursement(ticketId) {
  if (!ticketId) return null;
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${ticketId}`);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error('[SERMS Integration] Error reading reimbursement data:', e);
    return null;
  }
}

export function saveTicketReimbursement(ticketId, data) {
  if (!ticketId) return null;
  try {
    const claimNumber = data.claimNumber || `SRM-2026-${Math.floor(1000 + Math.random() * 9000)}`;
    const record = {
      ...data,
      ticketId,
      claimNumber,
      status: data.status || 'Pending Review',
      submittedAt: data.submittedAt || new Date().toISOString(),
      targetSystem: 'SERMS (Smart Expense Reimbursement Management System)',
    };
    localStorage.setItem(`${STORAGE_PREFIX}${ticketId}`, JSON.stringify(record));
    return record;
  } catch (e) {
    console.error('[SERMS Integration] Error saving reimbursement data:', e);
    return null;
  }
}
