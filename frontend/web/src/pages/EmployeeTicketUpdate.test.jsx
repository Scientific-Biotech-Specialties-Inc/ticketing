import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EmployeeTicketUpdate from './EmployeeTicketUpdate';
import * as ticketService from '@/services/ticketService';
import { getTicketReimbursement } from '@/data/sermsReimbursementData';

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 6, emp_id: 6, name: 'Support Engineer', role: 'technician' },
  })),
}));

vi.mock('@/hooks/useRealtimeRefresh', () => ({
  default: vi.fn(),
}));

vi.mock('@/services/ticketService', () => ({
  getTicketDetails: vi.fn(),
  updateEmployeeTicket: vi.fn(),
  saveWorkLog: vi.fn(),
  getCustomerTicketContext: vi.fn(() => Promise.resolve({ customer: {}, machine: {} })),
}));

vi.mock('@/data/sermsReimbursementData', async (importOriginal) => ({
  ...(await importOriginal()),
  getTicketReimbursement: vi.fn(() => null),
}));

describe('EmployeeTicketUpdate Component Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads ticket details from backend when given state.ticket and displays ticket details', async () => {
    ticketService.getTicketDetails.mockResolvedValueOnce({
      id: 'TKTS-00017',
      ticket_ID: 8,
      title: 'Analyzer Transmission Failure',
      status: 'In Progress',
      priority: 'Medium',
      description: 'Results from analyzer are not reaching LIS',
      resolution_due_at: '2026-10-25T10:41:40+00:00',
      timeline: [],
    });

    render(
      <MemoryRouter initialEntries={[{ pathname: '/employee/ticket-update', state: { ticket: { ticket_ID: 8, status: 'In Progress' } } }]}>
        <Routes>
          <Route path="/employee/ticket-update" element={<EmployeeTicketUpdate />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Analyzer Transmission Failure')).toBeInTheDocument();
      expect(screen.getByText('Results from analyzer are not reaching LIS')).toBeInTheDocument();
    });

    expect(screen.queryByText(/Failed to load ticket details/i)).not.toBeInTheDocument();
  });

  it('loads ticket details from ?id= query parameter when state is null (e.g. direct link or page refresh)', async () => {
    ticketService.getTicketDetails.mockResolvedValueOnce({
      id: 'TKTS-00017',
      ticket_ID: 8,
      title: 'Direct Link Loaded Ticket',
      status: 'In Progress',
      priority: 'High',
      description: 'Loaded without state object',
      resolution_due_at: '2026-10-25T10:41:40+00:00',
      timeline: [],
    });

    render(
      <MemoryRouter initialEntries={['/employee/ticket-update?id=8']}>
        <Routes>
          <Route path="/employee/ticket-update" element={<EmployeeTicketUpdate />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Direct Link Loaded Ticket')).toBeInTheDocument();
    });
  });

  it('displays error banner if getTicketDetails fails', async () => {
    ticketService.getTicketDetails.mockRejectedValueOnce({
      response: { data: { message: 'Ticket not found or unauthorized' } },
    });

    render(
      <MemoryRouter initialEntries={[{ pathname: '/employee/ticket-update', state: { ticket: { ticket_ID: 999, status: 'Open' } } }]}>
        <Routes>
          <Route path="/employee/ticket-update" element={<EmployeeTicketUpdate />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Ticket not found or unauthorized/i)).toBeInTheDocument();
    });
  });

  it('loads ticket details from state.ticketId without exposing ticket id in url query parameters', async () => {
    ticketService.getTicketDetails.mockResolvedValueOnce({
      id: 'TKTS-00015',
      ticket_ID: 6,
      title: 'State Loaded Secure Ticket',
      status: 'In Progress',
      priority: 'Medium',
      description: 'Loaded purely via router state without URL query parameters',
      timeline: [],
    });

    render(
      <MemoryRouter initialEntries={[{ pathname: '/employee/ticket-update', state: { ticketId: 6 } }]}>
        <Routes>
          <Route path="/employee/ticket-update" element={<EmployeeTicketUpdate />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('State Loaded Secure Ticket')).toBeInTheDocument();
    });
  });

  // Spec 0048 (AC-1): Pending and On Hold need CS approval, so the employee dropdown no longer offers them.
  it('offers only In Progress and Resolved in the status dropdown', async () => {
    ticketService.getTicketDetails.mockResolvedValue({
      id: 'TKTS-00017',
      ticket_ID: 8,
      title: 'Status Change Ticket',
      status: 'In Progress',
      priority: 'Medium',
      timeline: [],
    });

    render(
      <MemoryRouter initialEntries={[{ pathname: '/employee/ticket-update', state: { ticket: { ticket_ID: 8, status: 'In Progress' } } }]}>
        <Routes>
          <Route path="/employee/ticket-update" element={<EmployeeTicketUpdate />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('Status Change Ticket');
    const options = Array.from(screen.getByRole('combobox').querySelectorAll('option')).map((o) => o.value);
    expect(options).toEqual(['In Progress', 'Resolved']);
    expect(screen.getByRole('button', { name: /Request On Hold/i })).toBeInTheDocument();
  });

  // Spec 0048 (AC-6): while a hold request is pending the status form and reassignment are locked.
  it('locks the status form and reassignment while an On Hold request is pending', async () => {
    ticketService.getTicketDetails.mockResolvedValue({
      id: 'TKTS-00017',
      ticket_ID: 8,
      title: 'Pending Hold Ticket',
      status: 'In Progress',
      priority: 'Medium',
      timeline: [],
      pending_hold_request: {
        id: 3,
        status: 'pending',
        remarks: 'Waiting on a replacement board',
        requested_by: { id: 6, name: 'Support Engineer' },
        requested_at: '2026-11-18T08:00:00+00:00',
      },
    });

    render(
      <MemoryRouter initialEntries={[{ pathname: '/employee/ticket-update', state: { ticket: { ticket_ID: 8, status: 'In Progress' } } }]}>
        <Routes>
          <Route path="/employee/ticket-update" element={<EmployeeTicketUpdate />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('Pending Hold Ticket');
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Request Reassignment' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^Request On Hold$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel Request' })).toBeInTheDocument();
    expect(screen.getAllByText('On Hold request pending CS review').length).toBeGreaterThan(0);
    expect(screen.getByText('Pending On Hold')).toBeInTheDocument();
  });

  // SERMS expense reimbursement is offered only once the ticket is resolved.
  const renderWithStatus = (status, title) => {
    ticketService.getTicketDetails.mockResolvedValue({
      id: 'TKTS-00017', ticket_ID: 8, title, status, priority: 'Medium', timeline: [],
    });
    render(
      <MemoryRouter initialEntries={[{ pathname: '/employee/ticket-update', state: { ticket: { ticket_ID: 8, status } } }]}>
        <Routes>
          <Route path="/employee/ticket-update" element={<EmployeeTicketUpdate />} />
        </Routes>
      </MemoryRouter>
    );
    return screen.findByText(title);
  };

  it.each(['In Progress', 'Pending Evaluation', 'On Hold'])('hides SERMS reimbursement while the ticket is %s', async (status) => {
    await renderWithStatus(status, `Ticket ${status}`);
    expect(screen.queryByText('Expense Reimbursement (SERMS)')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reimbursement/i })).not.toBeInTheDocument();
  });

  it.each(['Resolved', 'Closed'])('offers SERMS reimbursement once the ticket is %s', async (status) => {
    await renderWithStatus(status, `Ticket ${status}`);
    expect(screen.getAllByText('Expense Reimbursement (SERMS)').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Request Reimbursement' }).length).toBeGreaterThan(0);
  });

  it('keeps an already filed claim viewable after the ticket is reopened', async () => {
    getTicketReimbursement.mockReturnValue({ id: 'R-1', status: 'Submitted' });
    await renderWithStatus('In Progress', 'Reopened Ticket');
    expect(screen.getAllByRole('button', { name: 'View Reimbursement' }).length).toBeGreaterThan(0);
    getTicketReimbursement.mockReturnValue(null);
  });
});
