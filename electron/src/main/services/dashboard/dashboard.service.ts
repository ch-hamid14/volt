import type { Knex } from 'knex'
import { ProductItemStatus } from '@madix/database'
import { getDb } from '../../db'
import { computePartFifoInventoryValue } from '../part/part-fifo.helpers'

export type DashboardFilters = {
  from?: string
  to?: string
  supplierId?: string
  productId?: string
  partId?: string
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function parseDateRange(from?: string, to?: string): { from: Date; to: Date } {
  const now = new Date()
  const toDate = to ? new Date(to) : new Date(now)
  toDate.setHours(23, 59, 59, 999)

  const fromDate = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), 1)
  fromDate.setHours(0, 0, 0, 0)

  return { from: fromDate, to: toDate }
}

function pct(numerator: number, denominator: number): number {
  if (!denominator) return 0
  return round2((numerator / denominator) * 100)
}

function fillDailyTrend(
  from: Date,
  to: Date,
  salesByDay: Map<string, number>,
  purchasesByDay: Map<string, number>,
  expensesByDay: Map<string, number>
): { date: string; sales: number; purchases: number; expenses: number; profit: number }[] {
  const start = new Date(from)
  start.setHours(0, 0, 0, 0)
  const end = new Date(to)
  end.setHours(0, 0, 0, 0)
  const spanDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1

  const toRow = (key: string) => {
    const sales = round2(salesByDay.get(key) || 0)
    const purchases = round2(purchasesByDay.get(key) || 0)
    const expenses = round2(expensesByDay.get(key) || 0)
    return { date: key, sales, purchases, expenses, profit: round2(sales - expenses) }
  }

  // For long ranges (e.g. "All"), only plot days that have activity.
  if (spanDays > 366) {
    const keys = new Set<string>([
      ...salesByDay.keys(),
      ...purchasesByDay.keys(),
      ...expensesByDay.keys()
    ])
    return [...keys].sort().map(toRow)
  }

  const rows: { date: string; sales: number; purchases: number; expenses: number; profit: number }[] = []
  const cursor = new Date(start)
  while (cursor <= end) {
    rows.push(toRow(cursor.toISOString().slice(0, 10)))
    cursor.setDate(cursor.getDate() + 1)
  }

  return rows
}

function hasItemFilters(filters?: DashboardFilters): boolean {
  return !!(filters?.supplierId || filters?.productId || filters?.partId)
}

function includeProductScope(filters?: DashboardFilters): boolean {
  return !filters?.partId || !!filters?.productId
}

function includePartScope(filters?: DashboardFilters): boolean {
  return !filters?.productId || !!filters?.partId
}

const PART_COGS_SQL = 'COALESCE(sl.unit_cost, 0) * sl.quantity'

function baseSaleLinesQuery(
  db: Knex,
  companyId: string,
  branchId: string,
  fromDate: Date,
  toDate: Date
): Knex.QueryBuilder {
  return db('sale_lines as sl')
    .join('sales as s', 's.id', 'sl.sale_id')
    .where({ 's.company_id': companyId, 's.branch_id': branchId })
    .where('s.sale_date', '>=', fromDate)
    .where('s.sale_date', '<=', toDate)
    .whereNull('s.deleted_at')
}

function applySaleLineItemFilters(q: Knex.QueryBuilder, filters?: DashboardFilters): Knex.QueryBuilder {
  if (filters?.productId) q.where({ 'pi.product_id': filters.productId })
  if (filters?.supplierId) {
    q.leftJoin('purchases as pu_sl', 'pu_sl.id', 'pi.purchase_id')
    q.where({ 'pu_sl.supplier_id': filters.supplierId })
  }
  return q
}

function applyProductItemFilters(q: Knex.QueryBuilder, filters?: DashboardFilters): Knex.QueryBuilder {
  if (filters?.productId) q.where({ 'pi.product_id': filters.productId })
  if (filters?.supplierId) {
    q.leftJoin('purchases as pu_pi', 'pu_pi.id', 'pi.purchase_id')
    q.where({ 'pu_pi.supplier_id': filters.supplierId })
  }
  return q
}

