import type { Knex } from 'knex'
import { Roles } from '../../../common/constants/roles'
import { appState } from '../../state/app-state'
import { asJson } from './json.helpers'

export type AuditContext = {
  userId: string
  deviceId: string
  role: string
  branchId?: string | null
}

export const AUDIT_USER_SELECT = [
  'creator.first_name as creator_first_name',
  'creator.last_name as creator_last_name',
  'updater.first_name as updater_first_name',
  'updater.last_name as updater_last_name'
] as const

export function parseAuditFromBody(body?: Record<string, unknown>): AuditContext {
  const userId = body?.userId as string | undefined
  const deviceId = body?.deviceId as string | undefined
  if (!userId || !deviceId) {
    throw new Error('Session context required (userId and deviceId)')
  }
  return {
    userId,
    deviceId,
    role: (body?.role as string) || Roles.STAFF,
    branchId: (body?.branchId as string | null) ?? null
  }
}

export function parseAuditFromQuery(query?: Record<string, unknown>): AuditContext | null {
  const userId = query?.userId as string | undefined
  if (!userId) return null
  return {
    userId,
    deviceId: (query?.deviceId as string) || '',
    role: (query?.role as string) || Roles.STAFF,
    branchId: (query?.branchId as string | null) ?? null
  }
}

export function assertAssignedBranchWrite(ctx: AuditContext): AuditContext {
  const assigned = appState.getBranchId()
  if (assigned && ctx.branchId && ctx.branchId !== assigned) {
    throw new Error('Switch back to your assigned branch to make changes')
  }
  return ctx
}

/** Fields to merge on INSERT (all auditable tables) */
export function auditCreate(ctx: AuditContext): Record<string, unknown> {
  return {
    created_by: ctx.userId,
    updated_by: ctx.userId
  }
}

/** INSERT fields for purchases, sales, and expenses only */
export function auditCreateWithDevice(ctx: AuditContext): Record<string, unknown> {
  return {
    ...auditCreate(ctx),
    device_id: ctx.deviceId
  }
}

/** Fields to merge on UPDATE */
export function auditUpdate(ctx: AuditContext): Record<string, unknown> {
  return {
    updated_by: ctx.userId,
    updated_at: new Date()
  }
}

/** Fields to merge on soft DELETE */
export function auditDelete(ctx: AuditContext): Record<string, unknown> {
  return {
    ...auditUpdate(ctx),
    deleted_by: ctx.userId,
    deleted_at: new Date()
  }
}

export function withAuditCreate(
  ctx: AuditContext,
  data: Record<string, unknown>
): Record<string, unknown> {
  return { ...data, ...auditCreate(ctx) }
}

export function withAuditCreateWithDevice(
  ctx: AuditContext,
  data: Record<string, unknown>
): Record<string, unknown> {
  return { ...data, ...auditCreateWithDevice(ctx) }
}

export function withAuditUpdate(
  ctx: AuditContext,
  data: Record<string, unknown>
): Record<string, unknown> {
  return { ...data, ...auditUpdate(ctx) }
}

export function joinAuditUsers(q: Knex.QueryBuilder, tableAlias: string): Knex.QueryBuilder {
  return q
    .leftJoin(`user_profiles as creator`, `${tableAlias}.created_by`, 'creator.id')
    .leftJoin(`user_profiles as updater`, `${tableAlias}.updated_by`, 'updater.id')
}

export function canViewAllInBranch(role: string): boolean {
  return role === Roles.COMPANY_OWNER || role === Roles.BRANCH_ADMIN || role === Roles.SUPER_ADMIN
}

export function canViewAllInCompany(role: string): boolean {
  return role === Roles.COMPANY_OWNER || role === Roles.SUPER_ADMIN
}

/**
 * Staff: only records they created.
 * Branch admin: all records in their branch.
 * Owner: all records in company (no extra filter).
 */
export function applyStaffScope(
  q: Knex.QueryBuilder,
  ctx: AuditContext | null,
  createdByColumn: string,
  branchColumn?: string
): Knex.QueryBuilder {
  if (!ctx) return q
  if (canViewAllInCompany(ctx.role)) return q
  if (canViewAllInBranch(ctx.role) && branchColumn && ctx.branchId) {
    return q.where(branchColumn, ctx.branchId)
  }
  if (ctx.role === Roles.STAFF) {
    return q.where(createdByColumn, ctx.userId)
  }
  return q
}

export function enrichAuditUsers(row: Record<string, unknown>): Record<string, unknown> {
  const base = asJson(row)!
  const {
    creatorFirstName,
    creatorLastName,
    updaterFirstName,
    updaterLastName,
    ...rest
  } = base

  return {
    ...rest,
    createdByUser: creatorFirstName
      ? { firstName: creatorFirstName, lastName: creatorLastName }
      : null,
    updatedByUser: updaterFirstName
      ? { firstName: updaterFirstName, lastName: updaterLastName }
      : null
  }
}

export function formatAuditUserName(user: { firstName?: string; lastName?: string } | null | undefined): string {
  if (!user?.firstName) return '—'
  return `${user.firstName} ${user.lastName || ''}`.trim()
}
