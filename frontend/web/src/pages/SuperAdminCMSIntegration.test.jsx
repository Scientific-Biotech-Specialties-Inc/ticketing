import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import fs from 'fs';
import path from 'path';

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock('@/context/ToastContext', () => ({ useToast: () => toast }));

const GLOBAL_BRANCH = { id: null, slug: 'all', name: 'All Branches (Global Scope)' };
const branchState = {
  branches: [
    { id: 'ncr-main', name: 'NCR Main', is_active: true },
    { id: 'cebu', name: 'Cebu Branch', is_active: true },
  ],
  selectedBranch: GLOBAL_BRANCH,
  isAllBranches: true,
  GLOBAL_BRANCH,
};
vi.mock('@/context/BranchContext', () => ({ useBranch: () => branchState }));

const api = {
  listCustomers: vi.fn(),
  searchOrganizations: vi.fn(),
  checkCustomer: vi.fn(),
  createCustomerItem: vi.fn(),
};
vi.mock('@/services/superadminCustomerService', () => ({
  listCustomers: (...a) => api.listCustomers(...a),
  searchOrganizations: (...a) => api.searchOrganizations(...a),
  checkCustomer: (...a) => api.checkCustomer(...a),
  createCustomerItem: (...a) => api.createCustomerItem(...a),
}));

import SuperAdminCMSIntegration from './SuperAdminCMSIntegration';

const ROW = {
  machine_id: 1, item_name: 'Hematology Analyzer', type: 'service', serial_number: 'SN-1', brand: 'Sysmex',
  branch_id: 'ncr-main', branch_name: 'NCR Main', client_id: 5, email: 'lab@stlukes.test', hospital_id: 7,
  hospital_name: "St. Luke's Medical Center", contract_code: null, contract_end_date: null, contract_status: 'none',
  created_at: '2026-11-27T00:00:00+08:00',
};

function conflict(data) {
  const err = new Error('conflict');
  err.response = { status: 409, data };
  return err;
}

