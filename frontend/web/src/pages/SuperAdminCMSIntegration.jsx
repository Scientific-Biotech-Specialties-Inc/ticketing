import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
  ChevronDown,
  ChevronUp,
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
  UserPlus,
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
import { FormModal } from '@/components/ui/form-modal';
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
  createCmsCustomerRecord,
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
  const [equipmentExpanded, setEquipmentExpanded] = useState(true);
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const createUserFormRef = useRef(null);
  const [createUserForm, setCreateUserForm] = useState({
    equipmentName: '',
    brandAndModel: '',
    serialNumber: '',
    customerName: '',
    customerEmail: '',
    sbsiBranch: 'NCR - Main',
  });

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

  // Action: Create User & Equipment Record
  const handleCreateUser = (e) => {
    e.preventDefault();
    const res = createCmsCustomerRecord(createUserForm);
    if (res.success) {
      setCustomers(res.records);
      setShowCreateUserModal(false);
      setCreateUserForm({
        equipmentName: '',
        brandAndModel: '',
        serialNumber: '',
        customerName: '',
        customerEmail: '',
        sbsiBranch: 'NCR - Main',
      });
      toast.success(`Created customer record for "${res.record.companyName}".`, 'USER CREATED');
    }
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
        title="Customer & Contract"
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
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                Local Sandbox (Mock Data)
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
        <div className="px-4 sm:px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-dark-slate">Fetched Customer & Contract Records</h2>
            <p className="text-xs text-muted-slate mt-0.5">
              Showing {paginatedCustomers.length} of {filteredCustomers.length} records
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-slate flex-wrap">
            <div className="flex items-center gap-2">
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
            <Button
              variant="default"
              size="sm"
              onClick={() => setShowCreateUserModal(true)}
              className="bg-primary text-white shadow-sm hover:bg-[#2F2F8E] h-8 px-3"
            >
              <UserPlus className="w-3.5 h-3.5 mr-1.5" />
              Create User
            </Button>
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
                          setEquipmentExpanded(true);
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
                            setEquipmentExpanded(true);
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

      {/* 6. ONE UI Customer & Equipment Detail Modal */}
      {selectedCustomer && (
        <Dialog open={!!selectedCustomer} onOpenChange={(open) => !open && setSelectedCustomer(null)}>
          <DialogContent className="max-w-2xl w-[95vw] p-6 font-sans rounded-2xl bg-white border border-slate-200/80 shadow-2xl">
            {/* ONE UI Left-Aligned Header */}
            <div className="flex items-start gap-4 pb-4 border-b border-slate-100">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-50 text-accent">
                <Building2 className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0 pr-6">
                <DialogTitle className="text-xl font-bold text-dark-slate">
                  {selectedCustomer.companyName}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-slate mt-0.5 font-mono">
                  {selectedCustomer.cmsClientId} • {selectedCustomer.assignedBranch}
                </DialogDescription>
              </div>
            </div>

            {/* Modal Body: Single Page (Profile + Collapsible Equipment Chevron) */}
            <div className="py-2 max-h-[65vh] overflow-y-auto space-y-4 pr-1 text-xs">
              {/* Customer Profile Details */}
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-3">
                <h4 className="font-bold text-dark-slate text-sm flex items-center gap-1.5">
                  <Building2 className="w-4 h-4 text-accent" />
                  Customer Details
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
                  <div>
                    <span className="text-muted-slate block">Customer Name:</span>
                    <span className="font-semibold text-dark-slate">
                      {selectedCustomer.primaryContact?.name || selectedCustomer.companyName}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-slate block">Customer Email:</span>
                    <a
                      href={`mailto:${selectedCustomer.primaryContact?.email}`}
                      className="font-medium text-accent hover:underline break-all"
                    >
                      {selectedCustomer.primaryContact?.email || 'N/A'}
                    </a>
                  </div>
                  <div>
                    <span className="text-muted-slate block">SBSI Branch:</span>
                    <span className="font-medium text-dark-slate">{selectedCustomer.assignedBranch || 'N/A'}</span>
                  </div>
                </div>
              </div>

              {/* Collapsible Equipment Section (Chevron) */}
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                <button
                  type="button"
                  onClick={() => setEquipmentExpanded((prev) => !prev)}
                  aria-expanded={equipmentExpanded}
                  className="w-full px-4 py-3 bg-slate-50 hover:bg-slate-100/80 transition-colors flex items-center justify-between text-left"
                >
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-accent" />
                    <span className="font-bold text-dark-slate text-sm">
                      Equipment ({selectedCustomer.coveredEquipment?.length || 0})
                    </span>
                  </div>
                  {equipmentExpanded ? (
                    <ChevronUp className="w-4 h-4 text-muted-slate" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-slate" />
                  )}
                </button>

                {equipmentExpanded && (
                  <div className="border-t border-slate-200">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>EQUIPMENT / SOFTWARE MACHINE</TableHead>
                          <TableHead>Brand and Model</TableHead>
                          <TableHead>Serial Number</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedCustomer.coveredEquipment?.map((eq, idx) => (
                          <TableRow key={eq.serialNumber || eq.assetTag || idx}>
                            <TableCell className="font-medium text-dark-slate">
                              {eq.equipmentName || eq.model}
                            </TableCell>
                            <TableCell className="text-slate-700">
                              {eq.brandAndModel || eq.model}
                            </TableCell>
                            <TableCell className="font-mono text-slate-600">
                              {eq.serialNumber}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </div>

            {/* Footer (only Store action if pending; no Close button) */}
            {selectedCustomer.ticketingIntegration?.storeStatus !== 'Stored' && (
              <div className="pt-4 border-t border-slate-100 flex justify-end gap-3">
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
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}

      {/* 7. Create User Modal (ONE UI FormModal) */}
      <FormModal
        isOpen={showCreateUserModal}
        onClose={() => setShowCreateUserModal(false)}
        onSubmit={() => createUserFormRef.current?.requestSubmit()}
        title="Create User"
        subtitle="Add a new customer profile and covered equipment record."
        icon={UserPlus}
        confirmLabel="Create User"
        cancelLabel="Cancel"
        maxWidth="max-w-xl"
      >
        <form ref={createUserFormRef} onSubmit={handleCreateUser} className="space-y-4 text-xs">
          <div>
            <label htmlFor="create-equipment-name" className="font-semibold text-slate-700 block mb-1">
              Equipment Name / Machine Name
            </label>
            <Input
              id="create-equipment-name"
              type="text"
              value={createUserForm.equipmentName}
              onChange={(e) => setCreateUserForm({ ...createUserForm, equipmentName: e.target.value })}
              placeholder="e.g. Automated Hematology Analyzer"
              className="text-xs"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="create-brand-model" className="font-semibold text-slate-700 block mb-1">
                Brand and Model
              </label>
              <Input
                id="create-brand-model"
                type="text"
                value={createUserForm.brandAndModel}
                onChange={(e) => setCreateUserForm({ ...createUserForm, brandAndModel: e.target.value })}
                placeholder="e.g. Sysmex XN-1000"
                className="text-xs"
                required
              />
            </div>

            <div>
              <label htmlFor="create-serial-number" className="font-semibold text-slate-700 block mb-1">
                Serial Number
              </label>
              <Input
                id="create-serial-number"
                type="text"
                value={createUserForm.serialNumber}
                onChange={(e) => setCreateUserForm({ ...createUserForm, serialNumber: e.target.value })}
                placeholder="e.g. SN-XN1K-44921"
                className="text-xs font-mono"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="create-customer-name" className="font-semibold text-slate-700 block mb-1">
                Customer Name
              </label>
              <Input
                id="create-customer-name"
                type="text"
                value={createUserForm.customerName}
                onChange={(e) => setCreateUserForm({ ...createUserForm, customerName: e.target.value })}
                placeholder="e.g. St. Luke's Medical Center"
                className="text-xs"
                required
              />
            </div>

            <div>
              <label htmlFor="create-customer-email" className="font-semibold text-slate-700 block mb-1">
                Customer Email
              </label>
              <Input
                id="create-customer-email"
                type="email"
                value={createUserForm.customerEmail}
                onChange={(e) => setCreateUserForm({ ...createUserForm, customerEmail: e.target.value })}
                placeholder="e.g. contact@hospital.com.ph"
                className="text-xs"
                required
              />
            </div>
          </div>

          <div>
            <label htmlFor="create-sbsi-branch" className="font-semibold text-slate-700 block mb-1">
              SBSI Branch
            </label>
            <select
              id="create-sbsi-branch"
              value={createUserForm.sbsiBranch}
              onChange={(e) => setCreateUserForm({ ...createUserForm, sbsiBranch: e.target.value })}
              className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs text-dark-slate focus:outline-none focus:ring-1 focus:ring-accent"
              required
            >
              {[
                'NCR - Main',
                'Cebu Regional Branch',
                'Davao Branch',
                'North Luzon Branch',
                'Western Visayas Branch',
                ...availableBranches.filter(
                  (b) =>
                    ![
                      'NCR - Main',
                      'Cebu Regional Branch',
                      'Davao Branch',
                      'North Luzon Branch',
                      'Western Visayas Branch',
                    ].includes(b)
                ),
              ].map((branch) => (
                <option key={branch} value={branch}>
                  {branch}
                </option>
              ))}
            </select>
          </div>
        </form>
      </FormModal>

      {/* 8. Integration Settings Modal */}
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
