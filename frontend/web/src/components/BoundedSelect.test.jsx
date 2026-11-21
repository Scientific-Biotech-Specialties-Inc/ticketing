import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BoundedSelect from './BoundedSelect';

describe('BoundedSelect', () => {
  it('renders the dropdown menu downward below the trigger (top-full)', () => {
    render(
      <BoundedSelect
        name="machine_ID"
        value=""
        onChange={vi.fn()}
        options={[{ value: '1', label: 'Centrifuge - SN001' }]}
        placeholder="Select your equipment or software"
      />
    );

    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);

    const listbox = screen.getByRole('listbox');
    expect(listbox.className).toContain('top-full');
    expect(listbox.className).not.toContain('bottom-full');
  });

  it('supports grouped Equipment and Software options with search filtering', () => {
    const onChange = vi.fn();
    render(
      <BoundedSelect
        id="ticket-machine"
        name="machine_ID"
        value=""
        onChange={onChange}
        groups={[
          { label: 'Equipment', options: [{ value: '10', label: 'Autoclave - AC01' }] },
          { label: 'Software', options: [{ value: '20', label: 'LabOS Portal' }] },
        ]}
        placeholder="Select your equipment or software"
        searchable
      />
    );

    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.getByText('Equipment')).toBeInTheDocument();
    expect(screen.getByText('Software')).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText('Search options...');
    fireEvent.change(searchInput, { target: { value: 'LabOS' } });

    expect(screen.queryByText('Autoclave - AC01')).not.toBeInTheDocument();
    expect(screen.getByText('LabOS Portal')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('option', { name: 'LabOS Portal' }));
    expect(onChange).toHaveBeenCalledWith('20');
  });
});
