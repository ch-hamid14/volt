import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, DatePicker, Select, Typography } from 'antd'
import type { TimeRangePickerProps } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { FaCartShopping, FaSackDollar, FaWarehouse } from 'react-icons/fa6'
import { GiReceiveMoney } from 'react-icons/gi'
import { IoStatsChart, IoTrendingDown, IoTrendingUp } from 'react-icons/io5'
import { MdOutlineInventory2 } from 'react-icons/md'
import { dashboardAPI, partAPI, productAPI, supplierAPI, branchAPI } from '@/renderer/services'
import { useSession } from '@/renderer/hooks/useSession'
import { formatCompact, formatCompactAxis, formatCompactRs, formatRs, PageHeader } from '../shared/page-ui'
import './dashboard.scss'

const { Text } = Typography
const { RangePicker } = DatePicker

const CHART_COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4']

/** Far-past start used by the "All" preset so queries include every record. */
const ALL_TIME_START = dayjs('2000-01-01').startOf('day')

const rangePresets: TimeRangePickerProps['presets'] = [
  { label: 'All', value: [ALL_TIME_START, dayjs().endOf('day')] },
  { label: 'Today', value: [dayjs().startOf('day'), dayjs().endOf('day')] },
  { label: 'Last 7 Days', value: [dayjs().subtract(6, 'day').startOf('day'), dayjs().endOf('day')] },
  { label: 'This Month', value: [dayjs().startOf('month'), dayjs().endOf('day')] },
  { label: 'Last Month', value: [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')] },
  { label: 'This Year', value: [dayjs().startOf('year'), dayjs().endOf('day')] }
]

type DashboardData = {
  period: { from: string; to: string }
  kpis: Record<string, number>
  profitLoss: {
    revenue: number
    cogs: number
    grossProfit: number
    grossMarginPercent: number
    expenses: number
    netProfit: number
    netMarginPercent: number
  }
  insights: Record<string, number>
  trend: { date: string; sales: number; purchases: number; expenses: number; profit: number }[]
  topProducts: { name: string; units: number; revenue: number }[]
  expensesByCategory: { category: string; amount: number }[]
}

function profitClass(value: number): string {
  if (value > 0) return 'profit-positive'
  if (value < 0) return 'profit-negative'
  return ''
}

function ChartBox({
  compact,
  children
}: {
  compact?: boolean
  children: React.ReactElement
}) {
  return (
    <div className={`dashboard-chart-box ${compact ? 'dashboard-chart-box--compact' : ''}`}>
      <ResponsiveContainer width="100%" height="100%" debounce={150}>
        {children}
      </ResponsiveContainer>
    </div>
  )
}

function KpiCard({
  label,
  amount,
  displayValue,
  meta,
  icon,
  iconBg,
  loading,
  valueClass
}: {
  label: string
  amount?: number
  displayValue?: string
  meta?: string
  icon: React.ReactNode
  iconBg: string
  loading?: boolean
  valueClass?: string
}) {
  const value = displayValue ?? formatCompactRs(amount)
  const tooltip = displayValue ? String(amount ?? 0) : formatRs(amount)
  return (
    <Card bordered={false} className="dashboard-kpi shadow-sm" loading={loading}>
      <div className="dashboard-kpi-body">
        <div className="dashboard-kpi-icon" style={{ background: iconBg }}>
          {icon}
        </div>
        <div className="dashboard-kpi-content">
          <div className="dashboard-kpi-label">{label}</div>
          <div className={`dashboard-kpi-value ${valueClass || ''}`} title={tooltip}>{value}</div>
          {meta && <div className="dashboard-kpi-meta" title={meta}>{meta}</div>}
        </div>
      </div>
    </Card>
  )
}

function PlRow({
  label,
  amount,
  muted,
  total,
  sub,
  valueClass
}: {
  label: string
  amount: number
  muted?: boolean
  total?: boolean
  sub?: boolean
  valueClass?: string
}) {
  const prefix = muted && amount !== 0 ? '− ' : ''
  const formatted = `${prefix}${formatCompactRs(Math.abs(amount))}`
  return (
    <div className={`dashboard-pl-row ${total ? 'dashboard-pl-row--total' : ''} ${sub ? 'dashboard-pl-row--sub' : ''}`}>
      <span>{label}</span>
      <span className={valueClass || ''} title={formatRs(amount)}>{formatted}</span>
    </div>
  )
}

export const Dashboard = () => {
  const { companyId, branchId, user, branchName, canSwitchBranch } = useSession()
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<DashboardData | null>(null)
  const [suppliers, setSuppliers] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [parts, setParts] = useState<any[]>([])
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
  const [filterBranchId, setFilterBranchId] = useState<string>()
  const [supplierId, setSupplierId] = useState<string>()
  const [productId, setProductId] = useState<string>()
  const [partId, setPartId] = useState<string>()
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    ALL_TIME_START,
    dayjs().endOf('day')
  ])
  const [refreshKey, setRefreshKey] = useState(0)
  const requestIdRef = useRef(0)

  const from = dateRange[0].format('YYYY-MM-DD')
  const to = dateRange[1].format('YYYY-MM-DD')
  const isAllTime = dateRange[0].isSame(ALL_TIME_START, 'day')
  const analyticsBranchId = canSwitchBranch ? filterBranchId : branchId
  const selectedBranchName = analyticsBranchId
    ? branches.find((b) => b.id === analyticsBranchId)?.name || branchName
    : undefined

  useEffect(() => {
    if (!companyId) return
    supplierAPI.list(companyId).then(setSuppliers)
    productAPI.list(companyId).then(setProducts)
    partAPI.list(companyId).then(setParts)
  }, [companyId])

  useEffect(() => {
    if (!companyId || !canSwitchBranch) return
    branchAPI.list(companyId).then((rows: { id: string; name: string }[]) => {
      setBranches((rows || []).map((b) => ({ id: b.id, name: b.name })))
    }).catch(() => setBranches([]))
  }, [companyId, canSwitchBranch])

  useEffect(() => {
    if (!companyId) return
    if (!canSwitchBranch && !branchId) return

    const requestId = ++requestIdRef.current
    setLoading(true)

    dashboardAPI
      .analytics(companyId, analyticsBranchId, { from, to, supplierId, productId, partId })
      .then((res) => {
        if (requestId === requestIdRef.current) setData(res as DashboardData)
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false)
      })
  }, [companyId, analyticsBranchId, canSwitchBranch, branchId, from, to, supplierId, productId, partId, refreshKey])

  const supplierOptions = useMemo(
    () => suppliers.map((s) => ({ value: s.id, label: s.name })),
    [suppliers]
  )
  const productOptions = useMemo(
    () => products.map((p) => ({ value: p.id, label: p.name })),
    [products]
  )
  const partOptions = useMemo(
    () => parts.map((p) => ({ value: p.id, label: p.name })),
    [parts]
  )

  const kpis = data?.kpis || {}
  const pl = data?.profitLoss
  const insights = data?.insights || {}
  const trend = data?.trend || []
  const topProducts = data?.topProducts || []
  const expensesByCategory = data?.expensesByCategory || []

  const chartTrend = useMemo(
    () =>
      trend.map((row) => ({
        ...row,
        label: dayjs(row.date).format('DD MMM')
      })),
    [trend]
  )

  const periodLabel = data
    ? isAllTime
      ? 'All time'
      : `${dayjs(data.period.from).format('DD MMM YYYY')} – ${dayjs(data.period.to).format('DD MMM YYYY')}`
    : ''

  const topProductChartHeight = useMemo(
    () => Math.max(220, topProducts.length * 52),
    [topProducts.length]
  )

  return (
    <div className="dashboard">
      <PageHeader
        title={`Welcome, ${user?.firstName || 'User'}`}
        subtitle={
          canSwitchBranch
            ? analyticsBranchId
              ? `${selectedBranchName || 'Branch'} analytics overview`
              : 'Company-wide analytics overview'
            : branchName
              ? `${branchName} analytics overview`
              : 'Branch analytics overview'
        }
      />

      <div className="dashboard-toolbar">
        <RangePicker
          className="dashboard-toolbar-dates"
          value={dateRange}
          presets={rangePresets}
          allowClear={false}
          format={isAllTime ? [() => 'All', () => ''] : 'YYYY-MM-DD'}
          separator={isAllTime ? '' : '-'}
          onChange={(v) => {
            if (v?.[0] && v?.[1]) setDateRange([v[0].startOf('day'), v[1].endOf('day')])
          }}
        />
        {canSwitchBranch && (
          <Select
            className="dashboard-toolbar-select"
            showSearch
            optionFilterProp="label"
            placeholder="Branch"
            options={[
              { value: '', label: 'All' },
              ...branches.map((b) => ({ value: b.id, label: b.name }))
            ]}
            value={filterBranchId || ''}
            onChange={(v) => setFilterBranchId(v || undefined)}
          />
        )}
        <Select
          className="dashboard-toolbar-select"
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Supplier"
          options={supplierOptions}
          value={supplierId}
          onChange={setSupplierId}
        />
        <Select
          className="dashboard-toolbar-select"
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Product"
          options={productOptions}
          value={productId}
          onChange={setProductId}
        />
        <Select
          className="dashboard-toolbar-select"
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Part"
          options={partOptions}
          value={partId}
          onChange={setPartId}
        />
        <div className="dashboard-toolbar-actions">
          <Button
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => setRefreshKey((k) => k + 1)}
          >
            Refresh
          </Button>
          <Button
            onClick={() => {
              setSupplierId(undefined)
              setProductId(undefined)
              setPartId(undefined)
              if (canSwitchBranch) setFilterBranchId(undefined)
              setDateRange([ALL_TIME_START, dayjs().endOf('day')])
            }}
          >
            Reset
          </Button>
        </div>
      </div>

      <div className="dashboard-kpi-grid">
        <KpiCard
          loading={loading}
          label="Sales Revenue"
          amount={kpis.salesRevenue}
          meta={`${kpis.salesCount || 0} sales · ${kpis.unitsSold || 0} units`}
          icon={<FaCartShopping size={20} color="#2563eb" />}
          iconBg="#eff6ff"
        />
        <KpiCard
          loading={loading}
          label="Gross Profit"
          amount={pl?.grossProfit}
          meta={pl ? `${pl.grossMarginPercent}% margin` : undefined}
          icon={<IoTrendingUp size={20} color="#16a34a" />}
          iconBg="#f0fdf4"
          valueClass={profitClass(pl?.grossProfit || 0)}
        />
        <KpiCard
          loading={loading}
          label="Net Profit / Loss"
          amount={pl?.netProfit}
          meta={pl ? `${pl.netMarginPercent}% net margin` : undefined}
          icon={(pl?.netProfit || 0) >= 0 ? <IoTrendingUp size={20} color="#16a34a" /> : <IoTrendingDown size={20} color="#dc2626" />}
          iconBg={(pl?.netProfit || 0) >= 0 ? '#f0fdf4' : '#fef2f2'}
          valueClass={profitClass(pl?.netProfit || 0)}
        />
        <KpiCard
          loading={loading}
          label="Expenses"
          amount={kpis.expenses}
          meta={`${kpis.expenseCount || 0} entries`}
          icon={<GiReceiveMoney size={20} color="#f59e0b" />}
          iconBg="#fffbeb"
        />
        <KpiCard
          loading={loading}
          label="Collected"
          amount={kpis.collectedAmount}
          meta={`${insights.collectionRate || 0}% of sales`}
          icon={<FaSackDollar size={18} color="#0891b2" />}
          iconBg="#ecfeff"
        />
        <KpiCard
          loading={loading}
          label="Due Amount"
          amount={kpis.dueAmount}
          meta="In selected period"
          icon={<IoStatsChart size={18} color="#7c3aed" />}
          iconBg="#f5f3ff"
        />
        <KpiCard
          loading={loading}
          label="Purchases"
          amount={kpis.purchaseValue}
          meta={`${kpis.purchaseUnits || 0} units · ${kpis.purchaseCount || 0} bills`}
          icon={<MdOutlineInventory2 size={20} color="#ea580c" />}
          iconBg="#fff7ed"
        />
        <KpiCard
          loading={loading}
          label="In Stock"
          amount={kpis.inStockCount}
          displayValue={formatCompact(kpis.inStockCount)}
          meta={`${formatCompact(kpis.partStockUnits || 0)} part units · ${formatCompactRs(kpis.inventoryValue)}`}
          icon={<FaWarehouse size={18} color="#475569" />}
          iconBg="#f8fafc"
        />
        <KpiCard
          loading={loading}
          label="Outstanding"
          amount={kpis.outstandingBalance}
          meta={analyticsBranchId ? 'This branch' : 'All branches'}
          icon={<FaSackDollar size={18} color="#be123c" />}
          iconBg="#fff1f2"
        />
        <KpiCard
          loading={loading}
          label="Avg Sale Value"
          amount={insights.avgSaleValue}
          meta={`${formatCompactRs(insights.avgUnitSalePrice)} / unit`}
          icon={<IoStatsChart size={18} color="#0d9488" />}
          iconBg="#f0fdfa"
        />
      </div>

      <div className="dashboard-section dashboard-section--split">
        <Card
          bordered={false}
          className="dashboard-chart-card shadow-sm"
          title="Sales, Purchases & Expenses"
          extra={<Text type="secondary" className="hidden xl:inline">{periodLabel}</Text>}
          loading={loading}
        >
          {chartTrend.length === 0 ? (
            <div className="dashboard-chart-empty">No activity in this period.</div>
          ) : (
            <ChartBox>
              <AreaChart data={chartTrend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="expenseGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#94a3b8" interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" width={48} tickFormatter={(v) => formatCompactAxis(v)} />
                <Tooltip formatter={(v) => formatRs(Number(v ?? 0))} labelFormatter={(l) => l} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="sales" name="Sales" stroke="#2563eb" fill="url(#salesGrad)" strokeWidth={2} />
                <Area type="monotone" dataKey="purchases" name="Purchases" stroke="#16a34a" fill="transparent" strokeWidth={2} strokeDasharray="4 4" />
                <Area type="monotone" dataKey="expenses" name="Expenses" stroke="#f59e0b" fill="url(#expenseGrad)" strokeWidth={2} />
              </AreaChart>
            </ChartBox>
          )}
        </Card>

        <Card
          bordered={false}
          className="dashboard-pl shadow-sm"
          title="Profit & Loss"
          loading={loading}
        >
          {periodLabel && <Text type="secondary" className="dashboard-pl-period">{periodLabel}</Text>}
          {pl && (
            <>
              <PlRow label="Revenue (Sales)" amount={pl.revenue} />
              <PlRow label="Cost of Goods Sold" amount={pl.cogs} muted sub />
              <div className="dashboard-pl-divider" />
              <PlRow label="Gross Profit" amount={pl.grossProfit} total valueClass={profitClass(pl.grossProfit)} />
              <Text type="secondary" className="dashboard-pl-footnote">{pl.grossMarginPercent}% gross margin</Text>
              <PlRow label="Operating Expenses" amount={pl.expenses} muted sub />
              <div className="dashboard-pl-divider-solid" />
              <PlRow
                label={pl.netProfit >= 0 ? 'Net Profit' : 'Net Loss'}
                amount={pl.netProfit}
                total
                valueClass={profitClass(pl.netProfit)}
              />
              <Text type="secondary" className="dashboard-pl-footnote">
                {pl.netMarginPercent}% net margin · expense ratio {insights.expenseRatio || 0}%
              </Text>
            </>
          )}
        </Card>
      </div>

      <div className="dashboard-section dashboard-section--charts">
        <Card bordered={false} className="dashboard-chart-card shadow-sm" title="Top Sellers" loading={loading}>
          {topProducts.length === 0 ? (
            <div className="dashboard-chart-empty">No sales in this period.</div>
          ) : (
            <div style={{ height: topProductChartHeight }}>
              <ResponsiveContainer width="100%" height="100%" debounce={150}>
                <BarChart data={topProducts} layout="vertical" margin={{ left: 4, right: 12, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => formatCompactAxis(v)} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={96}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => (String(v).length > 14 ? `${String(v).slice(0, 14)}…` : String(v))}
                  />
                  <Tooltip formatter={(v) => formatRs(Number(v ?? 0))} />
                  <Bar dataKey="revenue" name="Revenue" fill="#2563eb" radius={[0, 4, 4, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card bordered={false} className="dashboard-chart-card shadow-sm" title="Expenses by Category" loading={loading}>
          {expensesByCategory.length === 0 ? (
            <div className="dashboard-chart-empty">No expenses in this period.</div>
          ) : (
            <ChartBox compact>
              <PieChart>
                <Pie
                  data={expensesByCategory}
                  dataKey="amount"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  innerRadius="42%"
                  outerRadius="68%"
                  paddingAngle={2}
                >
                  {expensesByCategory.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => formatRs(Number(v ?? 0))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ChartBox>
          )}
        </Card>
      </div>
    </div>
  )
}

export default Dashboard
