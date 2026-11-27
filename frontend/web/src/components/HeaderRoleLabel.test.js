import { describe, it, expect, vi } from 'vitest';
vi.mock('@/services/ticketService', () => ({}));
vi.mock('@/services/configurationService', () => ({ getSystemStatus: vi.fn() }));
import { headerRoleLabel } from './Header';

// Payloads mirror live /api/me responses (spec 0045).
describe('headerRoleLabel', () => {
  it('shows the department for requestors and generic "service" staff', () => {
    expect(headerRoleLabel({ department: 'Finance', role: 'service', is_ticketing_employee: false })).toBe('Finance');
    expect(headerRoleLabel({ department: 'IT', role: 'service', is_ticketing_employee: true })).toBe('IT');
    expect(headerRoleLabel({ department: 'Service', role: 'service' })).toBe('Service');
  });
  it('keeps specific roles and falls back when the department is empty', () => {
    expect(headerRoleLabel({ department: 'Customer Service', role: 'customer service', is_ticketing_employee: true })).toBe('customer service');
    expect(headerRoleLabel({ department: 'Super Admin', role: 'superadmin' })).toBe('superadmin');
    expect(headerRoleLabel({ department: 'Admin', role: 'admin', is_ticketing_employee: false })).toBe('admin');
    expect(headerRoleLabel({ department: '', role: 'service' })).toBe('service');
    expect(headerRoleLabel(null)).toBe('');
  });
});
