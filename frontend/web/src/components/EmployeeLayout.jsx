import React, { useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import Header from './Header';
import SidebarEmployee from './SidebarEmployee';
import { useAuth } from '@/context/AuthContext';
import ForceChangePasswordModal from './ForceChangePasswordModal';
import MaintenanceGate from './MaintenanceGate';
import { checkIsRequestor, isRequestorAllowedPath, REQUESTOR_HOME } from '@/utils/ticketingAccess';

export default function EmployeeLayout() {
  const { isFirstLogin, user } = useAuth();
  const location = useLocation();
  const [sidebarHovered, setSidebarHovered] = useState(false);

  // Spec 0045 (AC-12): requestors only get My Tickets, Messages, Notifications, Profile and their
  // own ticket history. Work queue pages redirect to My Tickets (the APIs also return 403).
  if (checkIsRequestor(user) && !isRequestorAllowedPath(location.pathname)) {
    return <Navigate to={REQUESTOR_HOME} replace />;
  }

  return (
    <div className="min-h-screen bg-page font-sans flex flex-col text-dark-slate w-full max-w-full overflow-x-hidden">
      <Header sidebarHovered={sidebarHovered} />
      <SidebarEmployee collapsed={true} onHoverChange={setSidebarHovered} />

      <main className="pt-24 pb-8 px-4 sm:px-6 lg:px-8 flex-1 sm:ml-20 ml-0 sm:w-[calc(100%-5rem)] w-full min-w-0 max-w-full transition-all">
        <div className="w-full min-w-0 max-w-full">
          <MaintenanceGate>
            <Outlet />
          </MaintenanceGate>
        </div>
      </main>

      {isFirstLogin && <ForceChangePasswordModal />}
    </div>
  );
}
