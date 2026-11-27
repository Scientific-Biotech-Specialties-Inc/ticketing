import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Building2,
  Search,
  X,
  Eye,
  Cpu,
  Download,
  UserPlus,
  AlertTriangle,
  UserCheck,
} from 'lucide-react';

import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { DataTableSkeleton } from '@/components/ui/skeleton';
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
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { FormModal } from '@/components/ui/form-modal';
import { ConfirmationModal } from '@/components/ui/confirmation-modal';
import Pagination from '@/components/Pagination';
import { useToast } from '@/context/ToastContext';
import { useBranch } from '@/context/BranchContext';
import {
  listCustomers,
  searchOrganizations,
  checkCustomer,
  createCustomerItem,
} from '@/services/superadminCustomerService';

const SEARCH_DEBOUNCE_MS = 300;
const UNAVAILABLE = 'Unavailable';

const TYPE_LABEL = { service: 'Service', software: 'Software' };
const CONTRACT_LABEL = { active: 'Active', expired: 'Expired', none: 'No Contract' };
const CONTRACT_VARIANT = { active: 'medium-success', expired: 'medium-destructive', none: 'medium-muted' };

/** The header branch, when one specific branch is selected (not All Branches). */
function headerBranchSlug(selectedBranch, isAllBranches, GLOBAL_BRANCH) {
  if (isAllBranches || !selectedBranch || selectedBranch === GLOBAL_BRANCH) return '';
  return String(selectedBranch.slug || selectedBranch.id || '');
}

function emptyForm(branchSlug) {
  return {
    assetType: 'equipment',
    itemName: '',
    brand: '',
    serialNumber: '',
    email: '',
    branchId: branchSlug,
  };
}

function errorMessage(err, fallback) {
  return err?.response?.data?.message || fallback;
}

