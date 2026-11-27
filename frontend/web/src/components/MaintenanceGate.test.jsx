import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUseAuth = vi.fn();
const mockGetSystemStatus = vi.fn();

vi.mock('@/context/AuthContext', () => ({ useAuth: () => mockUseAuth() }));
vi.mock('@/services/configurationService', () => ({ getSystemStatus: () => mockGetSystemStatus() }));
vi.mock('@/services/echo', () => ({
  default: {
    channel: vi.fn(() => ({ listen: vi.fn(), stopListening: vi.fn() })),
  },
}));

import MaintenanceGate from './MaintenanceGate';

describe('MaintenanceGate', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ user: { role: 'customer' }, logout: vi.fn() });
  });

  it('renders children when the system is operational', async () => {
    mockGetSystemStatus.mockResolvedValue('Operational');
    render(<MaintenanceGate><p>App content</p></MaintenanceGate>);
    await waitFor(() => expect(mockGetSystemStatus).toHaveBeenCalled());
    expect(screen.getByText('App content')).toBeInTheDocument();
    expect(screen.queryByTestId('queue-kiosk')).not.toBeInTheDocument();
  });

  it('shows the queue kiosk maintenance screen when under maintenance', async () => {
    mockGetSystemStatus.mockResolvedValue('Under Maintenance');
    render(<MaintenanceGate><p>App content</p></MaintenanceGate>);

    expect(await screen.findByText('The service desk is paused for upgrades')).toBeInTheDocument();
    expect(screen.getByText('Under Maintenance')).toBeInTheDocument();
    expect(screen.getByTestId('queue-kiosk')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /check status/i })).toBeInTheDocument();
    expect(screen.getByText(/next automatic check in/i)).toBeInTheDocument();
    expect(screen.queryByText('App content')).not.toBeInTheDocument();
  });

  it('lets admins through during maintenance', async () => {
    mockUseAuth.mockReturnValue({ user: { role: 'admin' }, logout: vi.fn() });
    mockGetSystemStatus.mockResolvedValue('Under Maintenance');
    render(<MaintenanceGate><p>App content</p></MaintenanceGate>);
    await waitFor(() => expect(mockGetSystemStatus).toHaveBeenCalled());
    expect(screen.getByText('App content')).toBeInTheDocument();
  });
});
