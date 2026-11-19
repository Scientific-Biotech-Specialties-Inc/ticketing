import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import TicketModal from './TicketModal';

vi.mock('@/services/ticketService', () => {
  const options = {
    equipment_options: [{ value: 7, label: 'Centrifuge - SN001' }],
    category_options: [{ value: 3, label: 'Hardware' }],
    machines: [],
    problem_categories: [],
  };
  return {
    getCachedTicketFormOptions: () => options,
    getTicketFormOptions: vi.fn().mockResolvedValue(options),
  };
});

const LOWERCASE_TITLE = 'printer not working';
const DESCRIPTION = 'The printer on floor two jams every time we print.';

const field = (name) => document.querySelector(`[name="${name}"]`);

const setValue = (el, value) => fireEvent.change(el, { target: { value } });
const choose = (name, value) => setValue(field(name), String(value));

const selectBounded = (triggerRegex, optionText) => {
  const trigger = screen.getByRole('button', { name: triggerRegex });
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: optionText }));
};

async function fillBasics({ title = LOWERCASE_TITLE } = {}) {
  const catBtn = await screen.findByRole('button', { name: /Select Category/i });
  await waitFor(() => expect(catBtn).not.toBeDisabled());
  const titleInput = screen.getByPlaceholderText('Brief description of the issue');
  setValue(titleInput, title);
  fireEvent.blur(titleInput);
  selectBounded(/Select Category/i, 'Hardware');
  setValue(field('description'), DESCRIPTION);
}

function renderModal(props = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <MemoryRouter>
      <TicketModal isOpen onClose={vi.fn()} onSubmit={onSubmit} {...props} />
    </MemoryRouter>
  );
  return { onSubmit };
}

describe('TicketModal title casing prompt (covers: AC-7)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows no casing prompt when the title loses focus to a dropdown', async () => {
    renderModal();
    await fillBasics();

    const eqBtn = screen.getByRole('button', { name: /Select Equipment/i });
    fireEvent.focus(eqBtn);
    fireEvent.click(eqBtn);

    expect(screen.queryByText('Proper Casing Applied')).not.toBeInTheDocument();
  });

  it('formats title casing on Submit when the title needs casing', async () => {
    const { onSubmit } = renderModal();
    await fillBasics();
    selectBounded(/Select Equipment/i, 'Centrifuge - SN001');

    expect(screen.queryByText('Proper Casing Applied')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Submit Ticket' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].title).toBe('Printer Not Working');
  });

  it('submits straight away when the title is already in proper casing', async () => {
    const { onSubmit } = renderModal();
    await fillBasics({ title: 'Printer Not Working' });
    selectBounded(/Select Equipment/i, 'Centrifuge - SN001');

    fireEvent.click(screen.getByRole('button', { name: 'Submit Ticket' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Proper Casing Applied')).not.toBeInTheDocument();
  });
});

describe('TicketModal department rule (covers: AC-8)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hides the department selector by default so customer pages are unchanged', async () => {
    renderModal();
    await waitFor(() => expect(screen.getByRole('button', { name: /Select Category/i })).toBeInTheDocument());

    expect(field('department_id')).toBeNull();
    expect(screen.getByRole('button', { name: /Select Equipment/i })).toBeInTheDocument();
  });

  it('does not send department_id when the selector is off', async () => {
    const { onSubmit } = renderModal();
    await fillBasics({ title: 'Printer Not Working' });
    selectBounded(/Select Equipment/i, 'Centrifuge - SN001');

    fireEvent.click(screen.getByRole('button', { name: 'Submit Ticket' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('department_id');
  });

  it('keeps Submit disabled for a Service ticket with no equipment', async () => {
    renderModal({ showDepartmentSelector: true });
    await fillBasics({ title: 'Printer Not Working' });

    expect(field('department_id').value).toBe('1');
    expect(screen.getByRole('button', { name: /Select Equipment/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit Ticket' })).toBeDisabled();
  });

  it('lets an IT ticket submit with no equipment and labels it optional', async () => {
    const { onSubmit } = renderModal({ showDepartmentSelector: true });
    await fillBasics({ title: 'Printer Not Working' });

    choose('department_id', 2);

    expect(screen.getByText('(Optional for IT)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /No equipment/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Submit Ticket' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.department_id).toBe(2);
    expect(payload.machine_ID).toBe('');
  });

  it('requires equipment again after switching from IT back to Service', async () => {
    renderModal({ showDepartmentSelector: true });
    await fillBasics({ title: 'Printer Not Working' });

    choose('department_id', 2);
    choose('department_id', 1);

    expect(screen.getByRole('button', { name: 'Submit Ticket' })).toBeDisabled();
  });
});
