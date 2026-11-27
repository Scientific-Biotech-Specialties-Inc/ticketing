import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SermsReimbursementModal from './SermsReimbursementModal';
import { getTicketReimbursement, submitTicketReimbursement } from '@/services/ticketService';

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(() => ({ user: { emp_id: 6, name: 'Support Engineer' } })),
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => toast }));

vi.mock('@/services/ticketService', () => ({
  getTicketReimbursement: vi.fn(),
  submitTicketReimbursement: vi.fn(),
}));

const ticket = { ticket_ID: 8, ticket_number: 'TKT-0008', title: 'Analyzer repair' };

const claim = {
  ticket_id: 8,
  reimbursement_id: 42,
  reference_no: 'RMB-2026-00042',
  status: 'pending',
  amount: 750.5,
  expense_category: 'Transportation',
  description: 'Grab fare',
  expense_date: '2026-11-20',
  receipt_count: 1,
  can_resubmit: false,
};

describe('SermsReimbursementModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('submits the claim with receipts to ticket-service and shows the SERMS reference', async () => {
    getTicketReimbursement
      .mockResolvedValueOnce({ data: null, eligible: true, can_submit: true })
      .mockResolvedValueOnce({ data: claim, eligible: true, can_submit: false });
    submitTicketReimbursement.mockResolvedValueOnce({ data: claim });
    const onSubmitted = vi.fn();

    render(<SermsReimbursementModal ticket={ticket} open onClose={vi.fn()} onReimbursementSubmitted={onSubmitted} />);

    await screen.findByLabelText(/Amount/);
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '750.5' } });
    fireEvent.change(screen.getByLabelText(/Expense Category/), { target: { value: 'Transportation' } });
    fireEvent.change(screen.getByLabelText(/Business Purpose/), { target: { value: '  Grab fare  ' } });
    const receipt = new File(['%PDF'], 'receipt.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Attach receipts'), { target: { files: [receipt] } });

    fireEvent.click(screen.getByRole('button', { name: /Submit to SERMS/ }));

    await waitFor(() => expect(submitTicketReimbursement).toHaveBeenCalledTimes(1));
    const [id, fields, receipts] = submitTicketReimbursement.mock.calls[0];
    expect(id).toBe(8);
    expect(fields).toMatchObject({ amount: '750.50', expense_category: 'Transportation', description: 'Grab fare' });
    expect(receipts).toEqual([receipt]);

    expect(await screen.findByText('RMB-2026-00042')).toBeInTheDocument();
    expect(screen.getByText('Pending Review')).toBeInTheDocument();
    expect(onSubmitted).toHaveBeenCalled();
  });

  it('rejects receipts over 2 MB before upload', async () => {
    getTicketReimbursement.mockResolvedValueOnce({ data: null, eligible: true, can_submit: true });
    render(<SermsReimbursementModal ticket={ticket} open onClose={vi.fn()} />);

    await screen.findByLabelText(/Amount/);
    const big = new File(['x'], 'big.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 3 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText('Attach receipts'), { target: { files: [big] } });

    expect(toast.error).toHaveBeenCalled();
    expect(screen.queryByText('big.pdf')).not.toBeInTheDocument();
  });

  it('shows a rejected claim with the finance comment and allows a new claim', async () => {
    getTicketReimbursement.mockResolvedValueOnce({
      data: { ...claim, status: 'rejected', rejection_comment: 'Receipt is not official.', can_resubmit: true },
      eligible: true,
      can_submit: true,
    });
    render(<SermsReimbursementModal ticket={ticket} open onClose={vi.fn()} />);

    expect(await screen.findByText('Receipt is not official.')).toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'File New Claim' }));
    expect(screen.getByRole('button', { name: /Submit to SERMS/ })).toBeInTheDocument();
  });
});
