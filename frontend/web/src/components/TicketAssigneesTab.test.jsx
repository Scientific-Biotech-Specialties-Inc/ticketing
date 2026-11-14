import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { getAllAssignees, getAssigneeInfo } from './ticket-modal/ticketModalUtils';
import AssigneeRow from './ticket-modal/AssigneeRow';
import { TicketSummary } from './CSModals';

// Mock dependencies for TicketSummary
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, name: 'CS Agent', role: 'cs_agent', department: 'Customer Service' },
  }),
}));

vi.mock('@/services/ticketService', () => ({
  getInternalNotes: vi.fn(() => Promise.resolve([])),
  getTicketFormOptions: vi.fn(() => Promise.resolve({ problem_categories: [], ticket_priorities: [] })),
  sendTicketReminder: vi.fn(() => Promise.resolve({ success: true })),
  addInternalNote: vi.fn(() => Promise.resolve({ success: true })),
  holdTicket: vi.fn(() => Promise.resolve({ success: true })),
  resumeTicket: vi.fn(() => Promise.resolve({ success: true })),
  reclassifyTicket: vi.fn(() => Promise.resolve({ success: true })),
  updateEmployeeTicketOverride: vi.fn(() => Promise.resolve({ success: true })),
  getEligibleEmployees: vi.fn(() => Promise.resolve([])),
  updateTicket: vi.fn(() => Promise.resolve({ success: true })),
  acceptTicket: vi.fn(() => Promise.resolve({ success: true })),
  respondReassignment: vi.fn(() => Promise.resolve({ success: true })),
}));

const mockChannel = {
  listen: vi.fn(() => mockChannel),
  stopListening: vi.fn(() => mockChannel),
};

vi.mock('@/services/echo', () => ({
  default: {
    channel: vi.fn(() => mockChannel),
  },
  getEcho: vi.fn(() => null),
  isEchoAvailable: vi.fn(() => false),
}));

