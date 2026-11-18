import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Building2,
  FileText,
  Clock,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Database,
  Search,
  Filter,
  X,
  ExternalLink,
  Settings,
  ChevronRight,
  Eye,
  Sliders,
  ShieldCheck,
  Shield,
  Layers,
  FileCheck,
  RotateCcw,
  Sparkles,
  Copy,
  Check,
  HardDrive,
  Cpu,
  Mail,
  Phone,
  MapPin,
  Calendar,
  Tag,
  Hash,
  Download,
  AlertCircle,
  HelpCircle,
  Link as LinkIcon,
  Loader2,
} from 'lucide-react';

import { PageHeader } from '@/components/ui/page-header';
import { MetricCard } from '@/components/ui/metric-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import Pagination from '@/components/Pagination';
import { useToast } from '@/context/ToastContext';
import {
  getStoredCmsCustomers,
  saveStoredCmsCustomers,
  fetchLatestFromCmsApi,
  storeRecordInTicketing,
  storeAllPendingRecords,
  resetCmsCustomerStore,
  getStoredIntegrationSettings,
  saveStoredIntegrationSettings,
} from '@/data/cmsCustomerData';

export default function SuperAdminCMSIntegration() {
  const toast = useToast();

  // Primary State
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [isStoringAll, setIsStoringAll] = useState(false);
  const [storingRecordId, setStoringRecordId] = useState(null);

  // Settings & Modals
  const [settings, setSettings] = useState(getStoredIntegrationSettings());
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsForm, setSettingsForm] = useState(settings);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [detailTab, setDetailTab] = useState('profile'); // 'profile' | 'contract' | 'equipment' | 'ticketing' | 'json'
  const [copiedJson, setCopiedJson] = useState(false);

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [filterContractStatus, setFilterContractStatus] = useState('all');
  const [filterStoreStatus, setFilterStoreStatus] = useState('all');
  const [filterTier, setFilterTier] = useState('all');
  const [filterBranch, setFilterBranch] = useState('all');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Initial Data Load (Simulated initial skeleton)
  useEffect(() => {
    const timer = setTimeout(() => {
      setCustomers(getStoredCmsCustomers());
      setLoading(false);
    }, 350);
    return () => clearTimeout(timer);
  }, []);

  // Filtered & Searched Data
  const filteredCustomers = useMemo(() => {
    return customers.filter((item) => {
      // Search Keyword match
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matchesName = item.companyName?.toLowerCase().includes(query);
        const matchesClientCode = item.cmsClientId?.toLowerCase().includes(query);
        const matchesContractNo = item.contract?.contractNumber?.toLowerCase().includes(query);
        const matchesContact = item.primaryContact?.name?.toLowerCase().includes(query);
        const matchesEmail = item.primaryContact?.email?.toLowerCase().includes(query);
        const matchesMachine = item.coveredEquipment?.some(
          (eq) =>
            eq.model?.toLowerCase().includes(query) ||
            eq.serialNumber?.toLowerCase().includes(query) ||
            eq.assetTag?.toLowerCase().includes(query)
        );

        if (!matchesName && !matchesClientCode && !matchesContractNo && !matchesContact && !matchesEmail && !matchesMachine) {
          return false;
        }
      }

      // Contract Status Filter
      if (filterContractStatus !== 'all') {
        if (item.contract?.status !== filterContractStatus) return false;
      }

      // Store Status Filter
      if (filterStoreStatus !== 'all') {
        if (item.ticketingIntegration?.storeStatus !== filterStoreStatus) return false;
      }

      // Service Tier Filter
      if (filterTier !== 'all') {
        if (item.contract?.tier !== filterTier) return false;
      }

      // Branch Filter
      if (filterBranch !== 'all') {
        if (item.assignedBranch !== filterBranch) return false;
      }

      return true;
    });
  }, [customers, searchTerm, filterContractStatus, filterStoreStatus, filterTier, filterBranch]);

  // Pagination Slice
  const totalPages = Math.max(1, Math.ceil(filteredCustomers.length / pageSize));
  const paginatedCustomers = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredCustomers.slice(start, start + pageSize);
  }, [filteredCustomers, currentPage, pageSize]);

  // Adjust pagination when filters reduce total pages
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(1);
    }
  }, [totalPages, currentPage]);

  // Computed Metrics
  const metrics = useMemo(() => {
    const total = customers.length;
    const activeContracts = customers.filter((c) => c.contract?.status === 'Active').length;
    const expiringSoon = customers.filter(
      (c) => c.contract?.status === 'Expiring Soon' || c.contract?.status === 'Expired'
    ).length;
    const storedInDb = customers.filter((c) => c.ticketingIntegration?.storeStatus === 'Stored').length;
    const pendingStore = customers.filter((c) => c.ticketingIntegration?.storeStatus !== 'Stored').length;

    return { total, activeContracts, expiringSoon, storedInDb, pendingStore };
  }, [customers]);

  // Distinct branches for filter dropdown
  const availableBranches = useMemo(() => {
    const set = new Set();
    customers.forEach((c) => {
      if (c.assignedBranch) set.add(c.assignedBranch);
    });
    return Array.from(set).sort();
  }, [customers]);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (filterContractStatus !== 'all') count++;
    if (filterStoreStatus !== 'all') count++;
    if (filterTier !== 'all') count++;
    if (filterBranch !== 'all') count++;
    if (searchTerm.trim()) count++;
    return count;
  }, [filterContractStatus, filterStoreStatus, filterTier, filterBranch, searchTerm]);

  const handleClearFilters = () => {
    setSearchTerm('');
    setFilterContractStatus('all');
    setFilterStoreStatus('all');
    setFilterTier('all');
    setFilterBranch('all');
    setCurrentPage(1);
  };

  // Action: Fetch Latest from CMS API
  const handleFetchFromCms = async () => {
    setIsFetching(true);
    try {
      const res = await fetchLatestFromCmsApi();
      setCustomers(res.records);
      if (res.newCount > 0) {
        toast.success(
          `Retrieved ${res.newCount} new customer contract(s) from CMS ready for storage.`,
          'CMS SYNC SUCCESS'
        );
      } else {
        toast.info('All customer records are already synchronized with CMS.', 'CMS UP TO DATE');
      }
    } catch (err) {
      toast.error('Failed to communicate with Contract Management System.', 'CMS SYNC ERROR');
    } finally {
      setIsFetching(false);
    }
  };

  // Action: Store Individual Record into Ticketing DB
  const handleStoreRecord = (record) => {
    setStoringRecordId(record.id);
    setTimeout(() => {
      const res = storeRecordInTicketing(record.id);
      if (res.success) {
        setCustomers(getStoredCmsCustomers());
        if (selectedCustomer && selectedCustomer.id === record.id) {
          setSelectedCustomer(res.record);
        }
        toast.success(res.message, 'STORED IN TICKETING');
      } else {
        toast.error(res.message || 'Failed to store record.', 'STORE ERROR');
      }
      setStoringRecordId(null);
    }, 400);
  };

  // Action: Batch Store All Pending Records
  const handleStoreAllPending = () => {
    setIsStoringAll(true);
    setTimeout(() => {
      const res = storeAllPendingRecords();
      setCustomers(res.records);
      toast.success(
        `Successfully committed ${res.count} pending customer record(s) into Ticketing System database.`,
        'BATCH STORE SUCCESS'
      );
      setIsStoringAll(false);
    }, 600);
  };

  // Action: Reset Demo Store
  const handleResetDemoData = () => {
    const baseline = resetCmsCustomerStore();
    setCustomers(baseline);
    setSelectedCustomer(null);
    toast.info('Reset CMS customer store to initial demonstration baseline.', 'STORE RESET');
  };

  // Action: Save Settings
  const handleSaveSettings = (e) => {
    e.preventDefault();
    const updated = saveStoredIntegrationSettings(settingsForm);
    setSettings(updated);
    setShowSettingsModal(false);
    toast.success('Contract Management System integration settings updated.', 'SETTINGS SAVED');
  };

  // Action: Export JSON
  const handleExportJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(customers, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `cms_customers_export_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    toast.success('Exported CMS customer dataset to JSON file.', 'EXPORT COMPLETE');
  };

  // Copy JSON in modal
  const handleCopyJson = (data) => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
    toast.info('Raw CMS JSON payload copied to clipboard.');
  };

  // Helpers for badge variants
  const getContractStatusBadgeVariant = (status) => {
    switch (status) {
      case 'Active':
        return 'medium-success';
      case 'Expiring Soon':
        return 'medium-warning';
      case 'Expired':
      case 'Terminated':
        return 'medium-destructive';
      default:
        return 'medium-info';
    }
  };

  const getTierBadgeVariant = (tier) => {
    switch (tier) {
      case 'Enterprise Platinum':
        return 'medium-violet';
      case 'Premium Gold':
        return 'medium-warning';
      case 'Standard Silver':
        return 'medium-muted';
      default:
        return 'medium-info';
    }
  };

  return (
    <div className="w-full space-y-6 pb-12 font-sans">
      {/* 1. Page Header with Actions */}
      <PageHeader
        title="Customer Contracts"
        subtitle="Sync and manage customer profiles and service contracts from CMS."
        showClock={false}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetDemoData}
              title="Reset to default mock customer dataset"
              className="border-slate-300 text-dark-slate hover:bg-slate-100 h-9 px-3"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1.5 text-muted-slate" />
              Reset
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSettingsForm(settings);
                setShowSettingsModal(true);
              }}
              className="border-slate-300 text-dark-slate hover:bg-slate-100 h-9 px-3"
            >
              <Settings className="w-3.5 h-3.5 mr-1.5 text-muted-slate" />
              Settings
            </Button>

            {metrics.pendingStore > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleStoreAllPending}
                loading={isStoringAll}
                disabled={isStoringAll}
                className="border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 h-9 px-3"
              >
                <Database className="w-3.5 h-3.5 mr-1.5 text-amber-600" />
                Store Pending ({metrics.pendingStore})
              </Button>
            )}

            <Button
              variant="default"
              size="sm"
              onClick={handleFetchFromCms}
              loading={isFetching}
              disabled={isFetching}
              className="bg-primary text-white shadow-sm hover:bg-[#2F2F8E] h-9 px-3.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isFetching ? 'animate-spin' : ''}`} />
              Fetch from CMS
            </Button>
          </div>
        }
      />

      {/* 2. Metric Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total CMS Customers"
          value={metrics.total}
          subtitle="Integrated clients"
          icon={<Building2 className="w-5 h-5 text-accent" />}
          loading={loading}
        />
        <MetricCard
          title="Active Contracts & SLAs"
          value={metrics.activeContracts}
          subtitle="Priority eligible"
          icon={<ShieldCheck className="w-5 h-5 text-emerald-600" />}
          iconBg="bg-emerald-50 text-emerald-600"
          loading={loading}
        />
        <MetricCard
          title="Expiring / Expired"
          value={metrics.expiringSoon}
          subtitle="Renewal needed"
          icon={<AlertTriangle className="w-5 h-5 text-amber-600" />}
          iconBg="bg-amber-50 text-amber-600"
          variant="amber"
          loading={loading}
        />
        <MetricCard
          title="Stored in Ticketing DB"
          value={`${metrics.storedInDb} / ${metrics.total}`}
          subtitle={metrics.pendingStore > 0 ? `${metrics.pendingStore} pending` : 'All synced'}
          icon={<CheckCircle2 className="w-5 h-5 text-indigo-600" />}
          iconBg="bg-indigo-50 text-indigo-600"
          loading={loading}
        />
      </div>

      {/* 3. Integration Live Connectivity Banner */}
      <div className="bg-surface rounded-xl border border-slate-200/80 p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3 min-w-0">
        <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
          <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0 mt-0.5 sm:mt-0">
            <Layers className="w-5 h-5 text-accent" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span className="text-sm font-bold text-dark-slate shrink-0">CMS Endpoint:</span>
              <span
                className="inline-flex items-center font-mono text-xs bg-slate-100 text-slate-700 px-2.5 py-0.5 rounded border border-slate-200 min-w-0 max-w-full break-all"
                title={settings.cmsApiEndpoint}
              >
                {settings.cmsApiEndpoint}
              </span>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                Connected
              </span>
            </div>
            <p className="text-xs text-muted-slate">
              Sync: <span className="font-medium text-slate-700">{settings.syncInterval}</span> • SLA Triage:{' '}
              <span className="font-medium text-slate-700">{settings.autoTriageContracts ? 'Active' : 'Off'}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-start md:self-center">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportJson}
            className="border-slate-300 text-dark-slate hover:bg-slate-100 h-9 px-3 gap-1.5 shrink-0"
          >
            <Download className="w-4 h-4 text-muted-slate" />
            Export JSON
          </Button>
        </div>
      </div>

      {/* 4. Search and Filter Bar */}
      <div className="bg-surface rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          {/* Search Field */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-slate" />
            <Input
              type="text"
              placeholder="Search by company, client ID (CMS-CLI-...), contract, contact person, or machine serial..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-10 w-full text-sm rounded-xl border-slate-200 focus:border-accent"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-slate hover:text-dark-slate p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Quick Clear Button */}
          {activeFiltersCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearFilters}
              className="text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700 h-10 px-3 self-end lg:self-auto"
            >
              <X className="w-3.5 h-3.5 mr-1" />
              Clear Filters ({activeFiltersCount})
            </Button>
          )}
        </div>

        {/* Filter Dropdowns Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-1 border-t border-slate-100">
          {/* Contract Status Filter */}
          <div>
            <label htmlFor="filter-contract-status" className="text-xs font-semibold text-slate-600 mb-1 block">Contract Status</label>
            <select
              id="filter-contract-status"
              aria-label="Filter by contract status"
              value={filterContractStatus}
              onChange={(e) => {
                setFilterContractStatus(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-dark-slate focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="all">All Contract Statuses</option>
              <option value="Active">Active</option>
              <option value="Expiring Soon">Expiring Soon</option>
              <option value="Expired">Expired</option>
            </select>
          </div>

          {/* Store Status Filter */}
          <div>
            <label htmlFor="filter-store-status" className="text-xs font-semibold text-slate-600 mb-1 block">Ticketing Store Status</label>
            <select
              id="filter-store-status"
              aria-label="Filter by store status"
              value={filterStoreStatus}
              onChange={(e) => {
                setFilterStoreStatus(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-dark-slate focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="all">All Store Statuses</option>
              <option value="Stored">Stored in Ticketing DB</option>
              <option value="Pending Store">Pending Store / Staged</option>
            </select>
          </div>

          {/* Service Tier Filter */}
          <div>
            <label htmlFor="filter-tier" className="text-xs font-semibold text-slate-600 mb-1 block">Service Tier (SLA)</label>
            <select
              id="filter-tier"
              aria-label="Filter by service tier"
              value={filterTier}
              onChange={(e) => {
                setFilterTier(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-dark-slate focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="all">All Service Tiers</option>
              <option value="Enterprise Platinum">Enterprise Platinum</option>
              <option value="Premium Gold">Premium Gold</option>
              <option value="Standard Silver">Standard Silver</option>
            </select>
          </div>

          {/* Branch Filter */}
          <div>
            <label htmlFor="filter-branch" className="text-xs font-semibold text-slate-600 mb-1 block">Assigned Branch</label>
            <select
              id="filter-branch"
              aria-label="Filter by assigned branch"
              value={filterBranch}
              onChange={(e) => {
                setFilterBranch(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-dark-slate focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="all">All Branches</option>
              {availableBranches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* 5. Customer & Contract Records Table */}
      <div className="bg-surface rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-dark-slate">Fetched Customer & Contract Records</h2>
            <p className="text-xs text-muted-slate mt-0.5">
              Showing {paginatedCustomers.length} of {filteredCustomers.length} records
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-slate">
            <span>Rows per page:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-dark-slate focus:outline-none"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="p-8 space-y-4">
            <div className="h-10 bg-slate-100 rounded-lg animate-pulse" />
            <div className="h-14 bg-slate-100 rounded-lg animate-pulse" />
            <div className="h-14 bg-slate-100 rounded-lg animate-pulse" />
            <div className="h-14 bg-slate-100 rounded-lg animate-pulse" />
          </div>
        ) : filteredCustomers.length === 0 ? (
          <div className="p-12 text-center">
            <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-base font-semibold text-dark-slate">No Customer Records Found</h3>
            <p className="text-xs text-muted-slate max-w-md mx-auto mt-1">
              No CMS customer records match your active search or filter criteria. Try clearing filters or fetch fresh
              records from the CMS API.
            </p>
            {activeFiltersCount > 0 && (
              <Button variant="outline" size="sm" onClick={handleClearFilters} className="mt-4">
                Clear All Filters
              </Button>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[30%]">Client / Institution</TableHead>
                <TableHead className="w-[22%]">Primary Contact</TableHead>
                <TableHead className="w-[18%]">Contract & SLA</TableHead>
                <TableHead className="w-[15%]">Status & Expiry</TableHead>
                <TableHead className="w-[15%]">Ticketing Store</TableHead>
                <TableHead className="w-[110px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedCustomers.map((cust) => {
                const isStored = cust.ticketingIntegration?.storeStatus === 'Stored';
                const isBeingStored = storingRecordId === cust.id;

                return (
                  <TableRow key={cust.id} className="hover:bg-slate-50/70 transition-colors">
                    {/* Client & ID */}
                    <TableCell>
                      <button
                        type="button"
                        className="text-left font-semibold text-sm text-dark-slate hover:text-accent cursor-pointer block"
                        onClick={() => {
                          setSelectedCustomer(cust);
                          setDetailTab('profile');
                        }}
                      >
                        {cust.companyName}
                      </button>
                      <div className="text-xs text-slate-500 font-mono mt-0.5">
                        {cust.cmsClientId} • {cust.assignedBranch}
                      </div>
                    </TableCell>

                    {/* Primary Contact */}
                    <TableCell>
                      <div className="text-sm font-medium text-dark-slate">{cust.primaryContact?.name}</div>
                      <div className="text-xs text-muted-slate truncate max-w-[220px]" title={cust.primaryContact?.email}>
                        {cust.primaryContact?.email}
                      </div>
                    </TableCell>

                    {/* Contract & SLA */}
                    <TableCell>
                      <div className="text-xs font-mono font-medium text-dark-slate">
                        {cust.contract?.contractNumber}
                      </div>
                      <Badge variant={getTierBadgeVariant(cust.contract?.tier)} size="sm" className="mt-1">
                        {cust.contract?.tier}
                      </Badge>
                    </TableCell>

                    {/* Status & Expiry */}
                    <TableCell>
                      <Badge variant={getContractStatusBadgeVariant(cust.contract?.status)} size="sm" className="mb-1">
                        {cust.contract?.status}
                      </Badge>
                      <div className="text-[11px] text-slate-500">
                        Expires {cust.contract?.endDate}
                      </div>
                    </TableCell>

                    {/* Ticketing Store Status */}
                    <TableCell>
                      <Badge variant={isStored ? 'medium-success' : 'medium-warning'} size="sm">
                        {isStored ? 'Stored in DB' : 'Pending Store'}
                      </Badge>
                    </TableCell>

                    {/* Actions: No word "View", only clean icon buttons */}
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {!isStored && (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => handleStoreRecord(cust)}
                            disabled={isBeingStored}
                            loading={isBeingStored}
                            className="h-8 px-2.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white shadow-none"
                            title="Store in Ticketing System"
                          >
                            <Database className="w-3.5 h-3.5 mr-1" />
                            Store
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedCustomer(cust);
                            setDetailTab('profile');
                          }}
                          className="h-8 w-8 p-0 text-slate-500 hover:text-accent hover:bg-blue-50"
                          title="View details"
                          aria-label={`View details for ${cust.companyName}`}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {/* Pagination Footer */}
        {filteredCustomers.length > 0 && (
          <div className="px-6 py-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-xs text-muted-slate">
              Showing page <span className="font-semibold text-dark-slate">{currentPage}</span> of{' '}
              <span className="font-semibold text-dark-slate">{totalPages}</span> ({filteredCustomers.length} total items)
            </div>
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={filteredCustomers.length}
              itemsPerPage={pageSize}
              onPageChange={setCurrentPage}
            />
          </div>
        )}
      </div>

      {/* 6. Comprehensive Detail Modal */}
      {selectedCustomer && (
        <Dialog open={!!selectedCustomer} onOpenChange={(open) => !open && setSelectedCustomer(null)}>
          <DialogContent
            className="max-w-4xl w-[95vw] md:w-full p-0 overflow-hidden rounded-2xl bg-white border border-slate-200/80 shadow-2xl flex flex-col gap-0"
            showClose={false}
          >
            {/* Modal Header */}
            <div className="p-6 bg-gradient-to-r from-[#252578] to-[#2E85D8] text-white relative w-full max-w-full">
              <div className="flex items-center justify-between gap-3 pb-2 w-full">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] font-bold tracking-wider uppercase px-2.5 py-0.5 rounded-full bg-white/20 text-white shrink-0">
                    CMS CLIENT
                  </span>
                  <span className="text-xs font-mono text-white/90 truncate">{selectedCustomer.cmsClientId}</span>
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  <Badge
                    variant={getTierBadgeVariant(selectedCustomer.contract?.tier)}
                    size="default"
                    className="bg-white text-[#252578] font-bold border-0 shadow-sm shrink-0"
                  >
                    {selectedCustomer.contract?.tier}
                  </Badge>
                  <button
                    type="button"
                    onClick={() => setSelectedCustomer(null)}
                    className="p-1.5 rounded-lg text-white hover:bg-white/20 bg-white/10 transition-colors cursor-pointer shrink-0 flex items-center justify-center"
                    aria-label="Close modal"
                  >
                    <X className="w-4 h-4 text-white" />
                  </button>
                </div>
              </div>

              <DialogHeader className="text-left mt-1 w-full">
                <DialogTitle className="text-xl font-bold tracking-tight text-white">
                  {selectedCustomer.companyName}
                </DialogTitle>
                <DialogDescription className="text-xs text-white/80 mt-0.5">
                  {selectedCustomer.category} • {selectedCustomer.assignedBranch}
                </DialogDescription>
              </DialogHeader>

              {/* Modal Tabs - Concise, clean labels */}
              <div className="flex items-center gap-1.5 mt-5 border-b border-white/20 pb-0 overflow-x-auto text-xs w-full max-w-full">
                {[
                  { id: 'profile', label: 'Profile', icon: Building2 },
                  { id: 'contract', label: 'Contract & SLA', icon: FileText },
                  { id: 'equipment', label: `Equipment (${selectedCustomer.coveredEquipment?.length || 0})`, icon: Cpu },
                  { id: 'ticketing', label: 'Ticketing DB', icon: Database },
                  { id: 'json', label: 'Raw JSON', icon: Hash },
                ].map((tab) => {
                  const Icon = tab.icon;
                  const isActive = detailTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setDetailTab(tab.id)}
                      className={`flex items-center gap-1.5 px-3 py-2 font-semibold transition-all border-b-2 whitespace-nowrap ${
                        isActive
                          ? 'border-white text-white bg-white/15 rounded-t-lg'
                          : 'border-transparent text-white/70 hover:text-white hover:bg-white/5 rounded-t-lg'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Modal Body Content */}
            <div className="p-6 max-h-[60vh] overflow-y-auto space-y-4">
              {/* Tab 1: Customer Profile */}
              {detailTab === 'profile' && (
                <div className="space-y-4 text-xs">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-2.5">
                      <h4 className="font-bold text-dark-slate text-sm flex items-center gap-1.5">
                        <Building2 className="w-4 h-4 text-accent" />
                        Organization Details
                      </h4>
                      <div className="space-y-1.5 pt-1">
                        <div>
                          <span className="text-muted-slate block">Company / Entity:</span>
                          <span className="font-semibold text-dark-slate">{selectedCustomer.companyName}</span>
                        </div>
                        <div>
                          <span className="text-muted-slate block">Trade / Facility Name:</span>
                          <span className="font-medium text-dark-slate">{selectedCustomer.tradeName || 'N/A'}</span>
                        </div>
                        <div>
                          <span className="text-muted-slate block">Tax ID (TIN):</span>
                          <span className="font-mono text-dark-slate">{selectedCustomer.taxIdentificationNumber}</span>
                        </div>
                        <div>
                          <span className="text-muted-slate block">Client Category:</span>
                          <span className="font-medium text-dark-slate">{selectedCustomer.category}</span>
                        </div>
                        <div>
                          <span className="text-muted-slate block">Assigned Support Branch:</span>
                          <span className="font-medium text-dark-slate">{selectedCustomer.assignedBranch}</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-2.5">
                      <h4 className="font-bold text-dark-slate text-sm flex items-center gap-1.5">
                        <MapPin className="w-4 h-4 text-accent" />
                        Service Location
                      </h4>
                      <div className="space-y-1.5 pt-1">
                        <div>
                          <span className="text-muted-slate block">Street Address:</span>
                          <span className="font-medium text-dark-slate">{selectedCustomer.address?.street}</span>
                        </div>
                        <div>
                          <span className="text-muted-slate block">City & Province:</span>
                          <span className="font-medium text-dark-slate">
                            {selectedCustomer.address?.city}, {selectedCustomer.address?.province}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-slate block">Postal Code:</span>
                          <span className="font-mono text-dark-slate">{selectedCustomer.address?.postalCode}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Contacts Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-2">
                      <h4 className="font-bold text-dark-slate text-sm flex items-center gap-1.5">
                        <Mail className="w-4 h-4 text-accent" />
                        Primary Point of Contact
                      </h4>
                      <div className="pt-1 space-y-1">
                        <div className="font-semibold text-dark-slate text-sm">{selectedCustomer.primaryContact?.name}</div>
                        <div className="text-muted-slate">{selectedCustomer.primaryContact?.title}</div>
                        <div className="pt-1 space-y-0.5 text-slate-700">
                          <div>Email: <a href={`mailto:${selectedCustomer.primaryContact?.email}`} className="text-accent hover:underline">{selectedCustomer.primaryContact?.email}</a></div>
                          <div>Landline: {selectedCustomer.primaryContact?.phone}</div>
                          <div>Mobile: {selectedCustomer.primaryContact?.mobile}</div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-2">
                      <h4 className="font-bold text-dark-slate text-sm flex items-center gap-1.5">
                        <Phone className="w-4 h-4 text-accent" />
                        Secondary / Procurement Contact
                      </h4>
                      <div className="pt-1 space-y-1">
                        <div className="font-semibold text-dark-slate text-sm">{selectedCustomer.secondaryContact?.name || 'None listed'}</div>
                        <div className="text-muted-slate">{selectedCustomer.secondaryContact?.title}</div>
                        <div className="pt-1 space-y-0.5 text-slate-700">
                          <div>Email: {selectedCustomer.secondaryContact?.email}</div>
                          <div>Phone: {selectedCustomer.secondaryContact?.phone}</div>
                          <div>Mobile: {selectedCustomer.secondaryContact?.mobile}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 2: Contract & SLA */}
              {detailTab === 'contract' && (
                <div className="space-y-4 text-xs">
                  <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                      <div>
                        <span className="text-muted-slate block">Contract Reference Number:</span>
                        <span className="font-mono font-bold text-sm text-dark-slate">{selectedCustomer.contract?.contractNumber}</span>
                      </div>
                      <Badge variant={getContractStatusBadgeVariant(selectedCustomer.contract?.status)} size="default">
                        {selectedCustomer.contract?.status}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                      <div>
                        <span className="text-muted-slate block">Contract Title:</span>
                        <span className="font-semibold text-dark-slate">{selectedCustomer.contract?.contractTitle}</span>
                      </div>
                      <div>
                        <span className="text-muted-slate block">Contract Agreement Type:</span>
                        <span className="font-medium text-dark-slate">{selectedCustomer.contract?.contractType}</span>
                      </div>
                      <div>
                        <span className="text-muted-slate block">Contract Value / Total:</span>
                        <span className="font-bold text-dark-slate">{selectedCustomer.contract?.contractValue}</span>
                      </div>
                      <div>
                        <span className="text-muted-slate block">Billing Arrangement:</span>
                        <span className="font-medium text-dark-slate">{selectedCustomer.contract?.billingTerm}</span>
                      </div>
                      <div>
                        <span className="text-muted-slate block">Effective Start Date:</span>
                        <span className="font-medium text-dark-slate">{selectedCustomer.contract?.startDate}</span>
                      </div>
                      <div>
                        <span className="text-muted-slate block">Contract Expiry Date:</span>
                        <span className="font-medium text-dark-slate">{selectedCustomer.contract?.endDate}</span>
                      </div>
                    </div>
                  </div>

                  {/* SLA Guarantees */}
                  <div className="bg-blue-50/60 rounded-xl p-4 border border-blue-100 space-y-2">
                    <h4 className="font-bold text-primary text-sm flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-accent" />
                      Service Level Agreement (SLA) Entitlements
                    </h4>
                    <p className="text-xs text-slate-700 leading-relaxed">
                      {selectedCustomer.contract?.slaDescription}
                    </p>
                    <div className="grid grid-cols-2 gap-3 pt-2">
                      <div className="bg-white rounded-lg p-2.5 border border-blue-100">
                        <span className="text-[11px] text-muted-slate block font-semibold">Maximum Response Time:</span>
                        <span className="text-base font-bold text-primary">{selectedCustomer.contract?.slaResponseHours} Hours</span>
                      </div>
                      <div className="bg-white rounded-lg p-2.5 border border-blue-100">
                        <span className="text-[11px] text-muted-slate block font-semibold">Target MTTR (Resolution):</span>
                        <span className="text-base font-bold text-accent">{selectedCustomer.contract?.slaResolutionHours} Hours</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 3: Covered Equipment */}
              {detailTab === 'equipment' && (
                <div className="space-y-3 text-xs">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-dark-slate text-sm">Covered Machines & Laboratory Analyzers</h4>
                    <span className="text-muted-slate">
                      {selectedCustomer.coveredEquipment?.length || 0} units registered under contract
                    </span>
                  </div>

                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Asset Tag / Serial</TableHead>
                          <TableHead>Analyzer Model</TableHead>
                          <TableHead>Lab Department</TableHead>
                          <TableHead>Warranty Status</TableHead>
                          <TableHead>PMS Schedule</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedCustomer.coveredEquipment?.map((eq) => (
                          <TableRow key={eq.assetTag}>
                            <TableCell>
                              <div className="font-mono font-bold text-dark-slate">{eq.assetTag}</div>
                              <div className="font-mono text-[11px] text-slate-500">{eq.serialNumber}</div>
                            </TableCell>
                            <TableCell className="font-medium text-dark-slate">{eq.model}</TableCell>
                            <TableCell className="text-slate-600">{eq.department}</TableCell>
                            <TableCell>
                              <Badge variant="medium-success" size="sm">
                                {eq.warrantyStatus}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="text-[11px] text-slate-600">Last: {eq.lastPmsDate}</div>
                              <div className="text-[11px] font-semibold text-accent">Next: {eq.nextPmsDate}</div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {/* Tab 4: Ticketing Store */}
              {detailTab === 'ticketing' && (
                <div className="space-y-4 text-xs">
                  <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-3">
                    <h4 className="font-bold text-dark-slate text-sm flex items-center gap-1.5">
                      <Database className="w-4 h-4 text-accent" />
                      Ticketing Database Storage Status
                    </h4>
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div>
                        <span className="text-muted-slate block">Current Store State:</span>
                        <Badge
                          variant={
                            selectedCustomer.ticketingIntegration?.storeStatus === 'Stored'
                              ? 'medium-success'
                              : 'medium-warning'
                          }
                          size="default"
                          className="mt-1"
                        >
                          {selectedCustomer.ticketingIntegration?.storeStatus}
                        </Badge>
                      </div>
                      <div>
                        <span className="text-muted-slate block">Linked Customer Account ID:</span>
                        <span className="font-mono font-bold text-dark-slate text-sm">
                          {selectedCustomer.ticketingIntegration?.linkedTicketCustomerId || 'Not Linked Yet'}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-slate block">Last Synced From CMS:</span>
                        <span className="text-slate-700 font-mono">
                          {new Date(selectedCustomer.ticketingIntegration?.syncTimestamp).toLocaleString()}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-slate block">Auto-Triage Priority Ticket Routing:</span>
                        <span className="font-semibold text-emerald-700">
                          {selectedCustomer.ticketingIntegration?.autoTriageEnabled ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {selectedCustomer.ticketingIntegration?.storeStatus !== 'Stored' && (
                    <div className="bg-amber-50 rounded-xl p-4 border border-amber-200 flex items-center justify-between">
                      <div>
                        <h5 className="font-bold text-amber-900">Record Pending Ticketing Storage</h5>
                        <p className="text-xs text-amber-800 mt-0.5">
                          This customer record was retrieved from CMS but has not yet been persisted to the Ticketing
                          System database.
                        </p>
                      </div>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => handleStoreRecord(selectedCustomer)}
                        loading={storingRecordId === selectedCustomer.id}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0 ml-4"
                      >
                        <Database className="w-4 h-4 mr-1.5" />
                        Store Now
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Tab 5: Raw CMS JSON Payload */}
              {detailTab === 'json' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-600">Payload received from CMS API:</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopyJson(selectedCustomer)}
                      className="text-xs h-7 px-2.5"
                    >
                      {copiedJson ? (
                        <>
                          <Check className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 mr-1 text-slate-500" />
                          Copy JSON
                        </>
                      )}
                    </Button>
                  </div>
                  <pre className="bg-slate-900 text-emerald-400 p-4 rounded-xl text-xs font-mono overflow-x-auto max-h-[300px] border border-slate-800">
                    {JSON.stringify(selectedCustomer, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-3 w-full shrink-0">
              <div className="text-xs text-muted-slate truncate">
                Client ID: <span className="font-mono text-slate-700">{selectedCustomer.cmsClientId}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {selectedCustomer.ticketingIntegration?.storeStatus !== 'Stored' && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => handleStoreRecord(selectedCustomer)}
                    loading={storingRecordId === selectedCustomer.id}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs"
                  >
                    <Database className="w-3.5 h-3.5 mr-1.5" />
                    Store in Ticketing DB
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedCustomer(null)}
                  className="h-8 text-xs font-semibold px-4 border-slate-300 text-dark-slate hover:bg-slate-100 shrink-0"
                >
                  Close
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* 7. Integration Settings Modal */}
      {showSettingsModal && (
        <Dialog open={showSettingsModal} onOpenChange={setShowSettingsModal}>
          <DialogContent className="max-w-xl w-full p-6 rounded-2xl bg-white border border-slate-200/80 shadow-2xl">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-dark-slate flex items-center gap-2">
                <Settings className="w-5 h-5 text-accent" />
                CMS API Settings
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-slate">
                Configure CMS endpoint and synchronization preferences.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSaveSettings} className="space-y-4 pt-2 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">CMS API Base Endpoint URL</label>
                <Input
                  type="url"
                  value={settingsForm.cmsApiEndpoint}
                  onChange={(e) => setSettingsForm({ ...settingsForm, cmsApiEndpoint: e.target.value })}
                  placeholder="https://cms.sbsi.com.ph/api/v1/customers/sync"
                  className="text-xs font-mono"
                  required
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Integration API Secret / Bearer Token</label>
                <Input
                  type="password"
                  value={settingsForm.cmsApiKey}
                  onChange={(e) => setSettingsForm({ ...settingsForm, cmsApiKey: e.target.value })}
                  placeholder="cms_sec_live_..."
                  className="text-xs font-mono"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Automated Synchronization Schedule</label>
                  <select
                    value={settingsForm.syncInterval}
                    onChange={(e) => setSettingsForm({ ...settingsForm, syncInterval: e.target.value })}
                    className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs text-dark-slate focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    <option value="Hourly">Hourly</option>
                    <option value="Every 6 Hours">Every 6 Hours</option>
                    <option value="Daily at 02:00 AM">Daily at 02:00 AM</option>
                    <option value="Manual Only">Manual Fetch Only</option>
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Ticketing Webhook Receiver</label>
                  <Input
                    type="text"
                    value={settingsForm.webhookEndpoint}
                    readOnly
                    className="text-xs font-mono bg-slate-50 text-slate-500"
                  />
                </div>
              </div>

              {/* Toggles */}
              <div className="pt-2 space-y-2 border-t border-slate-100">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settingsForm.autoStoreNewRecords}
                    onChange={(e) => setSettingsForm({ ...settingsForm, autoStoreNewRecords: e.target.checked })}
                    className="rounded border-slate-300 text-accent focus:ring-accent"
                  />
                  <span className="text-slate-700 font-medium">
                    Automatically persist newly fetched CMS records to Ticketing DB without manual review
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settingsForm.autoTriageContracts}
                    onChange={(e) => setSettingsForm({ ...settingsForm, autoTriageContracts: e.target.checked })}
                    className="rounded border-slate-300 text-accent focus:ring-accent"
                  />
                  <span className="text-slate-700 font-medium">
                    Enforce contract SLA tier prioritization on incoming customer support tickets
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settingsForm.notifyOnContractExpiry}
                    onChange={(e) => setSettingsForm({ ...settingsForm, notifyOnContractExpiry: e.target.checked })}
                    className="rounded border-slate-300 text-accent focus:ring-accent"
                  />
                  <span className="text-slate-700 font-medium">
                    Send alert notifications to SuperAdmin for contracts expiring within 30 days
                  </span>
                </label>
              </div>

              <DialogFooter className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowSettingsModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="default" size="sm" className="bg-primary hover:bg-[#2F2F8E] text-white">
                  Save Settings
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
