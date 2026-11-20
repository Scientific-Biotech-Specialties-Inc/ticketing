import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ManagerReassignmentCard from './ManagerReassignmentCard';
import { acknowledgeManagerReassignment } from '@/services/ticketService';

vi.mock('@/services/ticketService', () => ({
  acknowledgeManagerReassignment: vi.fn(),
}));

const reassignment = {
  log_id: 7,
  manager_name: 'Mona Reyes',
  department: 'Service',
  added: [{ id: 2, name: 'Eddie Cruz' }],
  removed: [{ id: 1, name: 'Ana Lim' }],
  reassigned_at: '2026-11-19T07:40:00Z',
};

describe('ManagerReassignmentCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows who reassigned the ticket and who was added or removed', () => {
    render(<ManagerReassignmentCard reassignment={reassignment} ticketId={12} />);
    expect(screen.getByText('Reassigned by Service Manager')).toBeInTheDocument();
    expect(screen.getByText(/Mona Reyes reassigned this ticket/)).toBeInTheDocument();
    expect(screen.getByText('Eddie Cruz')).toBeInTheDocument();
    expect(screen.getByText('Ana Lim')).toBeInTheDocument();
  });

  it('renders nothing without a pending reassignment', () => {
    const { container } = render(<ManagerReassignmentCard reassignment={null} ticketId={12} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('acknowledges and tells the parent', async () => {
    acknowledgeManagerReassignment.mockResolvedValue({ acknowledged: true });
    const onAcknowledged = vi.fn();
    render(<ManagerReassignmentCard reassignment={reassignment} ticketId={12} onAcknowledged={onAcknowledged} />);
    fireEvent.click(screen.getByRole('button', { name: /acknowledge/i }));
    await waitFor(() => expect(onAcknowledged).toHaveBeenCalled());
    expect(acknowledgeManagerReassignment).toHaveBeenCalledWith(12);
  });

  it('shows the server error and keeps the banner when acknowledging fails', async () => {
    acknowledgeManagerReassignment.mockRejectedValue({ response: { data: { message: 'Only Customer Service can acknowledge.' } } });
    const onAcknowledged = vi.fn();
    render(<ManagerReassignmentCard reassignment={reassignment} ticketId={12} onAcknowledged={onAcknowledged} />);
    fireEvent.click(screen.getByRole('button', { name: /acknowledge/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only Customer Service can acknowledge.');
    expect(onAcknowledged).not.toHaveBeenCalled();
  });

  it('hides the action in read only mode', () => {
    render(<ManagerReassignmentCard reassignment={reassignment} ticketId={12} readOnly />);
    expect(screen.queryByRole('button', { name: /acknowledge/i })).toBeNull();
  });
});
