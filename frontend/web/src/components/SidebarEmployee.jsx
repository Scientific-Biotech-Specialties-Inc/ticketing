import React from 'react';
import { LayoutDashboard, UserCheck, TrendingUp, ClipboardList, Clock, MessageCircle, Bell, User } from 'lucide-react';
import SidebarBase from './SidebarBase';
import { useAuth } from '@/context/AuthContext';
import { checkIsRequestor } from '@/utils/ticketingAccess';

export default function SidebarEmployee({ collapsed, onHoverChange }) {
  const { user } = useAuth();

  // Spec 0045 (AC-12): a requestor sees only their own tickets and personal pages.
  if (checkIsRequestor(user)) {
    const requestorItems = [
      { name: 'My Tickets', path: '/employee/my-tickets', icon: <ClipboardList size={20} /> },
      { name: 'Messages', path: '/employee/messages', icon: <MessageCircle size={20} /> },
      { name: 'Notifications', path: '/employee/notifications', icon: <Bell size={20} /> },
      { name: 'Profile', path: '/employee/profile', icon: <User size={20} /> },
    ];
    return <SidebarBase navItems={requestorItems} collapsed={collapsed} onHoverChange={onHoverChange} />;
  }

  const navItems = [
    { name: 'Dashboard', path: '/employee/dashboard', icon: <LayoutDashboard size={20} /> },
    { name: 'Incoming', path: '/employee/assigned', icon: <UserCheck size={20} /> },
    { name: 'Assigned Ticket', path: '/employee/machine', icon: <TrendingUp size={20} /> },
    { name: 'History', path: '/employee/progress', icon: <Clock size={20} /> },
  ];

  const bottomItems = [
    { name: 'My Tickets', path: '/employee/my-tickets', icon: <ClipboardList size={20} /> },
    { name: 'Messages', path: '/employee/messages', icon: <MessageCircle size={20} /> },
  ];

  return <SidebarBase navItems={navItems} bottomItems={bottomItems} collapsed={collapsed} onHoverChange={onHoverChange} />;
}
