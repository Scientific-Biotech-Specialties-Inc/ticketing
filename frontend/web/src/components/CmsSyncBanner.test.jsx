import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const { getCmsSyncStatus, triggerCmsSync } = vi.hoisted(() => ({
  getCmsSyncStatus: vi.fn(),
  triggerCmsSync: vi.fn(),
}));
vi.mock('@/services/ticketService', () => ({ getCmsSyncStatus, triggerCmsSync }));

import CmsSyncBanner from './CmsSyncBanner';

const down = { configured: true, reachable: false, last_success_at: '2026-11-15T12:00:00+00:00' };

describe('CmsSyncBanner (spec 3.1)', () => {
  beforeEach(() => {
    getCmsSyncStatus.mockReset();
    triggerCmsSync.mockReset();
  });

  it('stays hidden while the CMS is reachable or not configured', async () => {
    getCmsSyncStatus.mockResolvedValue({ configured: true, reachable: true });
    const { container, rerender } = render(<CmsSyncBanner />);
    await waitFor(() => expect(getCmsSyncStatus).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();

    getCmsSyncStatus.mockResolvedValue({ configured: false, reachable: false });
    rerender(<CmsSyncBanner key="2" />);
    await waitFor(() => expect(getCmsSyncStatus).toHaveBeenCalledTimes(2));
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a persistent warning when the last sync failed, without a sync action for customers', async () => {
    getCmsSyncStatus.mockResolvedValue(down);
    render(<CmsSyncBanner />);

    expect(await screen.findByRole('status')).toHaveTextContent('Contract Management System is unreachable');
    expect(screen.queryByRole('button', { name: /sync now/i })).not.toBeInTheDocument();
  });

  it('lets admins retry and hides once the CMS answers', async () => {
    getCmsSyncStatus.mockResolvedValue(down);
    triggerCmsSync.mockResolvedValue({ outcome: 'synced', status: { configured: true, reachable: true } });
    render(<CmsSyncBanner canSync />);

    fireEvent.click(await screen.findByRole('button', { name: /sync now/i }));

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(triggerCmsSync).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when the status request itself fails', async () => {
    getCmsSyncStatus.mockRejectedValue(new Error('network'));
    const { container } = render(<CmsSyncBanner canSync />);
    await waitFor(() => expect(getCmsSyncStatus).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
