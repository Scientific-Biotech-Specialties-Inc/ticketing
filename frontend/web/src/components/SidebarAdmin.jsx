import React from 'react';
import { LayoutDashboard, Building2, Users, TrendingUp, BarChart3 } from 'lucide-react';
import SidebarBase from './SidebarBase';

export default function SidebarAdmin({ collapsed, onHoverChange }) {
  const navItems = [
    { name: 'Dashboard', path: '/admin/dashboard', icon: <LayoutDashboard size={20} /> },
    { name: 'Departments', path: '/admin/departments', icon: <Building2 size={20} /> },
    { name: 'Employees', path: '/admin/employees', icon: <Users size={20} /> },
    { name: 'Predictive Analytics', path: '/admin/predictive', icon: <TrendingUp size={20} /> },
    { name: 'Reports', path: '/admin/reports', icon: <BarChart3 size={20} /> },
  ];

  return <SidebarBase navItems={navItems} collapsed={collapsed} onHoverChange={onHoverChange} />;
}
