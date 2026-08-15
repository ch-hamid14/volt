import { getDb, withTransaction } from '../../db'
import { generateId } from '../../../common/utils/uuid'
import {
  type AuditContext,
  auditDelete,
  withAuditCreate,
  withAuditUpdate
} from '../shared/audit.helpers'
import { asJson, asJsonList } from '../shared/json.helpers'

export const TAX_CODE_SALE = 'sale_tax'
export const TAX_CODE_236 = 'tax_236_gh'

export type TaxInput = {
  name: string
  defaultPercent?: number
  inclusiveDefault?: boolean
}

export const taxService = {
  /** System taxes are seeded on the server and replicated via auth bootstrap / sync. */
  async list(companyId: string, search?: string): Promise<unknown[]> {
    const q = getDb()('taxes')
      .where({ company_id: companyId })
      .whereNull('deleted_at')
      .orderBy([
        { column: 'sort_order', order: 'asc' },
        { column: 'name', order: 'asc' }
      ])
    if (search?.trim()) q.whereILike('name', `%${search.trim()}%`)
    return asJsonList(await q)
  },

  async create(companyId: string, ctx: AuditContext, data: TaxInput): Promise<unknown> {
    const name = String(data.name || '').trim()
    if (!name) throw new Error('Tax name is required')
    const defaultPercent = Number(data.defaultPercent || 0)
    if (!Number.isFinite(defaultPercent) || defaultPercent < 0 || defaultPercent > 100) {
      throw new Error('Default percent must be between 0 and 100')
    }

    return withTransaction(async (transaction) => {
      const [row] = await getDb()('taxes')
        .transacting(transaction)
        .insert(
          withAuditCreate(ctx, {
            id: generateId(),
            company_id: companyId,
            name,
            code: null,
            default_percent: defaultPercent,
            inclusive_default: Boolean(data.inclusiveDefault),
            is_system: false,
            sort_order: 100,
            created_at: new Date(),
            updated_at: new Date()
          })
        )
        .returning('*')
      return asJson(row)
    })
  },

  async update(
    id: string,
    companyId: string,
    ctx: AuditContext,
    data: {
      name?: string
      defaultPercent?: number
      inclusiveDefault?: boolean
    }
  ): Promise<unknown> {
    return withTransaction(async (transaction) => {
      const row = await getDb()('taxes')
        .transacting(transaction)
        .where({ id, company_id: companyId })
        .whereNull('deleted_at')
        .first()
      if (!row) throw new Error('Tax not found')

      const patch: Record<string, unknown> = {}
      if (data.defaultPercent !== undefined) {
        const defaultPercent = Number(data.defaultPercent)
        if (!Number.isFinite(defaultPercent) || defaultPercent < 0 || defaultPercent > 100) {
          throw new Error('Default percent must be between 0 and 100')
        }
        patch.default_percent = defaultPercent
      }

      if (row.is_system) {
        if (data.name !== undefined && String(data.name).trim() !== row.name) {
          throw new Error('System tax name cannot be changed')
        }
        // System taxes: only default % is editable (inclusive is driven by sale-line toggle)
      } else {
        if (data.name !== undefined) {
          const name = String(data.name).trim()
          if (!name) throw new Error('Tax name is required')
          patch.name = name
        }
        if (data.inclusiveDefault !== undefined) {
          patch.inclusive_default = Boolean(data.inclusiveDefault)
        }
      }

      const [updated] = await getDb()('taxes')
        .transacting(transaction)
        .where({ id })
        .update(withAuditUpdate(ctx, patch))
        .returning('*')
      return asJson(updated)
    })
  },

  async remove(id: string, companyId: string, ctx: AuditContext): Promise<void> {
    await withTransaction(async (transaction) => {
      const row = await getDb()('taxes')
        .transacting(transaction)
        .where({ id, company_id: companyId })
        .whereNull('deleted_at')
        .first()
      if (!row) throw new Error('Tax not found')
      if (row.is_system) throw new Error('System taxes cannot be deleted')
      await getDb()('taxes').transacting(transaction).where({ id }).update(auditDelete(ctx))
    })
  }
}
