import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AssignModal } from './CSModals';
import * as ticketService from '@/services/ticketService';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, name: 'CS Agent', role: 'cs' } }),
}));

// Close without assigning is driven by the superadmin Transition Matrix:
// the button only appears when the backend reports Open -> Closed as allowed.
describe('AssignModal close without assigning', () => {
  const baseTicket = {
    id: 'TKT-00101',
    ticket_ID: 101,
    title: 'Centrifuge Motor Overheating',
    category: 'Service',
    priority: 'High',
    status: 'Open',
    assigned: [],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(ticketService, 'getEligibleEmployees').mockResolvedValue({ eligible_employees: [], ineligible_employees: [], eligible_count: 0 });
  });

  const renderModal = (ticket, onCloseTicket = vi.fn(() => Promise.resolve())) => {
    render(
      <MemoryRouter>
        <AssignModal
          ticket={ticket}
          employees={[]}
          departments={['Service']}
          priorityOptions={['Low', 'High']}
          onClose={vi.fn()}
          onSave={vi.fn()}
          onCloseTicket={onCloseTicket}
        />
      </MemoryRouter>
    );
    return onCloseTicket;
  };

  it('shows Resolve and resolves after remarks confirmation when the matrix allows Open -> Closed', async () => {
    const onCloseTicket = renderModal({ ...baseTicket, allowed_transitions: ['Assigned', 'Closed'] });

    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(await screen.findByText('Resolve this ticket?')).toBeInTheDocument();
    expect(onCloseTicket).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('Explain how this ticket was resolved...'), {
      target: { value: 'Resolved remotely by CS.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Yes, Resolve' }));
    await waitFor(() => expect(onCloseTicket).toHaveBeenCalledWith(expect.objectContaining({ ticket_ID: 101 }), 'Resolved remotely by CS.'));
  });

  it('hides Resolve when the matrix does not allow Open -> Closed', () => {
    renderModal({ ...baseTicket, allowed_transitions: ['Assigned'] });
    expect(screen.queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument();
  });

  it('shows the backend error if resolving is rejected', async () => {
    const onCloseTicket = vi.fn(() => Promise.reject({ response: { data: { message: 'Invalid transition from Open to Closed.' } } }));
    renderModal({ ...baseTicket, allowed_transitions: ['Closed'] }, onCloseTicket);

    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    fireEvent.change(await screen.findByPlaceholderText('Explain how this ticket was resolved...'), {
      target: { value: 'Attempted to resolve.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Yes, Resolve' }));
    const errors = await screen.findAllByText('Invalid transition from Open to Closed.');
    expect(errors.length).toBeGreaterThan(0);
  });
});
