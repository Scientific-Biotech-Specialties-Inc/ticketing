import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import EmployeePerformanceView from './EmployeePerformanceView';
import { getAdminEmployeePerformance } from '@/services/ticketService';
import BranchContext from '@/context/BranchContext';

vi.mock('@/services/ticketService', () => ({ getAdminEmployeePerformance: vi.fn() }));

const rows = [
  { employee_id: 1, name: 'Jasmine', department: 'Service', has_data: true, tickets_assigned: 3, resolution_rate: 66.7,
    average_resolution_hours: 3.4, sla_compliance_rate: 100, reassignment_rate: 33.3, csat_score: null },
  { employee_id: 2, name: 'Idle Person', department: 'Operations', has_data: false, tickets_assigned: 0 },
];

describe('EmployeePerformanceView (spec 0029 AC-5, AC-6)', () => {
  beforeEach(() => {
    getAdminEmployeePerformance.mockReset();
    getAdminEmployeePerformance.mockResolvedValue({ employees: rows });
  });

  it('shows real values, a dash for missing ones and a notice for no activity', async () => {
    render(<EmployeePerformanceView selectedPeriod="This Month" />);
    expect(await screen.findByText('Jasmine')).toBeInTheDocument();
    expect(screen.getByText('66.7%')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument(); // CSAT
    expect(screen.getByText('No data recorded for this period')).toBeInTheDocument();
  });

  it('asks the server to sort when a header is clicked', async () => {
    render(<EmployeePerformanceView selectedPeriod="This Month" />);
    await screen.findByText('Jasmine');
    fireEvent.click(screen.getByRole('button', { name: 'Sort by SLA Compliance' }));
    await waitFor(() => {
      const last = getAdminEmployeePerformance.mock.calls.at(-1)[0];
      expect(last).toMatchObject({ preset: 'This Month', sort_by: 'sla_compliance_rate', sort_dir: 'desc' });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sort by SLA Compliance' }));
    await waitFor(() => expect(getAdminEmployeePerformance.mock.calls.at(-1)[0].sort_dir).toBe('asc'));
  });

  const withBranch = (value, ui) => <BranchContext.Provider value={value}>{ui}</BranchContext.Provider>;

  it('scopes a superadmin to the selected branch, matching what that branch admin sees', async () => {
    const { rerender } = render(withBranch({ isSuperAdmin: true, selectedBranchId: 5 }, <EmployeePerformanceView selectedPeriod="This Month" />));
    await screen.findByText('Jasmine');
    expect(getAdminEmployeePerformance.mock.calls.at(-1)[0]).toMatchObject({ branch_id: 5 });

    rerender(withBranch({ isSuperAdmin: true, selectedBranchId: 6 }, <EmployeePerformanceView selectedPeriod="This Month" />));
    await waitFor(() => expect(getAdminEmployeePerformance.mock.calls.at(-1)[0]).toMatchObject({ branch_id: 6 }));
  });

  it('sends all for a superadmin on All Branches so the server does not fall back to their own branch', async () => {
    render(withBranch({ isSuperAdmin: true, selectedBranchId: null }, <EmployeePerformanceView selectedPeriod="This Month" />));
    await screen.findByText('Jasmine');
    expect(getAdminEmployeePerformance.mock.calls.at(-1)[0]).toMatchObject({ branch_id: 'all' });
  });

  it('never sends a branch for a branch admin, whose scope the server locks', async () => {
    render(withBranch({ isSuperAdmin: false, selectedBranchId: 5 }, <EmployeePerformanceView selectedPeriod="This Month" />));
    await screen.findByText('Jasmine');
    expect(getAdminEmployeePerformance.mock.calls.at(-1)[0]).not.toHaveProperty('branch_id');
  });

  it('shows an error with retry instead of fake rows', async () => {
    getAdminEmployeePerformance.mockRejectedValueOnce(new Error('boom'));
    render(<EmployeePerformanceView />);
    expect(await screen.findByRole('alert')).toHaveTextContent('unavailable');
  });
});