function applyPartSaleLineFilters(
  q: Knex.QueryBuilder,
  db: Knex,
  companyId: string,
  filters?: DashboardFilters
): Knex.QueryBuilder {
  if (filters?.partId) q.where({ 'sl.part_id': filters.partId })
  if (filters?.supplierId) {
    q.whereExists(
      db('part_purchase_lines as ppl')
        .join('part_purchases as pp', 'pp.id', 'ppl.part_purchase_id')
        .whereRaw('ppl.part_id = sl.part_id')
        .where({ 'pp.supplier_id': filters.supplierId, 'pp.company_id': companyId })
        .whereNull('ppl.deleted_at')
        .whereNull('pp.deleted_at')
    )
  }
  return q
}

function applyPartPurchaseLineFilters(q: Knex.QueryBuilder, filters?: DashboardFilters): Knex.QueryBuilder {
  if (filters?.partId) q.where({ 'pl.part_id': filters.partId })
  if (filters?.supplierId) q.where({ 'pp.supplier_id': filters.supplierId })
  return q
}

type FilteredSaleLineRow = {
  line_total: unknown
  line_id: unknown
  sale_id: unknown
  net_total: unknown
  paid_amount: unknown
  due_amount: unknown
  discount: unknown
  line_cost: unknown
  units: unknown
  sale_date?: unknown
}

/** Full-bill SUM(line_total) so filtered lines can take a share of net_total (bill discount). */
async function loadBillLineSums(
  db: Knex,
  saleIds: string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (!saleIds.length) return map
  const rows = (await db('sale_lines')
    .whereIn('sale_id', saleIds)
    .groupBy('sale_id')
    .select('sale_id')
    .sum({ total: 'line_total' })) as Array<{ sale_id: string; total?: unknown }>
  for (const row of rows) {
    map.set(String(row.sale_id), round2(Number(row.total || 0)))
  }
  return map
}

function lineShareOfBill(lineTotal: number, billLineSum: number): number {
  if (!(billLineSum > 0)) return 0
  return lineTotal / billLineSum
}

/**
 * Allocate filtered lines against bill net_total (same basis as unfiltered SUM(net_total)).
 * share = line_total / SUM(all lines on sale); revenue = share × net_total.
 */
function aggregateFilteredSaleLines(
  rows: FilteredSaleLineRow[],
  billLineSumBySale: Map<string, number>
): {
  salesRevenue: number
  collectedAmount: number
  dueAmount: number
  discountTotal: number
  salesCount: number
  cogs: number
  unitsSold: number
} {
  let salesRevenue = 0
  let collectedAmount = 0
  let dueAmount = 0
  let discountTotal = 0
  let cogs = 0
  let unitsSold = 0
  const saleIds = new Set<string>()

  for (const row of rows) {
    const saleId = String(row.sale_id)
    const lineTotal = Number(row.line_total || 0)
    const netTotal = Number(row.net_total || 0)
    const billSum = billLineSumBySale.get(saleId) ?? 0
    const share = lineShareOfBill(lineTotal, billSum)

    salesRevenue = round2(salesRevenue + share * netTotal)
    collectedAmount = round2(collectedAmount + Number(row.paid_amount || 0) * share)
    dueAmount = round2(dueAmount + Number(row.due_amount || 0) * share)
    discountTotal = round2(discountTotal + Number(row.discount || 0) * share)
    cogs = round2(cogs + Number(row.line_cost || 0))
    unitsSold += Number(row.units || 0)
    saleIds.add(saleId)
  }

  return {
    salesRevenue,
    collectedAmount,
    dueAmount,
    discountTotal,
    salesCount: saleIds.size,
    cogs,
    unitsSold
  }
}

function mergeDailyTotals(target: Map<string, number>, rows: Array<Record<string, unknown>>): void {
  for (const row of rows) {
    const key = new Date(row.day as string | Date).toISOString().slice(0, 10)
    target.set(key, round2((target.get(key) || 0) + Number(row.total)))
  }
}

