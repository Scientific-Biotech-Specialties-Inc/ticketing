import { ticketClient } from '@/services/ticketService';

/**
 * Super Admin Customers page API (ticket-service). The browser only talks to ticket-service;
 * ticket-service asks customer-service for hospitals and accounts.
 */

/** One page of customer items. Params: search, type, contract_status, branch_id, page, per_page. */
export const listCustomers = async (params = {}) => {
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== 'all')
  );
  const response = await ticketClient.get('/superadmin/customers', { params: clean });
  return {
    rows: response.data?.data || [],
    meta: response.data?.meta || { total: 0, page: 1, per_page: clean.per_page || 10 },
  };
};

/** Hospitals matching the typed text (normalized match on the server), up to 20. */
export const searchOrganizations = async (search, { limit = 20, signal } = {}) => {
  const response = await ticketClient.get('/superadmin/customers/organizations', {
    params: { search, limit },
    signal,
  });
  return response.data?.data || [];
};

/** Does this email already have an account, and does the chosen hospital already have logins? */
export const checkCustomer = async (payload) => {
  const response = await ticketClient.post('/superadmin/customers/check', payload);
  return response.data;
};

/** Create the item, plus the account when mode is "new". Throws on 409 with `code` in the body. */
export const createCustomerItem = async (payload) => {
  const response = await ticketClient.post('/superadmin/customers', payload);
  return response.data;
};