describe('Multi-Assignee Support and Dedicated Assignees Tab', () => {
  const multiAssigneeTicket = {
    id: 'TKT-1042',
    ticket_ID: 1042,
    title: 'CT Scanner Power Supply Overheating',
    status: 'In Progress',
    priority: 'High',
    category: 'Hardware',
    customer: 'St. Jude Medical Center',
    department: 'Biomedical Service',
    created_at: '2026-11-14T10:00:00Z',
    updated_at: '2026-11-14T11:30:00Z',
    assigned_employees: [
      {
        id: 101,
        name: 'Bernadette Gonzalez',
        department: 'Biomedical Service',
        role: 'Senior Field Technician',
        email: 'bgonzalez@corp.local',
        assignment_status: 'accepted',
        is_online: true,
      },
      {
        id: 102,
        name: 'Carlos Mendoza',
        department: 'Electrical Support',
        role: 'Power Systems Specialist',
        email: 'cmendoza@corp.local',
        assignment_status: 'assigned',
        is_online: false,
      },
      {
        id: 103,
        name: 'Diana Prince',
        department: 'Quality Assurance',
        role: 'Compliance Officer',
        email: 'dprince@corp.local',
        assignment_status: 'assigned',
        is_online: true,
      },
    ],
  };

  it('getAllAssignees extracts and normalizes all assigned employees with initials and details', () => {
    const assignees = getAllAssignees(multiAssigneeTicket);
    expect(assignees).toHaveLength(3);
    expect(assignees[0].name).toBe('Bernadette Gonzalez');
    expect(assignees[0].initials).toBe('BG');
    expect(assignees[0].firstName).toBe('Bernadette');
    expect(assignees[1].name).toBe('Carlos Mendoza');
    expect(assignees[1].initials).toBe('CM');
    expect(assignees[2].name).toBe('Diana Prince');
    expect(assignees[2].initials).toBe('DP');
  });

  it('AssigneeRow renders avatar stack and view all shortcut when multiple assignees are passed', () => {
    const assignees = getAllAssignees(multiAssigneeTicket);
    const onViewAll = vi.fn();

    render(
      <AssigneeRow
        name={assignees[0].name}
        firstName={assignees[0].firstName}
        initials={assignees[0].initials}
        department={assignees[0].department}
        assignees={assignees}
        onViewAllAssignees={onViewAll}
      />
    );

    // Initial avatar stack should show initials
    expect(screen.getByText('BG')).toBeInTheDocument();
    expect(screen.getByText('CM')).toBeInTheDocument();
    expect(screen.getByText('DP')).toBeInTheDocument();

    // Check full name is displayed without truncation
    expect(screen.getByText(/Bernadette Gonzalez/i)).toBeInTheDocument();
    expect(screen.getByText(/& 2 others/i)).toBeInTheDocument();

    // Clicking "View all (3)" calls the onViewAll callback
    const viewAllBtn = screen.getByRole('button', { name: /view all \(3\)/i });
    expect(viewAllBtn).toBeInTheDocument();
    fireEvent.click(viewAllBtn);
    expect(onViewAll).toHaveBeenCalledTimes(1);
  });

  it('TicketSummary includes an "Assignees" tab with count and displays employee cards', () => {
    const handleClose = vi.fn();
    const handleEdit = vi.fn();

    render(
      <MemoryRouter>
        <TicketSummary
          ticket={multiAssigneeTicket}
          employees={multiAssigneeTicket.assigned_employees}
          onClose={handleClose}
          onEdit={handleEdit}
        />
      </MemoryRouter>
    );

    // Tab bar should include Assignees tab with count 3
    const assigneesTab = screen.getByRole('tab', { name: /assignees/i });
    expect(assigneesTab).toBeInTheDocument();

    // Switch to Assignees tab
    fireEvent.click(assigneesTab);

    // Header inside Assignees panel
    expect(screen.getByText(/Assigned Staff \(3\)/i)).toBeInTheDocument();

    const panel = document.getElementById('panel-assignees');
    expect(panel).toBeInTheDocument();

    // Check each staff member's full name, role, and department are rendered inside panel
    expect(within(panel).getByText('Bernadette Gonzalez')).toBeInTheDocument();
    expect(within(panel).getByText('Senior Field Technician')).toBeInTheDocument();
    expect(within(panel).getByText('Carlos Mendoza')).toBeInTheDocument();
    expect(within(panel).getByText('Power Systems Specialist')).toBeInTheDocument();
    expect(within(panel).getByText('Diana Prince')).toBeInTheDocument();
    expect(within(panel).getByText('Compliance Officer')).toBeInTheDocument();

    // When > 2 assignees: only ONE unified "Message Group Chat" button exists in header, no individual buttons beside names
    const groupChatBtn = within(panel).getByRole('button', { name: /message group chat/i });
    expect(groupChatBtn).toBeInTheDocument();
    const allMessageBtns = within(panel).getAllByRole('button', { name: /message/i });
    expect(allMessageBtns).toHaveLength(1); // Only the single group chat button!

    // Manage assignees button triggers onEdit
    const manageBtn = screen.getByRole('button', { name: /manage assignees/i });
    expect(manageBtn).toBeInTheDocument();
    fireEvent.click(manageBtn);
    expect(handleEdit).toHaveBeenCalledTimes(1);
  });

  it('renders unified Message Group Chat button when 2 or more employees are assigned', () => {
    const twoAssigneesTicket = {
      ...multiAssigneeTicket,
      assigned_employees: multiAssigneeTicket.assigned_employees.slice(0, 2),
    };

    render(
      <MemoryRouter>
        <TicketSummary
          ticket={twoAssigneesTicket}
          employees={twoAssigneesTicket.assigned_employees}
          onClose={vi.fn()}
        />
      </MemoryRouter>
    );

    const assigneesTab = screen.getByRole('tab', { name: /assignees/i });
    fireEvent.click(assigneesTab);

    const panel = document.getElementById('panel-assignees');
    expect(within(panel).getByRole('button', { name: /message group chat/i })).toBeInTheDocument();
  });
});
