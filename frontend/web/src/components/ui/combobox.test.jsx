import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Combobox } from './combobox';

const HOSPITALS = [
  { id: 1, name: "St. Luke's Medical Center", account_count: 2 },
  { id: 2, name: 'Makati Medical Center', account_count: 0 },
];

function Harness({ options = HOSPITALS, loading = false, onSelect = vi.fn(), onSearch = vi.fn() }) {
  const [text, setText] = useState('');
  return (
    <Combobox
      id="hospital"
      aria-label="Customer Name"
      value={text}
      onInputChange={setText}
      onSearch={onSearch}
      options={options}
      loading={loading}
      onSelect={onSelect}
      createLabel={(t) => `Add new hospital: ${t}`}
    />
  );
}

describe('Combobox', () => {
  it('exposes combobox ARIA and opens a listbox while typing', () => {
    const onSearch = vi.fn();
    render(<Harness onSearch={onSearch} />);
    const input = screen.getByRole('combobox', { name: 'Customer Name' });
    expect(input).toHaveAttribute('aria-expanded', 'false');

    fireEvent.change(input, { target: { value: 'st lukes' } });

    expect(onSearch).toHaveBeenCalledWith('st lukes');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(input).toHaveAttribute('aria-activedescendant', 'hospital-option-0');
  });

  it('moves with arrow keys and picks with Enter', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'med' } });

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', 'hospital-option-1');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledWith({ isNew: false, option: HOSPITALS[1] });
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('offers the create row and returns the typed name', () => {
    const onSelect = vi.fn();
    render(<Harness options={[]} onSelect={onSelect} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Brand New Clinic' } });

    fireEvent.click(screen.getByRole('option', { name: 'Add new hospital: Brand New Clinic' }));

    expect(onSelect).toHaveBeenCalledWith({ isNew: true, name: 'Brand New Clinic' });
  });

  it('hides the create row when an option matches exactly', () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'makati medical center' } });

    expect(screen.queryByText(/Add new hospital/)).not.toBeInTheDocument();
  });

  it('shows a Searching row while loading and closes on Escape', () => {
    render(<Harness loading />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'st' } });

    expect(screen.getByText('Searching…')).toBeInTheDocument();
    expect(screen.queryAllByRole('option')).toHaveLength(0);

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });
});
