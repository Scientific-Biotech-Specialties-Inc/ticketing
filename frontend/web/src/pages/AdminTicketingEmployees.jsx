import React from 'react';
import { PageHeader } from '@/components/ui/page-header';
import TicketingAccessPanel from '@/components/ticketing-access/TicketingAccessPanel';

/**
 * Spec 0045 (AC-10): branch admin view of ticketing employees.
 * The server limits every read and write to the admin's own branch; the department list is read only.
 */
export default function AdminTicketingEmployees() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        pattern="B"
        title="Ticketing Employees"
        subtitle="Choose who in your branch can be assigned tickets."
      />
      <TicketingAccessPanel isSuperAdmin={false} />
    </div>
  );
}
