import { describe, it, expect, vi } from 'vitest';

vi.mock('@/services/ticketService', () => ({}));
vi.mock('@/services/configurationService', () => ({ getSystemStatus: vi.fn() }));
vi.mock('@/hooks/useRealtimeRefresh', () => ({ default: () => {} }));

const { profileRoleLabel } = await import('./Header');

describe('profileRoleLabel', () => {
  it('names department managers by their title', () => {
    expect(profileRoleLabel({ role: 'employee', department: 'Service', position_level: 'Manager' })).toBe('Service Manager');
    expect(profileRoleLabel({ role: 'IT Manager', department: 'IT' })).toBe('IT Manager');
    expect(profileRoleLabel({ role: 'cs_manager', department: 'Customer Service' })).toBe('CS Manager');
  });

  it('keeps the account role for everyone else', () => {
    expect(profileRoleLabel({ role: 'employee', department: 'Service' })).toBe('employee');
    expect(profileRoleLabel({ role: 'customer' })).toBe('customer');
    expect(profileRoleLabel(null)).toBe('');
  });

  it('does not mistake a Facilities manager for IT', () => {
    expect(profileRoleLabel({ role: 'Manager', department: 'Facilities', position_level: 'Manager' })).toBe('Service Manager');
  });
});
