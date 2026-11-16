import { describe, it, expect, beforeEach } from 'vitest';
import {
  INITIAL_CMS_CUSTOMERS,
  INCOMING_CMS_POOL,
  getStoredCmsCustomers,
  saveStoredCmsCustomers,
  fetchLatestFromCmsApi,
  storeRecordInTicketing,
  storeAllPendingRecords,
  resetCmsCustomerStore,
  getStoredIntegrationSettings,
  saveStoredIntegrationSettings,
} from './cmsCustomerData';

describe('cmsCustomerData mock service', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns baseline initial customers on first load', () => {
    const list = getStoredCmsCustomers();
    expect(list.length).toBe(INITIAL_CMS_CUSTOMERS.length);
    expect(list[0].companyName).toBe("St. Luke's Medical Center - Global City");
    expect(list[0].contract.tier).toBe('Enterprise Platinum');
  });

  it('fetches new records from incoming pool on simulation', async () => {
    const res = await fetchLatestFromCmsApi();
    expect(res.success).toBe(true);
    expect(res.records.length).toBeGreaterThanOrEqual(INITIAL_CMS_CUSTOMERS.length);
  });

  it('stores a pending record into Ticketing System', () => {
    // Record 007 is Pending Store
    const res = storeRecordInTicketing('cms-cust-007');
    expect(res.success).toBe(true);
    expect(res.record.ticketingIntegration.storeStatus).toBe('Stored');
    expect(res.record.ticketingIntegration.linkedTicketCustomerId).toBeTruthy();
  });

  it('batch stores all pending records', () => {
    const res = storeAllPendingRecords();
    expect(res.success).toBe(true);
    const updated = getStoredCmsCustomers();
    const allStored = updated.every((r) => r.ticketingIntegration.storeStatus === 'Stored');
    expect(allStored).toBe(true);
  });

  it('resets to pristine baseline', () => {
    localStorage.setItem('ts_cms_synced_customers_store', JSON.stringify([]));
    const reset = resetCmsCustomerStore();
    expect(reset.length).toBe(INITIAL_CMS_CUSTOMERS.length);
  });

  it('saves and reads integration settings', () => {
    const current = getStoredIntegrationSettings();
    expect(current.cmsApiEndpoint).toContain('https://cms.sbsi.com.ph');

    saveStoredIntegrationSettings({ ...current, syncInterval: 'Every 2 Hours' });
    const updated = getStoredIntegrationSettings();
    expect(updated.syncInterval).toBe('Every 2 Hours');
  });
});
