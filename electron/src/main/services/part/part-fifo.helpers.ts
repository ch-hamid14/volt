import type { Knex } from 'knex'
import { generateId } from '../../../common/utils/uuid'
import { type AuditContext, auditCreate, auditUpdate } from '../shared/audit.helpers'

export type FifoLotRow = {
  id: string
  quantity_remaining: number
  unit_cost: number
  purchase_date: Date
}

export type FifoAllocation = {
  partPurchaseLineId: string
  quantity: number
  unitCost: number
}

export type FifoPreview = {
  /** Weighted average unit cost for the requested quantity (FIFO). */
  unitCost: number
  /** Cost of the oldest lot with remaining stock (next unit out). */
  nextLotUnitCost: number
  /** Suggested retail from the oldest lot. */
  nextLotSalePrice: number
  availableQuantity: number
  layers: { unitCost: number; quantity: number; purchaseDate: string }[]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

async function fifoLotsQuery(
  trx: Knex.Transaction | Knex,
  companyId: string,
  branchId: string,
  partId: string,
  forUpdate = false
): Promise<FifoLotRow[]> {
  let q = trx('part_purchase_lines as pl')
    .join('part_purchases as pp', 'pp.id', 'pl.part_purchase_id')
    .where({
      'pl.part_id': partId,
      'pl.company_id': companyId,
      'pp.branch_id': branchId
    })
    .where('pl.quantity_remaining', '>', 0)
    .whereNull('pl.deleted_at')
    .whereNull('pp.deleted_at')
    .select(
      'pl.id',
      'pl.quantity_remaining',
      'pl.unit_cost',
      'pl.unit_sale_price',
      'pp.purchase_date'
    )
    .orderBy('pp.purchase_date', 'asc')
    .orderBy('pp.created_at', 'asc')
    .orderBy('pl.created_at', 'asc')

  if (forUpdate) q = q.forUpdate('pl')
  return q as unknown as Promise<FifoLotRow[]>
}

/** Read-only FIFO cost preview for the sale UI (does not mutate stock). */
export async function previewPartFifoCost(
  trx: Knex.Transaction | Knex,
  companyId: string,
  branchId: string,
  partId: string,
  quantity: number
): Promise<FifoPreview> {
  const lots = await fifoLotsQuery(trx, companyId, branchId, partId)
  const availableQuantity = lots.reduce((sum, lot) => sum + Number(lot.quantity_remaining), 0)

  if (!lots.length || quantity <= 0) {
    return {
      unitCost: 0,
      nextLotUnitCost: 0,
      nextLotSalePrice: 0,
      availableQuantity,
      layers: []
    }
  }

  const first = lots[0] as FifoLotRow & { unit_sale_price?: number }
  let remaining = quantity
  let totalCost = 0
  const layers: FifoPreview['layers'] = []

  for (const lot of lots) {
    if (remaining <= 0) break
    const avail = Number(lot.quantity_remaining)
    const take = Math.min(avail, remaining)
    const cost = Number(lot.unit_cost || 0)
    totalCost += take * cost
    remaining -= take
    layers.push({
      unitCost: cost,
      quantity: take,
      purchaseDate: new Date(lot.purchase_date).toISOString().slice(0, 10)
    })
  }

  return {
    unitCost: remaining > 0 ? 0 : round2(totalCost / quantity),
    nextLotUnitCost: round2(Number(first.unit_cost || 0)),
    nextLotSalePrice: round2(Number(first.unit_sale_price || first.unit_cost || 0)),
    availableQuantity,
    layers
  }
}

/** Consume stock from oldest purchase lines first; persist allocations on the sale line. */
export async function consumePartStockFifo(
  trx: Knex.Transaction,
  params: {
    companyId: string
    branchId: string
    partId: string
    quantity: number
    saleLineId: string
    ctx: AuditContext
  }
): Promise<{ unitCost: number; allocations: FifoAllocation[] }> {
  const { companyId, branchId, partId, quantity, saleLineId, ctx } = params
  if (quantity <= 0) throw new Error('Quantity must be positive')

  const lots = await fifoLotsQuery(trx, companyId, branchId, partId, true)
  let remaining = quantity
  let totalCost = 0
  const allocations: FifoAllocation[] = []
  const now = new Date()
  const lineAudit = auditCreate(ctx)

  for (const lot of lots) {
    if (remaining <= 0) break
    const avail = Number(lot.quantity_remaining)
    const take = Math.min(avail, remaining)
    if (take <= 0) continue
    const unitCost = Number(lot.unit_cost || 0)

    await trx('part_purchase_lines')
      .where({ id: lot.id })
      .update({
        quantity_remaining: avail - take,
        ...auditUpdate(ctx),
        updated_at: now
      })

    allocations.push({ partPurchaseLineId: lot.id, quantity: take, unitCost })
    totalCost += take * unitCost
    remaining -= take
  }

  if (remaining > 0) {
    throw new Error(`Insufficient stock for FIFO allocation (${remaining} unit(s) short)`)
  }

  const unitCost = round2(totalCost / quantity)

  for (const alloc of allocations) {
    await trx('part_sale_allocations').insert({
      id: generateId(),
      company_id: companyId,
      sale_line_id: saleLineId,
      part_purchase_line_id: alloc.partPurchaseLineId,
      quantity: alloc.quantity,
      unit_cost: alloc.unitCost,
      ...lineAudit,
      created_at: now,
      updated_at: now
    })
  }

  return { unitCost, allocations }
}

/** Restore purchase-line remaining qty when a part sale line is reversed or deleted. */
export async function restorePartSaleAllocations(
  trx: Knex.Transaction,
  saleLineId: string,
  ctx?: AuditContext
): Promise<void> {
  const allocations = await trx('part_sale_allocations').where({ sale_line_id: saleLineId })
  const now = new Date()

  for (const alloc of allocations) {
    const line = await trx('part_purchase_lines')
      .where({ id: alloc.part_purchase_line_id })
      .first()
    if (!line) continue
    await trx('part_purchase_lines')
      .where({ id: alloc.part_purchase_line_id })
      .update({
        quantity_remaining: Number(line.quantity_remaining) + Number(alloc.quantity),
        ...(ctx ? auditUpdate(ctx) : {}),
        updated_at: now
      })
  }

  await trx('part_sale_allocations').where({ sale_line_id: saleLineId }).del()
}

/** Sum of (quantity_remaining × unit_cost) for inventory valuation. */
export async function computePartFifoInventoryValue(
  trx: Knex.Transaction | Knex,
  companyId: string,
  branchId?: string,
  partId?: string
): Promise<number> {
  let q = trx('part_purchase_lines as pl')
    .join('part_purchases as pp', 'pp.id', 'pl.part_purchase_id')
    .where({ 'pl.company_id': companyId })
    .where('pl.quantity_remaining', '>', 0)
    .whereNull('pl.deleted_at')
    .whereNull('pp.deleted_at')

  if (branchId) q = q.where({ 'pp.branch_id': branchId })
  if (partId) q = q.where({ 'pl.part_id': partId })

  const rows = await q.select('pl.quantity_remaining', 'pl.unit_cost')
  return round2(
    rows.reduce(
      (sum, row) => sum + Number(row.quantity_remaining) * Number(row.unit_cost || 0),
      0
    )
  )
}