class DashboardService {
  async getAnalytics(companyId: string, branchId: string, filters?: DashboardFilters): Promise<unknown> {
    const db = getDb()
    const { from: fromDate, to: toDate } = parseDateRange(filters?.from, filters?.to)

    let salesRevenue = 0
    let collectedAmount = 0
    let dueAmount = 0
    let discountTotal = 0
    let salesCount = 0
    let cogs = 0
    let unitsSold = 0

    const withProducts = includeProductScope(filters)
    const withParts = includePartScope(filters)

    let filteredRowsCache: FilteredSaleLineRow[] | null = null
    let billLineSumBySale = new Map<string, number>()

    if (hasItemFilters(filters)) {
      const filteredRows: FilteredSaleLineRow[] = []

      if (withProducts) {
        const productRows = await applySaleLineItemFilters(
          baseSaleLinesQuery(db, companyId, branchId, fromDate, toDate)
            .join('product_items as pi', 'pi.id', 'sl.product_item_id')
            .whereNotNull('sl.product_item_id')
            .select(
              'sl.line_total',
              'sl.id as line_id',
              's.id as sale_id',
              's.net_total',
              's.paid_amount',
              's.due_amount',
              's.discount',
              's.sale_date',
              db.raw('pi.purchase_price as line_cost'),
              db.raw('1 as units')
            ),
          filters
        )

        filteredRows.push(...productRows)
      }

      if (withParts) {
        const partRows = await applyPartSaleLineFilters(
          baseSaleLinesQuery(db, companyId, branchId, fromDate, toDate)
            .leftJoin('part_stocks as ps', function joinPartStock() {
              this.on('ps.part_id', 'sl.part_id')
                .andOn('ps.branch_id', 's.branch_id')
                .andOn('ps.company_id', 's.company_id')
            })
            .leftJoin('parts as p', 'p.id', 'sl.part_id')
            .whereNotNull('sl.part_id')
            .select(
              'sl.line_total',
              'sl.id as line_id',
              's.id as sale_id',
              's.net_total',
              's.paid_amount',
              's.due_amount',
              's.discount',
              's.sale_date',
              db.raw(`${PART_COGS_SQL} as line_cost`),
              'sl.quantity as units'
            ),
          db,
          companyId,
          filters
        )

        filteredRows.push(...partRows)
      }

      billLineSumBySale = await loadBillLineSums(
        db,
        [...new Set(filteredRows.map((r) => String(r.sale_id)))]
      )
      filteredRowsCache = filteredRows

      const aggregated = aggregateFilteredSaleLines(filteredRows, billLineSumBySale)
      salesRevenue = aggregated.salesRevenue
      collectedAmount = aggregated.collectedAmount
      dueAmount = aggregated.dueAmount
      discountTotal = aggregated.discountTotal
      salesCount = aggregated.salesCount
      cogs = aggregated.cogs
      unitsSold = aggregated.unitsSold
    } else {
      const salesRows = await db('sales')
        .where({ company_id: companyId, branch_id: branchId })
        .where('sale_date', '>=', fromDate)
        .where('sale_date', '<=', toDate)
        .whereNull('deleted_at')

      salesRevenue = round2(salesRows.reduce((sum, row) => sum + Number(row.net_total), 0))
      collectedAmount = round2(salesRows.reduce((sum, row) => sum + Number(row.paid_amount), 0))
      dueAmount = round2(salesRows.reduce((sum, row) => sum + Number(row.due_amount), 0))
      discountTotal = round2(salesRows.reduce((sum, row) => sum + Number(row.discount), 0))
      salesCount = salesRows.length

      const productCogsRow = await baseSaleLinesQuery(db, companyId, branchId, fromDate, toDate)
        .join('product_items as pi', 'pi.id', 'sl.product_item_id')
        .whereNotNull('sl.product_item_id')
        .sum({ cogs: db.raw('pi.purchase_price') })
        .count({ units: 'sl.id' })
        .first()

      const partCogsRow = await baseSaleLinesQuery(db, companyId, branchId, fromDate, toDate)
        .leftJoin('part_stocks as ps', function joinPartStock() {
          this.on('ps.part_id', 'sl.part_id')
            .andOn('ps.branch_id', 's.branch_id')
            .andOn('ps.company_id', 's.company_id')
        })
        .leftJoin('parts as p', 'p.id', 'sl.part_id')
        .whereNotNull('sl.part_id')
        .sum({ cogs: db.raw(PART_COGS_SQL) })
        .sum({ units: 'sl.quantity' })
        .first()

      cogs = round2(Number(productCogsRow?.cogs || 0) + Number(partCogsRow?.cogs || 0))
      unitsSold = Number(productCogsRow?.units || 0) + Number(partCogsRow?.units || 0)
    }
    const grossProfit = round2(salesRevenue - cogs)

    const expenseRows = await db('expenses as e')
      .leftJoin('expense_categories as ec', 'ec.id', 'e.category_id')
      .where({ 'e.company_id': companyId, 'e.branch_id': branchId })
      .where('e.date', '>=', fromDate)
      .where('e.date', '<=', toDate)
      .whereNull('e.deleted_at')
      .select('e.amount', 'ec.name as category_name')

    const expenses = round2(expenseRows.reduce((sum, row) => sum + Number(row.amount), 0))
    const netProfit = round2(grossProfit - expenses)

    let productPurchaseValue = 0
    let productPurchaseUnits = 0
    let productPurchaseBills = 0

    if (withProducts) {
      const purchaseItems = await applyProductItemFilters(
        db('product_items as pi')
          .where({ 'pi.company_id': companyId, 'pi.branch_id': branchId })
          .where('pi.purchased_at', '>=', fromDate)
          .where('pi.purchased_at', '<=', toDate)
          .whereNull('pi.deleted_at')
          .select('pi.purchase_price'),
        filters
      )

      productPurchaseValue = round2(
        purchaseItems.reduce((sum, item) => sum + Number(item.purchase_price), 0)
      )
      productPurchaseUnits = purchaseItems.length

      let purchaseRecordsQ = db('purchases as p')
        .where({ 'p.company_id': companyId, 'p.branch_id': branchId })
        .where('p.purchase_date', '>=', fromDate)
        .where('p.purchase_date', '<=', toDate)
        .whereNull('p.deleted_at')

      if (filters?.supplierId) purchaseRecordsQ = purchaseRecordsQ.where({ 'p.supplier_id': filters.supplierId })
      if (filters?.productId) {
        purchaseRecordsQ = purchaseRecordsQ.whereExists(
          db('product_items as pi_p')
            .whereRaw('pi_p.purchase_id = p.id')
            .where({ 'pi_p.product_id': filters.productId })
            .whereNull('pi_p.deleted_at')
        )
      }

      productPurchaseBills = (await purchaseRecordsQ).length
    }

    let partPurchaseValue = 0
    let partPurchaseUnits = 0
    let partPurchaseBills = 0

    if (withParts) {
      const partPurchaseLines = await applyPartPurchaseLineFilters(
        db('part_purchase_lines as pl')
          .join('part_purchases as pp', 'pp.id', 'pl.part_purchase_id')
          .where({ 'pl.company_id': companyId, 'pp.branch_id': branchId })
          .where('pp.purchase_date', '>=', fromDate)
          .where('pp.purchase_date', '<=', toDate)
          .whereNull('pl.deleted_at')
          .whereNull('pp.deleted_at')
          .select('pl.quantity', 'pl.unit_cost'),
        filters
      )

      partPurchaseValue = round2(
        partPurchaseLines.reduce(
          (sum, line) => sum + Number(line.quantity) * Number(line.unit_cost),
          0
        )
      )
      partPurchaseUnits = partPurchaseLines.reduce((sum, line) => sum + Number(line.quantity), 0)

      let partPurchaseRecordsQ = db('part_purchases as pp')
        .where({ 'pp.company_id': companyId, 'pp.branch_id': branchId })
        .where('pp.purchase_date', '>=', fromDate)
        .where('pp.purchase_date', '<=', toDate)
        .whereNull('pp.deleted_at')

      if (filters?.supplierId) partPurchaseRecordsQ = partPurchaseRecordsQ.where({ 'pp.supplier_id': filters.supplierId })
      if (filters?.partId) {
        partPurchaseRecordsQ = partPurchaseRecordsQ.whereExists(
          db('part_purchase_lines as pl_p')
            .whereRaw('pl_p.part_purchase_id = pp.id')
            .where({ 'pl_p.part_id': filters.partId })
            .whereNull('pl_p.deleted_at')
        )
      }

      partPurchaseBills = (await partPurchaseRecordsQ).length
    }

    const purchaseValue = round2(productPurchaseValue + partPurchaseValue)
    const purchaseCount = productPurchaseUnits + partPurchaseUnits
    const purchaseBills = productPurchaseBills + partPurchaseBills

    let productInventoryValue = 0
    let inStockCount = 0

    if (withProducts) {
      const inStock = await applyProductItemFilters(
        db('product_items as pi')
          .where({
            'pi.company_id': companyId,
            'pi.current_branch_id': branchId,
            'pi.status': ProductItemStatus.IN_STOCK
          })
          .whereNull('pi.deleted_at')
          .select('pi.purchase_price'),
        filters
      )

      inStockCount = inStock.length
      productInventoryValue = round2(inStock.reduce((sum, item) => sum + Number(item.purchase_price), 0))
    }

    let partStockUnits = 0
    let partInventoryValue = 0

    if (withParts) {
      let partStockQ = db('part_stocks as ps')
        .where({ 'ps.company_id': companyId, 'ps.branch_id': branchId })
        .where('ps.quantity_on_hand', '>', 0)

      if (filters?.partId) partStockQ = partStockQ.where({ 'ps.part_id': filters.partId })

      const partStocks = await partStockQ.select('ps.quantity_on_hand')

      partStockUnits = partStocks.reduce((sum, row) => sum + Number(row.quantity_on_hand), 0)
      partInventoryValue = await computePartFifoInventoryValue(
        db,
        companyId,
        branchId,
        filters?.partId
      )
    }

    const inventoryValue = round2(productInventoryValue + partInventoryValue)

    const customers = await db('customers').where({ company_id: companyId }).whereNull('deleted_at')
    let outstandingBalance = 0
    for (const c of customers) {
      const last = await db('ledger_entries')
        .where({ customer_id: c.id })
        .orderBy('created_at', 'desc')
        .first()
      if (last) outstandingBalance += Number(last.running_balance)
    }
    outstandingBalance = round2(outstandingBalance)

    const salesByDay = new Map<string, number>()
    const purchasesByDay = new Map<string, number>()

    if (hasItemFilters(filters) && filteredRowsCache) {
      for (const row of filteredRowsCache) {
        const saleId = String(row.sale_id)
        const share = lineShareOfBill(
          Number(row.line_total || 0),
          billLineSumBySale.get(saleId) ?? 0
        )
        const dayRaw = row.sale_date
        if (!dayRaw) continue
        const key = new Date(dayRaw as string | Date).toISOString().slice(0, 10)
        salesByDay.set(
          key,
          round2((salesByDay.get(key) || 0) + share * Number(row.net_total || 0))
        )
      }
    } else {
      const dailySales = await db('sales')
        .where({ company_id: companyId, branch_id: branchId })
        .where('sale_date', '>=', fromDate)
        .where('sale_date', '<=', toDate)
        .whereNull('deleted_at')
        .select(db.raw('DATE(sale_date) as day'))
        .sum('net_total as total')
        .groupByRaw('DATE(sale_date)')

      mergeDailyTotals(salesByDay, dailySales)
    }

    if (withProducts) {
      const dailyProductPurchases = await applyProductItemFilters(
        db('product_items as pi')
          .where({ 'pi.company_id': companyId, 'pi.branch_id': branchId })
          .where('pi.purchased_at', '>=', fromDate)
          .where('pi.purchased_at', '<=', toDate)
          .whereNull('pi.deleted_at')
          .select(db.raw('DATE(pi.purchased_at) as day'))
          .sum('pi.purchase_price as total')
          .groupByRaw('DATE(pi.purchased_at)'),
        filters
      )
      mergeDailyTotals(purchasesByDay, dailyProductPurchases)
    }

    if (withParts) {
      const dailyPartPurchases = await applyPartPurchaseLineFilters(
        db('part_purchase_lines as pl')
          .join('part_purchases as pp', 'pp.id', 'pl.part_purchase_id')
          .where({ 'pl.company_id': companyId, 'pp.branch_id': branchId })
          .where('pp.purchase_date', '>=', fromDate)
          .where('pp.purchase_date', '<=', toDate)
          .whereNull('pl.deleted_at')
          .whereNull('pp.deleted_at')
          .select(db.raw('DATE(pp.purchase_date) as day'))
          .sum({ total: db.raw('pl.quantity * pl.unit_cost') })
          .groupByRaw('DATE(pp.purchase_date)'),
        filters
      )
      mergeDailyTotals(purchasesByDay, dailyPartPurchases)
    }

    const dailyExpenses = await db('expenses')
      .where({ company_id: companyId, branch_id: branchId })
      .where('date', '>=', fromDate)
      .where('date', '<=', toDate)
      .whereNull('deleted_at')
      .select(db.raw('DATE(date) as day'))
      .sum('amount as total')
      .groupByRaw('DATE(date)')

    const expensesByDay = new Map<string, number>()
    for (const row of dailyExpenses) {
      const key = new Date(row.day).toISOString().slice(0, 10)
      expensesByDay.set(key, round2(Number(row.total)))
    }

    const trend = fillDailyTrend(fromDate, toDate, salesByDay, purchasesByDay, expensesByDay)

    const topSellerRows: { product_name: string; units: unknown; revenue: unknown }[] = []

    if (withProducts) {
      const topProductRows = await applySaleLineItemFilters(
        baseSaleLinesQuery(db, companyId, branchId, fromDate, toDate)
          .join('product_items as pi', 'pi.id', 'sl.product_item_id')
          .whereNotNull('sl.product_item_id')
          .whereNotNull('sl.product_name')
          .select('sl.product_name')
          .count('* as units')
          .sum('sl.line_total as revenue')
          .groupBy('sl.product_name'),
        filters
      )
      topSellerRows.push(...topProductRows)
    }

    if (withParts) {
      const topPartRows = await applyPartSaleLineFilters(
        baseSaleLinesQuery(db, companyId, branchId, fromDate, toDate)
          .whereNotNull('sl.part_id')
          .whereNotNull('sl.product_name')
          .select('sl.product_name')
          .sum('sl.quantity as units')
          .sum('sl.line_total as revenue')
          .groupBy('sl.product_name'),
        db,
        companyId,
        filters
      )
      topSellerRows.push(...topPartRows)
    }

    const topSellerMap = new Map<string, { units: number; revenue: number }>()
    for (const row of topSellerRows) {
      const name = row.product_name as string
      const existing = topSellerMap.get(name) || { units: 0, revenue: 0 }
      topSellerMap.set(name, {
        units: existing.units + Number(row.units),
        revenue: round2(existing.revenue + Number(row.revenue))
      })
    }

    const topProducts = [...topSellerMap.entries()]
      .map(([name, stats]) => ({ name, units: stats.units, revenue: stats.revenue }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)

    const expenseCategoryMap = new Map<string, number>()
    for (const row of expenseRows) {
      const category = (row.category_name as string) || 'Uncategorized'
      expenseCategoryMap.set(category, round2((expenseCategoryMap.get(category) || 0) + Number(row.amount)))
    }

    const expensesByCategory = [...expenseCategoryMap.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)

    return {
      period: {
        from: fromDate.toISOString().slice(0, 10),
        to: toDate.toISOString().slice(0, 10)
      },
      kpis: {
        salesRevenue,
        salesCount,
        unitsSold,
        purchaseValue,
        purchaseCount: purchaseBills,
        purchaseUnits: purchaseCount,
        expenses,
        expenseCount: expenseRows.length,
        collectedAmount,
        dueAmount,
        discountTotal,
        inStockCount,
        partStockUnits,
        inventoryValue,
        outstandingBalance
      },
      profitLoss: {
        revenue: salesRevenue,
        cogs,
        grossProfit,
        grossMarginPercent: pct(grossProfit, salesRevenue),
        expenses,
        netProfit,
        netMarginPercent: pct(netProfit, salesRevenue)
      },
      insights: {
        avgSaleValue: salesCount ? round2(salesRevenue / salesCount) : 0,
        avgUnitSalePrice: unitsSold ? round2(salesRevenue / unitsSold) : 0,
        collectionRate: salesRevenue ? pct(collectedAmount, salesRevenue) : 0,
        expenseRatio: salesRevenue ? pct(expenses, salesRevenue) : 0
      },
      trend,
      topProducts,
      expensesByCategory
    }
  }

  /** @deprecated Use getAnalytics — kept for compatibility */
  async getMetrics(companyId: string, branchId: string): Promise<unknown> {
    const data = (await this.getAnalytics(companyId, branchId, {})) as Record<string, unknown>
    const kpis = data.kpis as Record<string, number>
    const profitLoss = data.profitLoss as Record<string, number>
    return {
      todaySales: kpis.salesRevenue,
      todayPurchases: kpis.purchaseCount,
      todayPurchaseTotal: kpis.purchaseValue,
      outstandingBalance: kpis.outstandingBalance,
      inventoryValue: kpis.inventoryValue,
      expenses: kpis.expenses,
      profitLoss: profitLoss.netProfit,
      inStockCount: kpis.inStockCount
    }
  }
}

export const dashboardService = new DashboardService()
