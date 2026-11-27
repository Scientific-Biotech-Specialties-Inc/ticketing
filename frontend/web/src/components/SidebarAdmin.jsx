import React from 'react';
import { LayoutDashboard, Building2, BarChart3, UserCheck } from 'lucide-react';
import SidebarBase from './SidebarBase';

export default function SidebarAdmin({ collapsed, onHoverChange }) {
  const navItems = [
    { name: 'Dashboard', path: '/admin/dashboard', icon: <LayoutDashboard size={20} /> },
    { name: 'Departments', path: '/admin/departments', icon: <Building2 size={20} /> },
    // Spec 0045 (AC-10): designate ticketing employees in the admin's own branch.
    { name: 'Ticketing Employees', path: '/admin/ticketing-employees', icon: <UserCheck size={20} /> },
    { name: 'Reports', path: '/admin/reports', icon: <BarChart3 size={20} /> },
  ];

  return <SidebarBase navItems={navItems} collapsed={collapsed} onHoverChange={onHoverChange} />;
}
