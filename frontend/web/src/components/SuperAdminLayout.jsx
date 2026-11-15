import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Header from './Header';
import SidebarSuperAdmin from './SidebarSuperAdmin';

export default function SuperAdminLayout() {
  const [sidebarHovered, setSidebarHovered] = useState(false);

  return (
    <div className="min-h-screen bg-page font-sans flex flex-col text-dark-slate w-full max-w-full overflow-x-hidden">
      <Header sidebarHovered={sidebarHovered} />

      <SidebarSuperAdmin collapsed={true} onHoverChange={setSidebarHovered} />

      <main className={`pt-24 pb-8 px-4 sm:px-6 lg:px-8 flex-1 ml-0 min-w-0 max-w-full transition-all duration-200 ${
        sidebarHovered ? 'sm:ml-64 sm:w-[calc(100%-16rem)]' : 'sm:ml-20 sm:w-[calc(100%-5rem)]'
      } w-full`}>
        <div className="w-full min-w-0 max-w-full">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
