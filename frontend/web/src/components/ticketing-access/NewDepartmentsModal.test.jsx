import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

const svc = vi.hoisted(() => ({
  getTicketingDepartments: vi.fn(),
  saveTicketingDepartments: vi.fn(),
  getTicketingEmployees: vi.fn(),
  setTicketingEmployee: vi.fn(),
  bulkDesignateTicketingEmployees: vi.fn(),
}));
vi.mock('@/services/ticketService', () => svc);

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => toast }));

import TicketingAccessPanel from './TicketingAccessPanel';

const before = [
  { department_name: 'Finance', is_enabled: false, active_staff_count: 4, designated_count: 0 },
  { department_name: 'Service', is_enabled: true, active_staff_count: 10, designated_count: 10 },
];
const after = [
  { department_name: 'Finance', is_enabled: true, active_staff_count: 4, designated_count: 0 },
  { department_name: 'Service', is_enabled: true, active_staff_count: 10, designated_count: 10 },
];

const enableFinanceAndSave = async () => {
  render(<TicketingAccessPanel isSuperAdmin />);
  fireEvent.click(await screen.findByRole('switch', { name: /allow finance to handle tickets/i }));
  fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
  return screen.findByRole('dialog');
};

describe('Ticketing Access: newly enabled department prompt (spec 0045)', () => {
  beforeEach(() => {
    Object.values(svc).forEach((fn) => fn.mockReset());
    toast.success.mockReset();
    toast.error.mockReset();
    HTMLElement.prototype.scrollIntoView = vi.fn();
    // Like the real server: once saved, reloading the departments returns the saved list.
    svc.getTicketingDepartments.mockResolvedValueOnce(before).mockResolvedValue(after);
    svc.saveTicketingDepartments.mockResolvedValue(after);
    svc.getTicketingEmployees.mockResolvedValue({ data: [], total: 0, last_page: 1, pending_count: 0 });
  });

  it('asks whether to add everyone or pick people after enabling a department', async () => {
    const dialog = await enableFinanceAndSave();
    expect(dialog).toHaveTextContent('Who in Finance Handles Tickets?');
    expect(dialog).toHaveTextContent('4 active staff not yet designated');
    expect(within(dialog).getByRole('button', { name: /add everyone/i })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: /pick people/i })).toBeEnabled();
  });

  it('Add Everyone designates the whole department, closes, and slides down to who was added', async () => {
    svc.bulkDesignateTicketingEmployees.mockResolvedValue({ designated_count: 4 });
    const dialog = await enableFinanceAndSave();
    fireEvent.click(within(dialog).getByRole('button', { name: /add everyone/i }));

    await waitFor(() => expect(svc.bulkDesignateTicketingEmployees).toHaveBeenCalledWith('Finance'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('combobox', { name: 'Department' })).toHaveValue('Finance');
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('designated');
    await waitFor(() => expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled());
  });

  it('with several new departments, stays open until the last one is handled', async () => {
    const twoOff = [
      { department_name: 'Finance', is_enabled: false, active_staff_count: 4, designated_count: 0 },
      { department_name: 'HR', is_enabled: false, active_staff_count: 2, designated_count: 0 },
    ];
    svc.getTicketingDepartments.mockReset().mockResolvedValueOnce(twoOff).mockResolvedValue(twoOff.map((d) => ({ ...d, is_enabled: true })));
    svc.saveTicketingDepartments.mockResolvedValue(twoOff.map((d) => ({ ...d, is_enabled: true })));
    svc.bulkDesignateTicketingEmployees.mockImplementation(async (name) => ({ designated_count: name === 'HR' ? 2 : 4 }));

    render(<TicketingAccessPanel isSuperAdmin />);
    fireEvent.click(await screen.findByRole('switch', { name: /allow finance/i }));
    fireEvent.click(screen.getByRole('switch', { name: /allow hr/i }));
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(within(dialog).getAllByRole('button', { name: /add everyone/i })[0]);
    expect(await within(dialog).findByText('4 added as ticketing employees')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /add everyone/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('combobox', { name: 'Department' })).toHaveValue('HR');
    await waitFor(() => expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled());
  });

  it('Pick People closes the prompt and filters the list to that department\'s Not Yet Designated staff', async () => {
    const dialog = await enableFinanceAndSave();
    fireEvent.click(within(dialog).getByRole('button', { name: /pick people/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() =>
      expect(svc.getTicketingEmployees).toHaveBeenLastCalledWith(
        expect.objectContaining({ department: 'Finance', status: 'pending', search: '', page: 1 })
      )
    );
    expect(screen.getByRole('combobox', { name: 'Department' })).toHaveValue('Finance');
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('pending');
    expect(svc.bulkDesignateTicketingEmployees).not.toHaveBeenCalled();
    await waitFor(() => expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' }));
  });

});

describe('Ticketing Access: confirm before turning a department off (spec 0045)', () => {
  beforeEach(() => {
    Object.values(svc).forEach((fn) => fn.mockReset());
    toast.success.mockReset();
    toast.error.mockReset();
    svc.getTicketingDepartments.mockResolvedValue(before);
    svc.getTicketingEmployees.mockResolvedValue({ data: [], total: 0, last_page: 1, pending_count: 0 });
  });

  const turnOffServiceAndSave = async () => {
    render(<TicketingAccessPanel isSuperAdmin />);
    fireEvent.click(await screen.findByRole('switch', { name: /allow service to handle tickets/i }));
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    return screen.findByRole('dialog');
  };

  it('warns how many people lose access, says no tickets are deleted, and saves nothing yet', async () => {
    const dialog = await turnOffServiceAndSave();
    expect(dialog).toHaveTextContent('Turn Off Service?');
    expect(dialog).toHaveTextContent('10 people lose ticketing employee status');
    expect(dialog).toHaveTextContent('No tickets are deleted');
    expect(svc.saveTicketingDepartments).not.toHaveBeenCalled();
  });

  it('keeps the confirm button disabled until the department name is typed', async () => {
    const dialog = await turnOffServiceAndSave();
    const confirm = within(dialog).getByRole('button', { name: /turn off department/i });
    const input = within(dialog).getByLabelText(/type service to confirm/i);

    expect(confirm).toBeDisabled();
    fireEvent.change(input, { target: { value: 'Servic' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(input, { target: { value: '  service ' } });
    expect(confirm).toBeEnabled();
  });

  it('saves after a correct confirmation and does not show the add people prompt', async () => {
    svc.saveTicketingDepartments.mockResolvedValue([before[0], { ...before[1], is_enabled: false }]);
    const dialog = await turnOffServiceAndSave();
    fireEvent.change(within(dialog).getByLabelText(/type service to confirm/i), { target: { value: 'Service' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /turn off department/i }));

    await waitFor(() =>
      expect(svc.saveTicketingDepartments).toHaveBeenCalledWith([
        { department_name: 'Finance', is_enabled: false },
        { department_name: 'Service', is_enabled: false },
      ])
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('Cancel closes the warning without saving', async () => {
    const dialog = await turnOffServiceAndSave();
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(svc.saveTicketingDepartments).not.toHaveBeenCalled();
  });

  it('still shows the open tickets when the server refuses with 409', async () => {
    svc.saveTicketingDepartments.mockRejectedValue({
      response: { status: 409, data: { message: 'Reassign these first.', blocking_tickets: [{ ticket_ID: 7, ticket_number: 'TKT-7', title: 'Printer down', assignee_name: 'Ana', assignee_id: 3 }] } },
    });
    const dialog = await turnOffServiceAndSave();
    fireEvent.change(within(dialog).getByLabelText(/type service to confirm/i), { target: { value: 'Service' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /turn off department/i }));

    expect(await screen.findByText('Reassign Open Tickets First')).toBeInTheDocument();
    expect(screen.getByText('TKT-7')).toBeInTheDocument();
  });
});
