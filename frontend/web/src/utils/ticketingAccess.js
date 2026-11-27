import { checkIsSuperAdmin, checkIsAdmin } from '@/context/AuthContext';

/**
 * Spec 0045 (AC-12, AC-13): a requestor is a staff member who is not a designated ticketing
 * employee. Superadmin and admin roles are never requestors.
 *
 * Only an explicit `false` counts: an older cached session without the field keeps the full
 * portal until it refreshes. The server guards are the real control; this only shapes the UI.
 */
export const checkIsRequestor = (user) => {
  if (!user || user.is_ticketing_employee !== false) return false;
  return !checkIsSuperAdmin(user) && !checkIsAdmin(user);
};

/** The only employee portal pages a requestor may open. */
export const REQUESTOR_HOME = '/employee/my-tickets';

const REQUESTOR_ALLOWED_PREFIXES = [
  '/employee/my-tickets',
  '/employee/messages',
  '/employee/notifications',
  '/employee/profile',
  '/employee/history/',
];

export const isRequestorAllowedPath = (pathname = '') =>
  REQUESTOR_ALLOWED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`));