export default function SuperAdminCMSIntegration() {
  const toast = useToast();
  const { branches, selectedBranch, isAllBranches, GLOBAL_BRANCH } = useBranch();
  const branchScope = headerBranchSlug(selectedBranch, isAllBranches, GLOBAL_BRANCH);

  // List state
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [directoryAvailable, setDirectoryAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedRow, setSelectedRow] = useState(null);

  // Filters & pagination (all run on the server)
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterContractStatus, setFilterContractStatus] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Create User modal
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const createUserFormRef = useRef(null);
  const [form, setForm] = useState(() => emptyForm(branchScope));
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  // Customer Name (hospital) combobox
  const [hospitalText, setHospitalText] = useState('');
  const [hospital, setHospital] = useState(null); // { id, name } existing, or { isNew: true, name }
  const [hospitalQuery, setHospitalQuery] = useState('');
  const [hospitalOptions, setHospitalOptions] = useState([]);
  const [hospitalLoading, setHospitalLoading] = useState(false);

  // Duplicate check modals
  const [existingAccount, setExistingAccount] = useState(null);
  const [sameHospital, setSameHospital] = useState(null);

  // Only active branches from the auth module (BranchContext), labelled by name, valued by slug.
  const branchOptions = useMemo(
    () =>
      (branches || [])
        .filter((b) => b && b.is_active !== false && b.is_active !== 0)
        .map((b) => ({ slug: String(b.slug || b.id), name: b.name })),
    [branches]
  );

  // Debounce the list search.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Back to page 1 whenever the scope or filters change.
  useEffect(() => {
    setCurrentPage(1);
  }, [branchScope, debouncedSearch, filterType, filterContractStatus, pageSize]);

  // Load the list from the server.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listCustomers({
      search: debouncedSearch,
      type: filterType,
      contract_status: filterContractStatus,
      branch_id: branchScope,
      page: currentPage,
      per_page: pageSize,
    })
      .then(({ rows: data, meta }) => {
        if (cancelled) return;
        setRows(data);
        setTotal(meta.total || 0);
        setDirectoryAvailable(meta.directory_available !== false);
      })
      .catch((err) => {
        if (cancelled) return;
        setRows([]);
        setTotal(0);
        toast.error(errorMessage(err, 'Could not load customers. Please try again.'), 'LOAD FAILED');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchScope, debouncedSearch, filterType, filterContractStatus, currentPage, pageSize, reloadKey]);

  // Debounced hospital search for the combobox.
  useEffect(() => {
    const text = hospitalQuery.trim();
    if (!text) {
      setHospitalOptions([]);
      setHospitalLoading(false);
      return undefined;
    }
    setHospitalLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchOrganizations(text, { limit: 20, signal: controller.signal })
        .then((data) => setHospitalOptions(data))
        .catch((err) => {
          if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return;
          setHospitalOptions([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setHospitalLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [hospitalQuery]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (filterType !== 'all') count++;
    if (filterContractStatus !== 'all') count++;
    if (searchTerm.trim()) count++;
    return count;
  }, [filterType, filterContractStatus, searchTerm]);

  const handleClearFilters = () => {
    setSearchTerm('');
    setFilterType('all');
    setFilterContractStatus('all');
  };

  const handleExportJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(rows, null, 2));
    const anchor = document.createElement('a');
    anchor.setAttribute('href', dataStr);
    anchor.setAttribute('download', `customers_export_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    toast.success(`Exported ${rows.length} loaded customer item(s) to JSON.`, 'EXPORT COMPLETE');
  };

  // ── Create User ────────────────────────────────────────────────────────────
  const isSoftware = form.assetType === 'software';
  const itemNoun = isSoftware ? 'Software' : 'Service item';

  const resetCreateForm = useCallback(() => {
    setForm(emptyForm(branchScope));
    setFieldErrors({});
    setHospitalText('');
    setHospital(null);
    setHospitalQuery('');
    setHospitalOptions([]);
    setExistingAccount(null);
    setSameHospital(null);
  }, [branchScope]);

  const openCreateModal = () => {
    resetCreateForm();
    setShowCreateUserModal(true);
  };

  const closeCreateModal = () => {
    if (submitting) return;
    setShowCreateUserModal(false);
  };

  const updateForm = (patch) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      Object.keys(patch).forEach((k) => delete next[k]);
      return next;
    });
  };

  const hospitalPayload = () =>
    hospital && !hospital.isNew ? { organization_id: hospital.id } : { organization_name: hospital?.name || '' };

  const validate = () => {
    const errors = {};
    if (!form.itemName.trim()) errors.itemName = isSoftware ? 'Software Name is required.' : 'Equipment Name is required.';
    if (!isSoftware && !form.brand.trim()) errors.brand = 'Brand and Model is required.';
    if (!isSoftware && !form.serialNumber.trim()) errors.serialNumber = 'Serial Number is required.';
    if (!hospital) errors.hospital = 'Choose a hospital from the list or add a new one.';
    if (!form.email.trim()) errors.email = 'Customer Email is required.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = 'Enter a valid email address.';
    if (!form.branchId) errors.branchId = 'Choose an SBSI branch.';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleConflict = (data) => {
    switch (data?.code) {
      case 'email_exists':
        setSameHospital(null);
        setExistingAccount(data.account || null);
        return true;
      case 'hospital_has_accounts':
        setExistingAccount(null);
        setSameHospital({ organization: data.organization, accounts: data.accounts || [] });
        return true;
      case 'serial_taken':
        setExistingAccount(null);
        setSameHospital(null);
        setFieldErrors((prev) => ({ ...prev, serialNumber: data.message }));
        return true;
      case 'attach_mismatch':
        setExistingAccount(null);
        toast.error('That email no longer belongs to the selected account. Please submit again.', 'ACCOUNT CHANGED');
        return true;
      default:
        return false;
    }
  };

  const submitItem = async (mode, extra = {}) => {
    setSubmitting(true);
    try {
      const payload = {
        asset_type: form.assetType,
        item_name: form.itemName.trim(),
        brand: form.brand.trim() || null,
        serial_number: isSoftware ? null : form.serialNumber.trim(),
        branch_id: form.branchId,
        email: form.email.trim(),
        mode,
        ...(mode === 'new' ? hospitalPayload() : {}),
        ...extra,
      };
      const res = await createCustomerItem(payload);
      const hospitalName = res?.item?.hospital_name || hospital?.name || 'the customer';
      toast.success(
        res?.account_status === 'attached'
          ? `Added the ${itemNoun.toLowerCase()} to the existing account for ${hospitalName}.`
          : `Created a new account for ${hospitalName}.`,
        res?.account_status === 'attached' ? 'ITEM ADDED' : 'ACCOUNT CREATED'
      );
      setExistingAccount(null);
      setSameHospital(null);
      setShowCreateUserModal(false);
      resetCreateForm();
      setReloadKey((k) => k + 1);
    } catch (err) {
      const status = err?.response?.status;
      const data = err?.response?.data;
      if (status === 409 && handleConflict(data)) return;
      setExistingAccount(null);
      setSameHospital(null);
      if (status === 422 && data?.errors) {
        const map = { item_name: 'itemName', brand: 'brand', serial_number: 'serialNumber', email: 'email', branch_id: 'branchId', organization_name: 'hospital', organization_id: 'hospital' };
        const errors = {};
        Object.entries(data.errors).forEach(([key, messages]) => {
          if (map[key]) errors[map[key]] = Array.isArray(messages) ? messages[0] : String(messages);
        });
        setFieldErrors((prev) => ({ ...prev, ...errors }));
        toast.error('Please fix the highlighted fields.', 'CHECK THE FORM');
        return;
      }
      toast.error(errorMessage(err, 'Customer service is unavailable, please try again.'), 'SAVE FAILED');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    if (submitting || !validate()) return;

    setSubmitting(true);
    let result;
    try {
      result = await checkCustomer({ email: form.email.trim(), ...hospitalPayload() });
    } catch (err) {
      setSubmitting(false);
      toast.error(errorMessage(err, 'Customer service is unavailable, please try again.'), 'CHECK FAILED');
      return;
    }
    setSubmitting(false);

    if (result?.email_match) {
      setExistingAccount(result.email_match);
      return;
    }
    if (Array.isArray(result?.organization_accounts) && result.organization_accounts.length > 0) {
      setSameHospital({ organization: result.organization, accounts: result.organization_accounts });
      return;
    }
    await submitItem('new');
  };

  const handleHospitalSelect = (choice) => {
    if (choice.isNew) {
      setHospital({ isNew: true, name: choice.name });
      setHospitalText(choice.name);
    } else {
      setHospital({ id: choice.option.id, name: choice.option.name });
      setHospitalText(choice.option.name);
    }
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.hospital;
      return next;
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const cell = (value) => (value === null || value === undefined || value === '' ? '—' : value);
  const directoryCell = (value) => (directoryAvailable ? cell(value) : UNAVAILABLE);

  return (
    <div className="w-full space-y-6 pb-12 font-sans">
      <PageHeader
        title="Customers"
        subtitle="Customer accounts and the service and software items they can report problems on."
        showClock={false}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportJson}
              disabled={loading || rows.length === 0}
              className="border-slate-300 text-dark-slate hover:bg-slate-100 h-9 px-4 gap-2"
            >
              <Download className="w-4 h-4 text-muted-slate" />
              Export JSON
            </Button>
            <Button variant="default" size="sm" onClick={openCreateModal} className="h-9 px-4 gap-2">
              <UserPlus className="w-4 h-4" />
              Create User
            </Button>
          </div>
        }
      />

      {/* Search and filters */}
      <div className="bg-surface rounded-2xl border border-slate-200/80 p-4 sm:p-6 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-slate" />
            <Input
              type="text"
              aria-label="Search customers"
              placeholder="Search by hospital, email, item name, or serial number..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 h-10 w-full text-sm rounded-xl"
            />
            {searchTerm && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearchTerm('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-slate hover:text-dark-slate"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          {activeFiltersCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearFilters}
              className="text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700 h-10 px-4 self-end lg:self-auto"
            >
              <X className="w-4 h-4 mr-2" />
              Clear Filters ({activeFiltersCount})
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
          <div>
            <label htmlFor="filter-type" className="text-xs font-semibold text-slate-600 mb-2 block">Type</label>
            <select
              id="filter-type"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="w-full h-10 rounded-lg border border-slate-200 bg-white px-2 text-xs text-dark-slate focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="all">All Types</option>
              <option value="service">Service</option>
              <option value="software">Software</option>
            </select>
          </div>
          <div>
            <label htmlFor="filter-contract-status" className="text-xs font-semibold text-slate-600 mb-2 block">Contract Status</label>
            <select
              id="filter-contract-status"
              value={filterContractStatus}
              onChange={(e) => setFilterContractStatus(e.target.value)}
              className="w-full h-10 rounded-lg border border-slate-200 bg-white px-2 text-xs text-dark-slate focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="all">All Contract Statuses</option>
              <option value="active">Active</option>
              <option value="expired">Expired</option>
              <option value="none">No Contract</option>
            </select>
          </div>
        </div>
      </div>

      {/* Customer items table */}
      <div className="bg-surface rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-dark-slate">Customer Items</h2>
            <p className="text-xs text-muted-slate">
              {loading ? 'Loading…' : `Showing ${rows.length} of ${total} items`}
              {!isAllBranches && selectedBranch?.name ? ` • ${selectedBranch.name}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-slate">
            <span>Rows per page:</span>
            <select
              aria-label="Rows per page"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-dark-slate focus:outline-none"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
          </div>
        </div>

        {!directoryAvailable && !loading && (
          <div className="px-6 py-2 text-xs text-amber-900 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            Customer service is unavailable, so hospital and email are not shown right now.
          </div>
        )}

        {loading ? (
          <div className="p-6" data-testid="customers-skeleton">
            <DataTableSkeleton columns={6} rows={pageSize > 10 ? 8 : 5} />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center">
            <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-base font-semibold text-dark-slate">No Customer Items Found</h3>
            <p className="text-xs text-muted-slate max-w-md mx-auto mt-2">
              {activeFiltersCount > 0
                ? 'No items match your search or filters. Try clearing them.'
                : 'No customer items yet. Use Create User to add the first one.'}
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
                <TableHead>Hospital / Account</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Serial Number</TableHead>
                <TableHead>SBSI Branch</TableHead>
                <TableHead>Contract Status</TableHead>
                <TableHead className="w-[64px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.machine_id} className="hover:bg-slate-50/70 transition-colors">
                  <TableCell>
                    <div className="font-semibold text-sm text-dark-slate">{directoryCell(row.hospital_name)}</div>
                    <div className="text-xs text-muted-slate truncate max-w-[240px]" title={row.email || ''}>
                      {directoryCell(row.email)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium text-dark-slate">{row.item_name}</div>
                    {row.brand && <div className="text-xs text-muted-slate">{row.brand}</div>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.type === 'software' ? 'medium-violet' : 'medium-info'} size="sm">
                      {TYPE_LABEL[row.type] || row.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-slate-600">{row.type === 'software' ? '' : cell(row.serial_number)}</TableCell>
                  <TableCell className="text-xs text-slate-700">{cell(row.branch_name || row.branch_id)}</TableCell>
                  <TableCell>
                    <Badge variant={CONTRACT_VARIANT[row.contract_status] || 'medium-muted'} size="sm">
                      {CONTRACT_LABEL[row.contract_status] || row.contract_status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedRow(row)}
                      className="h-8 w-8 p-0 text-slate-500 hover:text-accent hover:bg-blue-50"
                      title="View details"
                      aria-label={`View details for ${row.item_name}`}
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {!loading && total > 0 && (
          <div className="px-6 py-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-xs text-muted-slate">
              Showing page <span className="font-semibold text-dark-slate">{currentPage}</span> of{' '}
              <span className="font-semibold text-dark-slate">{totalPages}</span> ({total} total items)
            </div>
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={total}
              itemsPerPage={pageSize}
              onPageChange={setCurrentPage}
            />
          </div>
        )}
      </div>

      {/* Item detail modal */}
      {selectedRow && (
        <Dialog open={!!selectedRow} onOpenChange={(open) => !open && setSelectedRow(null)}>
          <DialogContent className="max-w-2xl w-[95vw] p-6 font-sans rounded-2xl bg-white border border-slate-200/80 shadow-2xl">
            <div className="flex items-start gap-4 pb-4 border-b border-slate-100">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-50 text-accent">
                <Building2 className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0 pr-6">
                <DialogTitle className="text-xl font-bold text-dark-slate">{directoryCell(selectedRow.hospital_name)}</DialogTitle>
                <DialogDescription className="text-xs text-muted-slate">
                  {directoryCell(selectedRow.email)} • {cell(selectedRow.branch_name || selectedRow.branch_id)}
                </DialogDescription>
              </div>
            </div>

            <div className="py-2 max-h-[65vh] overflow-y-auto space-y-4 text-xs">
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-4">
                <h4 className="font-bold text-dark-slate text-sm flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-accent" />
                  {TYPE_LABEL[selectedRow.type] || 'Item'} Details
                </h4>
                <dl className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    [selectedRow.type === 'software' ? 'Software Name' : 'Equipment Name', selectedRow.item_name],
                    [selectedRow.type === 'software' ? 'Vendor / Version' : 'Brand and Model', selectedRow.brand],
                    ...(selectedRow.type === 'software' ? [] : [['Serial Number', selectedRow.serial_number]]),
                    ['Type', TYPE_LABEL[selectedRow.type]],
                    ['SBSI Branch', selectedRow.branch_name || selectedRow.branch_id],
                    ['Contract Status', CONTRACT_LABEL[selectedRow.contract_status]],
                    ['Contract Code', selectedRow.contract_code],
                    ['Contract End Date', selectedRow.contract_end_date],
                    ['Added', selectedRow.created_at ? new Date(selectedRow.created_at).toLocaleDateString() : null],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-muted-slate">{label}</dt>
                      <dd className="font-medium text-dark-slate break-words">{cell(value)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Create User modal */}
      <FormModal
        isOpen={showCreateUserModal}
        onClose={closeCreateModal}
        onSubmit={() => createUserFormRef.current?.requestSubmit()}
        title="Create User"
        subtitle="Add a customer account and the item they will report problems on."
        icon={UserPlus}
        confirmLabel="Create User"
        cancelLabel="Cancel"
        loading={submitting}
        maxWidth="max-w-xl"
      >
        <form ref={createUserFormRef} onSubmit={handleCreateUser} noValidate className="space-y-4 text-xs">
          <div>
            <label htmlFor="create-type" className="font-semibold text-slate-700 block mb-2">Type</label>
            <select
              id="create-type"
              value={form.assetType}
              onChange={(e) => updateForm({ assetType: e.target.value, serialNumber: '' })}
              className="w-full h-10 rounded-lg border border-slate-200 bg-white px-4 text-xs text-dark-slate focus:outline-none focus:ring-1 focus:ring-accent"
              required
            >
              <option value="equipment">Service</option>
              <option value="software">Software</option>
            </select>
          </div>

          <Field id="create-item-name" label={isSoftware ? 'Software Name' : 'Equipment Name'} error={fieldErrors.itemName}>
            <Input
              id="create-item-name"
              type="text"
              value={form.itemName}
              onChange={(e) => updateForm({ itemName: e.target.value })}
              placeholder={isSoftware ? 'e.g. Laboratory Information System' : 'e.g. Automated Hematology Analyzer'}
              className="text-xs"
              error={!!fieldErrors.itemName}
              aria-invalid={!!fieldErrors.itemName}
              required
            />
          </Field>

          <div className={isSoftware ? '' : 'grid grid-cols-1 sm:grid-cols-2 gap-4'}>
            <Field id="create-brand" label={isSoftware ? 'Vendor / Version (optional)' : 'Brand and Model'} error={fieldErrors.brand}>
              <Input
                id="create-brand"
                type="text"
                value={form.brand}
                onChange={(e) => updateForm({ brand: e.target.value })}
                placeholder={isSoftware ? 'e.g. LabSoft 4.2' : 'e.g. Sysmex XN-1000'}
                className="text-xs"
                error={!!fieldErrors.brand}
                aria-invalid={!!fieldErrors.brand}
                required={!isSoftware}
              />
            </Field>

            {!isSoftware && (
              <Field id="create-serial-number" label="Serial Number" error={fieldErrors.serialNumber}>
                <Input
                  id="create-serial-number"
                  type="text"
                  value={form.serialNumber}
                  onChange={(e) => updateForm({ serialNumber: e.target.value })}
                  placeholder="e.g. SN-XN1K-44921"
                  className="text-xs font-mono"
                  error={!!fieldErrors.serialNumber}
                  aria-invalid={!!fieldErrors.serialNumber}
                  required
                />
              </Field>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field id="create-customer-name" label="Customer Name" error={fieldErrors.hospital}>
              <Combobox
                id="create-customer-name"
                value={hospitalText}
                onInputChange={(text) => {
                  setHospitalText(text);
                  setHospital(null);
                }}
                onSearch={setHospitalQuery}
                options={hospitalOptions}
                loading={hospitalLoading}
                onSelect={handleHospitalSelect}
                renderOption={(o) => (
                  <span className="flex items-center justify-between gap-2">
                    <span>{o.name}</span>
                    <span className="text-muted-slate">{o.account_count} account{o.account_count === 1 ? '' : 's'}</span>
                  </span>
                )}
                createLabel={(text) => `Add new hospital: ${text}`}
                placeholder="Search hospitals, e.g. St. Luke's"
                className="text-xs"
                error={!!fieldErrors.hospital}
                aria-invalid={!!fieldErrors.hospital}
              />
            </Field>

            <Field id="create-customer-email" label="Customer Email" error={fieldErrors.email}>
              <Input
                id="create-customer-email"
                type="email"
                value={form.email}
                onChange={(e) => updateForm({ email: e.target.value })}
                placeholder="e.g. contact@hospital.com.ph"
                className="text-xs"
                error={!!fieldErrors.email}
                aria-invalid={!!fieldErrors.email}
                required
              />
            </Field>
          </div>

          <Field id="create-sbsi-branch" label="SBSI Branch" error={fieldErrors.branchId}>
            <select
              id="create-sbsi-branch"
              value={form.branchId}
              onChange={(e) => updateForm({ branchId: e.target.value })}
              aria-invalid={!!fieldErrors.branchId}
              className="w-full h-10 rounded-lg border border-slate-200 bg-white px-4 text-xs text-dark-slate focus:outline-none focus:ring-1 focus:ring-accent"
              required
            >
              <option value="" disabled>
                Select a branch
              </option>
              {branchOptions.map((b) => (
                <option key={b.slug} value={b.slug}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
        </form>
      </FormModal>

      {/* Existing Account modal: the email already has an account */}
      <ConfirmationModal
        isOpen={!!existingAccount}
        onClose={() => !submitting && setExistingAccount(null)}
        onConfirm={() =>
          submitItem('attach', { attach_client_id: existingAccount?.client_id })
        }
        title="This is an existing account"
        description={
          existingAccount
            ? `Should we add this ${itemNoun} to ${existingAccount.client_name} (${existingAccount.email})?`
            : ''
        }
        confirmLabel="Add to this account"
        cancelLabel="Cancel"
        variant="primary"
        icon={<UserCheck className="h-6 w-6" />}
        loading={submitting}
      >
        {existingAccount && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-left text-xs space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-dark-slate">{existingAccount.client_name}</span>
              {existingAccount.status === 'inactive' && (
                <Badge variant="medium-muted" size="sm">Inactive</Badge>
              )}
            </div>
            <div className="text-muted-slate break-all">{existingAccount.email}</div>
          </div>
        )}
      </ConfirmationModal>

      {/* Same hospital warning: a new email for a hospital that already has accounts */}
      <ConfirmationModal
        isOpen={!!sameHospital}
        onClose={() => !submitting && setSameHospital(null)}
        onConfirm={() => submitItem('new', { confirm_same_hospital: true })}
        title={sameHospital?.organization?.name || hospital?.name || 'Existing hospital'}
        description={
          sameHospital
            ? `This hospital already has ${sameHospital.accounts.length} account(s). Create another account for it?`
            : ''
        }
        confirmLabel="Continue"
        cancelLabel="Go back"
        variant="warning"
        loading={submitting}
      >
        {sameHospital && (
          <ul className="mt-4 max-h-40 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-4 text-left text-xs space-y-2">
            {sameHospital.accounts.map((a) => (
              <li key={a.client_id} className="text-dark-slate break-all">{a.email}</li>
            ))}
          </ul>
        )}
      </ConfirmationModal>
    </div>
  );
}

function Field({ id, label, error, children }) {
  return (
    <div>
      <label htmlFor={id} className="font-semibold text-slate-700 block mb-2">
        {label}
      </label>
      {children}
      {error && (
        <p className="text-xs text-destructive mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
