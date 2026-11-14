import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Building2,
  Users,
  Clock,
  ShieldCheck,
  Smile,
  AlertTriangle,
  ArrowUpDown,
  Search,
  ChevronRight,
  UserCheck,
  AlertCircle,
  BarChart3,
  TrendingUp,
  RefreshCw,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Bar } from 'react-chartjs-2';
import { MetricCard } from '@/components/ui/metric-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { InfoTooltip } from '@/components/ui/tooltip';
import { adaptDepartmentPerformance, METRIC_DEFINITIONS } from '@/services/dashboardAnalyticsService';
import { getAdminDepartmentPerformance } from '@/services/ticketService';
import { cn } from '@/lib/utils';
import useLockBodyScroll from '@/hooks/useLockBodyScroll';

export default function DepartmentPerformanceView({
  branchName = 'your branch',
  selectedPeriod = 'Last 7 Days',
  dateFrom = null,
  dateTo = null,
  onSelectEmployee = null,
}) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState('totalTicketsHandled');
  const [sortDirection, setSortDirection] = useState('desc');
  const [selectedDeptDetail, setSelectedDeptDetail] = useState(null);
  useLockBodyScroll(Boolean(selectedDeptDetail));

  const [deptData, setDeptData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // Real, branch scoped figures from the ticket service. Read only: nothing here edits a department.
  const loadDepartments = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = { preset: selectedPeriod };
      if (selectedPeriod === 'Custom Range') {
        params.preset = 'custom';
        if (dateFrom) params.date_from = dateFrom;
        if (dateTo) params.date_to = dateTo;
      }
      const api = await getAdminDepartmentPerformance(params);
      setDeptData(adaptDepartmentPerformance(api));
    } catch (err) {
      console.error('Failed to load department performance:', err);
      setLoadError(err?.response?.data?.message || 'Department performance data is unavailable right now.');
    } finally {
      setLoading(false);
    }
  }, [selectedPeriod, dateFrom, dateTo]);

  useEffect(() => {
    loadDepartments();
  }, [loadDepartments]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const sortedDepartments = useMemo(() => {
    if (!deptData?.departments) return [];
    let list = [...deptData.departments];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((d) => d.name.toLowerCase().includes(q));
    }

    list.sort((a, b) => {
      if (!a.hasData && b.hasData) return 1;
      if (a.hasData && !b.hasData) return -1;
      if (!a.hasData && !b.hasData) return 0;

      let valA = a[sortField];
      let valB = b[sortField];
      if (typeof valA === 'string') {
        return sortDirection === 'asc'
          ? valA.localeCompare(valB)
          : valB.localeCompare(valA);
      }
      return sortDirection === 'asc' ? (valA || 0) - (valB || 0) : (valB || 0) - (valA || 0);
    });

    return list;
  }, [deptData, searchQuery, sortField, sortDirection]);

  // Workload imbalance comparison chart
  const workloadChartData = useMemo(() => {
    if (!deptData?.departments) return null;
    const activeDepts = deptData.departments.filter((d) => d.hasData);
    return {
      labels: activeDepts.map((d) => d.name),
      datasets: [
        {
          label: 'Tickets per Employee',
          data: activeDepts.map((d) => d.workloadPerEmployee),
          backgroundColor: activeDepts.map((d) =>
            d.imbalanceLevel === 'High Imbalance'
              ? 'rgba(244, 63, 94, 0.8)'
              : d.imbalanceLevel === 'Moderate'
              ? 'rgba(245, 158, 11, 0.8)'
              : 'rgba(37, 37, 120, 0.8)'
          ),
          borderRadius: 6,
          barThickness: 22,
        },
      ],
    };
  }, [deptData]);

  const branchSummary = useMemo(() => {
    const list = deptData?.departments?.filter((d) => d.hasData) || [];
    if (list.length === 0) return { totalHandled: 0, avgSla: null, totalOverdue: 0, highImbalanceCount: 0 };
    const totalHandled = list.reduce((acc, d) => acc + d.totalTicketsHandled, 0);
    // Same rule as the server (spec 0031 AC-4): met / (met + breached). No outcomes means no rate, never 0 or 100.
    const met = list.reduce((acc, d) => acc + (d.slaMet || 0), 0);
    const breached = list.reduce((acc, d) => acc + (d.slaBreached || 0), 0);
    const avgSla = met + breached > 0 ? ((met / (met + breached)) * 100).toFixed(1) : null;
    const totalOverdue = list.reduce((acc, d) => acc + d.overdueCount, 0);
    const highImbalanceCount = list.filter((d) => d.imbalanceLevel === 'High Imbalance').length;
    return { totalHandled, avgSla, totalOverdue, highImbalanceCount };
  }, [deptData]);

  if (loading && !deptData) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading department performance">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[96px] rounded-xl bg-slate-100 animate-pulse" />
          ))}
        </div>
        <div className="h-[220px] rounded-xl bg-slate-100 animate-pulse" />
      </div>
    );
  }

  if (loadError && !deptData) {
    return (
      <div role="alert" className="rounded-xl border border-destructive/30 bg-card p-6 text-center space-y-3">
        <p className="text-sm font-semibold text-destructive">Data unavailable</p>
        <p className="text-xs text-slate-muted">{loadError}</p>
        <Button size="sm" variant="outline" onClick={loadDepartments}>
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {loadError && (
        <div role="alert" className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <span>{loadError} Showing the last loaded figures.</span>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={loadDepartments}>Retry</Button>
        </div>
      )}
      {/* Top Department Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard
          title="Total Handled"
          value={branchSummary.totalHandled}
          subtitle={`Across departments (${selectedPeriod})`}
          icon={<BarChart3 className="w-4 h-4 text-accent" />}
          iconBg="bg-blue-50 text-accent"
          showTooltip={false}
        />
        <MetricCard
          title="Dept SLA Compliance"
          value={branchSummary.avgSla != null ? `${branchSummary.avgSla}%` : 'No data'}
          subtitle="Department adherence target ≥ 90%"
          icon={<ShieldCheck className="w-4 h-4 text-emerald-600" />}
          iconBg="bg-emerald-50 text-emerald-600"
          showTooltip={false}
        />
        <MetricCard
          title="Overdue / Breached"
          value={branchSummary.totalOverdue}
          subtitle="Distinguished from open tickets"
          icon={<AlertTriangle className="w-4 h-4 text-rose-600" />}
          iconBg="bg-rose-50 text-rose-600"
          variant="destructive"
          showTooltip={false}
        />
        <MetricCard
          title="Staff Imbalance"
          value={`${branchSummary.highImbalanceCount} Teams`}
          subtitle="Tickets-per-employee overload"
          icon={<Users className="w-4 h-4 text-amber-600" />}
          iconBg="bg-amber-50 text-amber-600"
          variant="amber"
          showTooltip={false}
        />
      </div>

      {/* Workload Distribution Chart: Spotting Team Imbalance */}
      <div className="bg-card rounded-xl shadow-xs border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <TrendingUp className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="text-sm font-bold text-slate-dark">Workload Distribution &amp; Team Imbalance</h3>
                <InfoTooltip content="Open tickets divided by staff in the department. The imbalance badge flags departments where one person carries 1.5x (Moderate) or 2x (High) the department average." />
              </div>
              <p className="text-[11px] text-slate-muted">
                Imbalance compares the busiest employee with the department average: red is 2x or more, amber is 1.5x or more.
              </p>
            </div>
          </div>
        </div>

        {workloadChartData && (
          <div className="h-[180px]">
            <Bar
              data={workloadChartData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    callbacks: {
                      label: (ctx) => `${ctx.raw} tickets per active employee`,
                    },
                  },
                },
                scales: {
                  x: { grid: { display: false }, ticks: { font: { family: 'Poppins', size: 10 } } },
                  y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Tickets / Staff', font: { size: 10 } },
                    ticks: { font: { size: 10 } },
                  },
                },
              }}
            />
          </div>
        )}
      </div>

      {/* Comparative Department Table */}
      <div className="bg-card rounded-xl shadow-xs border border-border p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-dark">Department Performance Comparison</h3>
            <p className="text-[11px] text-slate-muted">
              Aggregated operational quality and productivity metrics for {branchName}.
            </p>
          </div>
          <div className="relative w-full sm:w-80">
            <Search className="w-3.5 h-3.5 text-slate-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Filter department by name or lead..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-page border border-border rounded-lg text-slate-dark placeholder:text-slate-muted focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-sans">
            <thead className="bg-page border-b border-border text-slate-muted font-semibold">
              <tr>
                <th
                  onClick={() => handleSort('name')}
                  className="py-3 px-3 cursor-pointer hover:text-slate-dark transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Department</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-muted" />
                  </div>
                </th>
                <th className="py-3 px-3">Staff</th>
                <th
                  onClick={() => handleSort('totalTicketsHandled')}
                  className="py-3 px-3 cursor-pointer hover:text-slate-dark transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Handled</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-muted" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('avgResolutionTime')}
                  className="py-3 px-3 cursor-pointer hover:text-slate-dark transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Avg Resolution</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-muted" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('slaCompliance')}
                  className="py-3 px-3 cursor-pointer hover:text-slate-dark transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span>SLA Compliance</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-muted" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('avgCsat')}
                  className="py-3 px-3 cursor-pointer hover:text-slate-dark transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Avg CSAT</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-muted" />
                  </div>
                </th>
                <th className="py-3 px-3">Open / Overdue</th>
                <th className="py-3 px-3">Imbalance Level</th>
                <th className="py-3 px-3 text-right">Drill Down</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedDepartments.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-muted">
                    No departments found.
                  </td>
                </tr>
              ) : (
                sortedDepartments.map((dept) => (
                  <tr key={dept.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-3 font-semibold text-slate-dark">
                      <div>
                        <span>{dept.name}</span>
                        <span className="block text-[11px] text-slate-muted font-normal">{dept.employeeCount} staff</span>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-slate-dark font-medium">{dept.employeeCount}</td>

                    {!dept.hasData ? (
                      <td colSpan={6} className="py-3 px-3">
                        <Badge variant="medium-muted" size="sm">No data for this period</Badge>
                      </td>
                    ) : (
                      <>
                        <td className="py-3 px-3 font-medium text-slate-dark">{dept.totalTicketsHandled}</td>
                        <td className="py-3 px-3 text-slate-dark">{dept.avgResolutionTime != null ? `${dept.avgResolutionTime} hrs` : '—'}</td>
                        <td className="py-3 px-3 font-semibold">
                          <span
                            className={cn(
                              dept.slaCompliance >= 92
                                ? 'text-emerald-600'
                                : dept.slaCompliance >= 85
                                ? 'text-amber-600'
                                : 'text-rose-600'
                            )}
                          >
                            {dept.slaCompliance != null ? `${dept.slaCompliance}%` : '—'}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-amber-700 font-medium">{dept.avgCsat != null ? `★ ${dept.avgCsat}` : '—'}</td>
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-dark font-medium">{dept.openCount} Open</span>
                            <span className="text-slate-muted">/</span>
                            <span
                              className={cn(
                                'font-semibold',
                                dept.overdueCount > 0 ? 'text-rose-600' : 'text-emerald-600'
                              )}
                            >
                              {dept.overdueCount} Overdue
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <Badge
                            variant={
                              dept.imbalanceLevel === 'High Imbalance'
                                ? 'medium-destructive'
                                : dept.imbalanceLevel === 'Moderate'
                                ? 'medium-warning'
                                : 'medium-success'
                            }
                            size="sm"
                          >
                            {dept.workloadPerEmployee}/person • {dept.imbalanceLevel}
                          </Badge>
                        </td>
                      </>
                    )}

                    <td className="py-3 px-3 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedDeptDetail(dept)}
                        className="h-7 px-2.5 text-xs text-accent hover:bg-blue-50 border-blue-200"
                        title={`Inspect staff breakdown for ${dept.name}`}
                      >
                        <Users className="w-3.5 h-3.5 mr-1" />
                        Drill Down
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Department Team Drill-down Modal */}
      {selectedDeptDetail && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[1.5px] flex items-center justify-center p-4 overscroll-none" onClick={() => setSelectedDeptDetail(null)}>
          <div
            className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full max-h-[88vh] overflow-hidden flex flex-col font-sans animate-in fade-in-0 zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-slate-50/70">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#252578]/10 text-[#252578] flex items-center justify-center shrink-0">
                  <Users className="w-5 h-5 text-[#252578]" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">{selectedDeptDetail.name} Team Drill-Down</h3>
                    <span className="text-[10px] font-bold text-[#252578] bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                      {selectedDeptDetail.employees.length} Staff
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">Technician active workload contribution &amp; SLA compliance.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDeptDetail(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer"
                aria-label="Close dialog"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              {/* Executive KPI Cards */}
              <div className="grid grid-cols-3 gap-2.5">
                <div className="bg-slate-50 border border-slate-200/90 p-3 rounded-xl text-center">
                  <span className="text-slate-500 block text-[10px] font-bold uppercase tracking-wider">Total Handled</span>
                  <strong className="text-slate-900 text-base font-bold mt-0.5 block">{selectedDeptDetail.totalTicketsHandled}</strong>
                  <span className="text-[10px] text-slate-400">tickets</span>
                </div>
                <div className="bg-emerald-50/70 border border-emerald-200/90 p-3 rounded-xl text-center">
                  <span className="text-emerald-700 block text-[10px] font-bold uppercase tracking-wider">SLA Adherence</span>
                  <strong className="text-emerald-700 text-base font-bold mt-0.5 block">
                    {selectedDeptDetail.slaCompliance != null ? `${selectedDeptDetail.slaCompliance}%` : '—'}
                  </strong>
                  <span className="text-[10px] text-emerald-600 font-medium">target ≥ 90%</span>
                </div>
                <div className="bg-rose-50/70 border border-rose-200/90 p-3 rounded-xl text-center">
                  <span className="text-rose-700 block text-[10px] font-bold uppercase tracking-wider">Overdue Breached</span>
                  <strong className="text-rose-700 text-base font-bold mt-0.5 block">{selectedDeptDetail.overdueCount}</strong>
                  <span className="text-[10px] text-rose-600 font-medium">breaches</span>
                </div>
              </div>

              {/* Staff Workload List */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Technician Workload Breakdown ({selectedDeptDetail.employees.length})
                  </h4>
                  <span className="text-[11px] text-slate-500">Active Work Share</span>
                </div>

                <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white max-h-64 overflow-y-auto">
                  {selectedDeptDetail.employees.length === 0 && (
                    <div className="p-6 text-center text-slate-400 text-xs">
                      No staff are registered in this department.
                    </div>
                  )}
                  {selectedDeptDetail.employees.map((emp) => {
                    const initials = (emp.name || '')
                      .split(' ')
                      .map((n) => n[0])
                      .slice(0, 2)
                      .join('')
                      .toUpperCase() || 'EM';

                    return (
                      <div key={emp.id} className="p-3 flex items-center justify-between hover:bg-slate-50/80 transition-colors">
                        <div className="min-w-0 flex-1 pr-3 flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center shrink-0">
                            {initials}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-xs text-slate-900 truncate">{emp.name}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <div className="h-1.5 flex-1 rounded-full bg-slate-100 overflow-hidden" aria-hidden="true">
                                <div className="h-full bg-[#252578] rounded-full transition-all" style={{ width: `${Math.min(100, emp.share)}%` }} />
                              </div>
                              <span className="text-[10px] text-slate-500 font-semibold shrink-0">
                                {emp.activeTickets} open • {emp.share}%
                              </span>
                            </div>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedDeptDetail(null);
                            if (typeof onSelectEmployee === 'function') {
                              onSelectEmployee(emp);
                            } else {
                              navigate('/admin/dashboard?tab=employees', { state: { tab: 'employees', selectedEmployee: emp } });
                            }
                          }}
                          className="h-7 px-2.5 text-xs text-[#252578] hover:text-[#1d1d60] hover:bg-blue-50 font-semibold rounded-lg transition-colors cursor-pointer shrink-0"
                        >
                          Performance Record →
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-between items-center px-6 py-3.5 border-t border-slate-200 bg-slate-50/80">
              <span className="text-[11px] text-slate-500 font-medium">Scoped to {branchName}</span>
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => setSelectedDeptDetail(null)}
                className="bg-[#252578] hover:bg-[#1d1d60] text-white text-xs font-semibold px-4 h-8 rounded-lg cursor-pointer shadow-xs"
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

