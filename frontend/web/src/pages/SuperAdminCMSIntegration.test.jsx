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

  it('opens detail modal on clicking a customer row and displays profile and collapsible equipment on one page', async () => {
    renderWithProviders(<SuperAdminCMSIntegration />);

    await waitFor(() => {
      expect(screen.getByText("St. Luke's Medical Center - Global City")).toBeInTheDocument();
    });

    // Click customer row button
    const customerButton = screen.getByRole('button', { name: "St. Luke's Medical Center - Global City" });
    fireEvent.click(customerButton);

    // Modal should open with Customer Name, Customer Email, SBSI Branch and Equipment visible on one page
    await waitFor(() => {
      expect(screen.getByText('Customer Details')).toBeInTheDocument();
      expect(screen.getByText('Customer Name:')).toBeInTheDocument();
      expect(screen.getByText('Customer Email:')).toBeInTheDocument();
      expect(screen.getByText('SBSI Branch:')).toBeInTheDocument();
      expect(screen.getAllByText('Dr. Rafael V. Santos').length).toBeGreaterThan(1);
      expect(screen.getByText('EQUIPMENT / SOFTWARE MACHINE')).toBeInTheDocument();
      expect(screen.getByText('Brand and Model')).toBeInTheDocument();
      expect(screen.getByText('Serial Number')).toBeInTheDocument();
      expect(screen.getAllByText('Sysmex XN-1000 Automated Hematology Analyzer').length).toBeGreaterThan(0);
    });

    // Verify no buttons display the word "View"
    expect(screen.queryByRole('button', { name: /^View$/i })).not.toBeInTheDocument();
    expect(screen.getAllByLabelText(/View details for/i).length).toBeGreaterThan(0);

    // Verify removed tabs and footer Close button are not rendered in the viewing modal (only top-right X remains)
    expect(screen.queryByRole('button', { name: /Contract & SLA/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ticketing DB/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Raw JSON/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Close$/i })).toHaveLength(1);

    // Collapse Equipment chevron section
    const equipmentToggle = screen.getByRole('button', { name: /Equipment \(3\)/i });
    fireEvent.click(equipmentToggle);
    await waitFor(() => {
      expect(screen.queryByText('EQUIPMENT / SOFTWARE MACHINE')).not.toBeInTheDocument();
    });

    // Expand Equipment chevron section again
    fireEvent.click(equipmentToggle);
    await waitFor(() => {
      expect(screen.getByText('EQUIPMENT / SOFTWARE MACHINE')).toBeInTheDocument();
    });

    // Close modal via dialog top-right close button
    const closeBtn = screen.getByRole('button', { name: /^Close$/i });
    fireEvent.click(closeBtn);
    await waitFor(() => {
      expect(screen.queryByText('Customer Details')).not.toBeInTheDocument();
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

  it('opens Create User modal and creates a new customer record', async () => {
    renderWithProviders(<SuperAdminCMSIntegration />);

    await waitFor(() => {
      expect(screen.getByText("St. Luke's Medical Center - Global City")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Create User/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/Equipment Name \/ Machine Name/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Equipment Name \/ Machine Name/i), {
      target: { value: 'Hematology Analyzer' },
    });
    fireEvent.change(screen.getByLabelText(/Brand and Model/i), {
      target: { value: 'Sysmex XN-550' },
    });
    fireEvent.change(screen.getByLabelText(/Serial Number/i), {
      target: { value: 'SN-TEST-9988' },
    });
    fireEvent.change(screen.getByLabelText(/Customer Name/i), {
      target: { value: 'Makati Medical Center' },
    });
    fireEvent.change(screen.getByLabelText(/Customer Email/i), {
      target: { value: 'lab@makatimed.net.ph' },
    });
    fireEvent.change(screen.getByLabelText(/SBSI Branch/i), {
      target: { value: 'Cebu Regional Branch' },
    });

    const submitButtons = screen.getAllByRole('button', { name: /^Create User$/i });
    fireEvent.click(submitButtons[submitButtons.length - 1]);

    await waitFor(() => {
      expect(screen.getAllByText('Makati Medical Center').length).toBeGreaterThan(0);
      expect(screen.getByText('lab@makatimed.net.ph')).toBeInTheDocument();
    });
  });
});