async function fillForm({ serial = 'SN-NEW-1', email = 'new@hospital.test' } = {}) {
  fireEvent.change(screen.getByLabelText('Equipment Name'), { target: { value: 'Analyzer' } });
  fireEvent.change(screen.getByLabelText('Brand and Model'), { target: { value: 'Sysmex XN' } });
  fireEvent.change(screen.getByLabelText('Serial Number'), { target: { value: serial } });
  fireEvent.change(screen.getByLabelText('Customer Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('SBSI Branch'), { target: { value: 'cebu' } });

  const combo = screen.getByRole('combobox', { name: 'Customer Name' });
  fireEvent.change(combo, { target: { value: 'Brand New Clinic' } });
  const createRow = await screen.findByRole('option', { name: 'Add new hospital: Brand New Clinic' }, { timeout: 2000 });
  fireEvent.click(createRow);
}

async function openCreate() {
  render(<SuperAdminCMSIntegration />);
  await screen.findByText('Hematology Analyzer');
  fireEvent.click(screen.getByRole('button', { name: /Create User/ }));
}

function submit() {
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getAllByRole('button', { name: 'Create User' }).pop());
}

describe('SuperAdminCMSIntegration (Customers page)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    branchState.selectedBranch = GLOBAL_BRANCH;
    branchState.isAllBranches = true;
    api.listCustomers.mockResolvedValue({ rows: [ROW], meta: { total: 1, page: 1, per_page: 10, directory_available: true } });
    api.searchOrganizations.mockResolvedValue([]);
  });

  it('no longer imports the mock CMS data or shows the removed controls', async () => {
    const source = fs.readFileSync(path.resolve(__dirname, 'SuperAdminCMSIntegration.jsx'), 'utf8');
    expect(source).not.toContain('cmsCustomerData');

    render(<SuperAdminCMSIntegration />);
    expect(screen.getByTestId('customers-skeleton')).toBeInTheDocument();
    await screen.findByText('Hematology Analyzer');

    for (const label of [/Fetch from CMS/, /Store Pending/, /^Reset$/, /Settings/]) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
    expect(screen.queryByLabelText(/Store Status/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Service Tier/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Assigned Branch/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export JSON/ })).toBeInTheDocument();
    expect(screen.getByText("St. Luke's Medical Center")).toBeInTheDocument();
  });

  it('loads the list scoped to the header branch and filters on the server', async () => {
    branchState.selectedBranch = { id: 'cebu', name: 'Cebu Branch' };
    branchState.isAllBranches = false;
    render(<SuperAdminCMSIntegration />);
    await screen.findByText('Hematology Analyzer');
    expect(api.listCustomers).toHaveBeenLastCalledWith(expect.objectContaining({ branch_id: 'cebu', page: 1, per_page: 10 }));

    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'software' } });
    await waitFor(() => expect(api.listCustomers).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'software' })));
  });

  it('branch dropdown lists the context branches and preselects the header branch', async () => {
    branchState.selectedBranch = { id: 'cebu', name: 'Cebu Branch' };
    branchState.isAllBranches = false;
    await openCreate();

    const select = screen.getByLabelText('SBSI Branch');
    const values = within(select).getAllByRole('option').map((o) => o.value).filter(Boolean);
    expect(values).toEqual(['ncr-main', 'cebu']);
    expect(select.value).toBe('cebu');
  });

  it('under All Branches the branch starts empty and Software hides the serial', async () => {
    await openCreate();
    expect(screen.getByLabelText('SBSI Branch').value).toBe('');

    fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Type'), { target: { value: 'software' } });
    expect(screen.getByLabelText('Software Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Vendor / Version (optional)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Serial Number')).not.toBeInTheDocument();
  });

  it('creates a new account when the email and hospital are new', async () => {
    api.checkCustomer.mockResolvedValue({ email_match: null, organization: null, organization_accounts: [] });
    api.createCustomerItem.mockResolvedValue({ item: { ...ROW, hospital_name: 'Brand New Clinic' }, account_status: 'created', welcome_email_sent: true });
    await openCreate();
    await fillForm();

    submit();

    await waitFor(() => expect(api.createCustomerItem).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'new', organization_name: 'Brand New Clinic', branch_id: 'cebu', asset_type: 'equipment', serial_number: 'SN-NEW-1',
    })));
    expect(toast.success).toHaveBeenCalledWith('Created a new account for Brand New Clinic.', 'ACCOUNT CREATED');
    await waitFor(() => expect(api.listCustomers).toHaveBeenCalledTimes(2));
  });

  it('existing email opens the Existing Account modal and attaches on confirm', async () => {
    api.checkCustomer.mockResolvedValue({
      email_match: { client_id: 9, client_name: 'Makati Med', email: 'old@makati.test', status: 'inactive', organization_id: 3 },
      organization: null,
      organization_accounts: [{ client_id: 1, email: 'x@x.test' }],
    });
    api.createCustomerItem.mockResolvedValue({ item: { ...ROW, hospital_name: 'Makati Med' }, account_status: 'attached', welcome_email_sent: false });
    await openCreate();
    await fillForm({ email: 'old@makati.test' });

    submit();

    expect(await screen.findByText('This is an existing account')).toBeInTheDocument();
    expect(screen.getByText('Should we add this Service item to Makati Med (old@makati.test)?')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    expect(screen.queryByText(/already has 1 account/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add to this account' }));
    await waitFor(() => expect(api.createCustomerItem).toHaveBeenCalledWith(expect.objectContaining({ mode: 'attach', attach_client_id: 9 })));
    expect(toast.success).toHaveBeenCalledWith('Added the service item to the existing account for Makati Med.', 'ITEM ADDED');
  });

  it('hospital with accounts shows the warning and Continue confirms', async () => {
    api.checkCustomer.mockResolvedValue({
      email_match: null,
      organization: { id: 3, name: 'Brand New Clinic' },
      organization_accounts: [{ client_id: 1, email: 'a@clinic.test' }, { client_id: 2, email: 'b@clinic.test' }],
    });
    api.createCustomerItem.mockResolvedValue({ item: ROW, account_status: 'created', welcome_email_sent: true });
    await openCreate();
    await fillForm();

    submit();

    expect(await screen.findByText('This hospital already has 2 account(s). Create another account for it?')).toBeInTheDocument();
    expect(screen.getByText('a@clinic.test')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(api.createCustomerItem).toHaveBeenCalledWith(expect.objectContaining({ mode: 'new', confirm_same_hospital: true })));
  });

  it('a taken serial shows inline under Serial Number and keeps the form open', async () => {
    api.checkCustomer.mockResolvedValue({ email_match: null, organization: null, organization_accounts: [] });
    api.createCustomerItem.mockRejectedValue(conflict({ code: 'serial_taken', message: 'Serial SN-NEW-1 is already registered to Makati Med' }));
    await openCreate();
    await fillForm();

    submit();

    expect(await screen.findByText('Serial SN-NEW-1 is already registered to Makati Med')).toBeInTheDocument();
    expect(screen.getByLabelText('Equipment Name').value).toBe('Analyzer');
  });

  it('a 502 keeps the modal open with an error toast', async () => {
    api.checkCustomer.mockResolvedValue({ email_match: null, organization: null, organization_accounts: [] });
    const err = new Error('bad gateway');
    err.response = { status: 502, data: { message: 'Customer service is unavailable, please try again.' } };
    api.createCustomerItem.mockRejectedValue(err);
    await openCreate();
    await fillForm();

    submit();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Customer service is unavailable, please try again.', 'SAVE FAILED'));
    expect(screen.getByLabelText('Equipment Name').value).toBe('Analyzer');
  });

  it('requires a hospital pick before checking', async () => {
    await openCreate();
    fireEvent.change(screen.getByLabelText('Equipment Name'), { target: { value: 'Analyzer' } });
    submit();
    expect(await screen.findByText('Choose a hospital from the list or add a new one.')).toBeInTheDocument();
    await act(async () => {});
    expect(api.checkCustomer).not.toHaveBeenCalled();
  });

  it('the detail modal shows the real item fields', async () => {
    render(<SuperAdminCMSIntegration />);
    await screen.findByText('Hematology Analyzer');

    fireEvent.click(screen.getByRole('button', { name: 'View details for Hematology Analyzer' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText("St. Luke's Medical Center")).toBeInTheDocument();
    expect(within(dialog).getByText('SN-1')).toBeInTheDocument();
    expect(within(dialog).getByText('Sysmex')).toBeInTheDocument();
    expect(within(dialog).getByText('No Contract')).toBeInTheDocument();
  });

  it('shows Unavailable for hospital and email when customer service is down', async () => {
    api.listCustomers.mockResolvedValue({ rows: [ROW], meta: { total: 1, page: 1, per_page: 10, directory_available: false } });
    render(<SuperAdminCMSIntegration />);
    await screen.findByText('Hematology Analyzer');

    expect(screen.getAllByText('Unavailable')).toHaveLength(2);
  });
});
