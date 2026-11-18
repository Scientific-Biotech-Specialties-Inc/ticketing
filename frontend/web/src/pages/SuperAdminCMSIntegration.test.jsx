import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SuperAdminCMSIntegration from './SuperAdminCMSIntegration';
import { ToastProvider } from '@/context/ToastContext';

function renderWithProviders(ui) {
  return render(
    <MemoryRouter>
      <ToastProvider>{ui}</ToastProvider>
    </MemoryRouter>
  );
}

describe('SuperAdminCMSIntegration Page Tests', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('renders page header, metric cards, and initial customer records', async () => {
    renderWithProviders(<SuperAdminCMSIntegration />);

    // Header check
    expect(screen.getByText('Customer Contracts')).toBeInTheDocument();
    expect(
      screen.getByText(/Sync and manage customer profiles and service contracts from CMS/i)
    ).toBeInTheDocument();

    // Metric Cards check
    await waitFor(() => {
      expect(screen.getByText('Total CMS Customers')).toBeInTheDocument();
      expect(screen.getByText('Active Contracts & SLAs')).toBeInTheDocument();
      expect(screen.getByText('Expiring / Expired')).toBeInTheDocument();
      expect(screen.getAllByText('Stored in Ticketing DB').length).toBeGreaterThan(0);
    });

    // Customer Records Table check
    await waitFor(() => {
      expect(screen.getByText("St. Luke's Medical Center - Global City")).toBeInTheDocument();
      expect(screen.getByText('The Medical City - Ortigas')).toBeInTheDocument();
      expect(screen.getByText('Philippine General Hospital')).toBeInTheDocument();
    });
  });

  it('filters customer records by search keyword', async () => {
    renderWithProviders(<SuperAdminCMSIntegration />);

    await waitFor(() => {
      expect(screen.getByText("St. Luke's Medical Center - Global City")).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search by company, client ID/i);
    fireEvent.change(searchInput, { target: { value: 'Ortigas' } });

    await waitFor(() => {
      expect(screen.getByText('The Medical City - Ortigas')).toBeInTheDocument();
      expect(screen.queryByText("St. Luke's Medical Center - Global City")).not.toBeInTheDocument();
    });
  });

  it('filters by contract status', async () => {
    renderWithProviders(<SuperAdminCMSIntegration />);

    await waitFor(() => {
      expect(screen.getByText("St. Luke's Medical Center - Global City")).toBeInTheDocument();
    });

    const contractStatusSelect = screen.getByLabelText(/Filter by contract status/i);
    fireEvent.change(contractStatusSelect, { target: { value: 'Expired' } });

    await waitFor(() => {
      expect(screen.getByText('Asian Hospital and Medical Center')).toBeInTheDocument();
      expect(screen.queryByText("St. Luke's Medical Center - Global City")).not.toBeInTheDocument();
    });
  });

  it('opens detail modal on clicking a customer row and displays tabs', async () => {
    renderWithProviders(<SuperAdminCMSIntegration />);

    await waitFor(() => {
      expect(screen.getByText("St. Luke's Medical Center - Global City")).toBeInTheDocument();
    });

    // Click customer row button
    const customerButton = screen.getByRole('button', { name: "St. Luke's Medical Center - Global City" });
    fireEvent.click(customerButton);

    // Modal should open
    await waitFor(() => {
      expect(screen.getByText('CMS CLIENT')).toBeInTheDocument();
      expect(screen.getByText('Organization Details')).toBeInTheDocument();
      expect(screen.getAllByText('Dr. Rafael V. Santos').length).toBeGreaterThan(1);
    });

    // Verify no buttons display the word "View"
    expect(screen.queryByRole('button', { name: /^View$/i })).not.toBeInTheDocument();
    expect(screen.getAllByLabelText(/View details for/i).length).toBeGreaterThan(0);

    // Switch to Contract & SLA tab
    fireEvent.click(screen.getByRole('button', { name: /Contract & SLA/i }));
    await waitFor(() => {
      expect(screen.getAllByText('CMS-CON-2024-0089').length).toBeGreaterThan(1);
      expect(screen.getByText(/Service Level Agreement \(SLA\) Entitlements/i)).toBeInTheDocument();
    });

    // Switch to Equipment tab
    fireEvent.click(screen.getByRole('button', { name: /Equipment/i }));
    await waitFor(() => {
      expect(screen.getByText('Sysmex XN-1000 Automated Hematology Analyzer')).toBeInTheDocument();
      expect(screen.getByText('Cobas 6000 Clinical Chemistry System')).toBeInTheDocument();
    });

    // Switch to Raw JSON tab
    fireEvent.click(screen.getByRole('button', { name: /Raw JSON/i }));
    await waitFor(() => {
      expect(screen.getByText(/Payload received from CMS API:/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Copy JSON/i })).toBeInTheDocument();
    });

    // Close modal via custom top close button
    const closeBtn = screen.getByRole('button', { name: /Close modal/i });
    fireEvent.click(closeBtn);
    await waitFor(() => {
      expect(screen.queryByText('CMS CLIENT')).not.toBeInTheDocument();
    });
  });

  it('stores a pending customer record into the Ticketing System', async () => {
    renderWithProviders(<SuperAdminCMSIntegration />);

    await waitFor(() => {
      expect(screen.getByText('BioPath Diagnostic Laboratories Inc.')).toBeInTheDocument();
    });

    // BioPath is initially Pending Store
    expect(screen.getAllByText('Pending Store').length).toBeGreaterThan(0);

    const storeButtons = screen.getAllByRole('button', { name: /^Store$/i });
    expect(storeButtons.length).toBeGreaterThan(0);

    // Click Store button
    fireEvent.click(storeButtons[0]);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^Store$/i })).not.toBeInTheDocument();
    });
  });

  it('fetches fresh records from CMS when clicking Fetch from CMS', async () => {
    renderWithProviders(<SuperAdminCMSIntegration />);

    await waitFor(() => {
      expect(screen.getByText("St. Luke's Medical Center - Global City")).toBeInTheDocument();
    });

    const fetchButton = screen.getByRole('button', { name: /Fetch from CMS/i });
    fireEvent.click(fetchButton);

    await waitFor(() => {
      expect(screen.getByText(/Baguio General Hospital and Medical Center/i)).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('opens and saves integration settings modal', async () => {
    renderWithProviders(<SuperAdminCMSIntegration />);

    const settingsButton = screen.getByRole('button', { name: /^Settings$/i });
    fireEvent.click(settingsButton);

    await waitFor(() => {
      expect(screen.getByText('CMS API Settings')).toBeInTheDocument();
    });

    const endpointInput = screen.getByDisplayValue('https://cms.sbsi.com.ph/api/v1/customers/sync');
    fireEvent.change(endpointInput, { target: { value: 'https://cms.sandbox.sbsi.com.ph/api/v2' } });

    const saveButton = screen.getByRole('button', { name: /Save Settings/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.queryByText('CMS API Settings')).not.toBeInTheDocument();
      expect(screen.getByText('https://cms.sandbox.sbsi.com.ph/api/v2')).toBeInTheDocument();
    });
  });
});
