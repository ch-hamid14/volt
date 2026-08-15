import { getDb } from '../../db'
import { generateId } from '../../../common/utils/uuid'

function toDate(val: unknown): Date {
  return val ? new Date(val as string) : new Date()
}

function comparable(value: unknown): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    // Normalize ISO timestamps for equality checks.
    const asDate = Date.parse(trimmed)
    if (!Number.isNaN(asDate) && /^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      return new Date(asDate).toISOString()
    }
    return trimmed
  }
  return String(value)
}

/** True when any business field in `data` differs from `existing` (ignores updated_at). */
function rowNeedsUpdate(
  existing: Record<string, unknown>,
  data: Record<string, unknown>
): boolean {
  for (const [key, next] of Object.entries(data)) {
    if (key === 'updated_at') continue
    if (comparable(existing[key]) !== comparable(next)) return true
  }
  return false
}

async function upsertRow(table: string, id: string, data: Record<string, unknown>): Promise<void> {
  const db = getDb()
  const existing = await db(table).where({ id }).first()
  if (existing) {
    if (!rowNeedsUpdate(existing as Record<string, unknown>, data)) return
    await db(table).where({ id }).update({ ...data, updated_at: new Date() })
  } else {
    await db(table).insert({ id, ...data })
  }
}

export async function cacheBootstrapData(data: any): Promise<void> {
  const db = getDb()

  if (data.company) {
    await upsertRow('company_profile', data.company.id, {
      name: data.company.name,
      email: data.company.email || '',
      phone: data.company.phone || '',
      status: data.company.status || 'active',
      created_at: toDate(data.company.created_at),
      updated_at: toDate(data.company.updated_at)
    })
  }

  for (const branch of data.branches || []) {
    await upsertRow('branches', branch.id, {
      company_id: branch.company_id,
      name: branch.name,
      location: branch.location || '',
      is_active: branch.is_active ?? true,
      created_at: toDate(branch.created_at),
      updated_at: toDate(branch.updated_at)
    })
  }

  for (const perm of data.permissions || []) {
    const existing = await db('permissions').where({ key: perm.key }).first()
    if (existing) {
      const next = {
        label: perm.label,
        updated_at: toDate(perm.updated_at)
      }
      if (!rowNeedsUpdate(existing as Record<string, unknown>, next)) continue
      await db('permissions').where({ id: existing.id }).update(next)
    } else {
      await db('permissions').insert({
        id: perm.id,
        key: perm.key,
        label: perm.label,
        created_at: toDate(perm.created_at),
        updated_at: toDate(perm.updated_at)
      })
    }
  }

  for (const role of data.roles || []) {
    if (!role.company_id) continue
    await upsertRow('roles', role.id, {
      company_id: role.company_id,
      name: role.name,
      description: role.description || '',
      created_at: toDate(role.created_at),
      updated_at: toDate(role.updated_at)
    })
  }

  for (const rp of data.rolePermissions || []) {
    const exists = await db('role_permissions')
      .where({ role_id: rp.role_id, permission_id: rp.permission_id })
      .first()
    if (exists) continue

    const roleExists = await db('roles').where({ id: rp.role_id }).first()
    if (!roleExists) {
      console.warn('Skipping role_permissions: roles missing for', rp.role_id)
      continue
    }
    const permExists = await db('permissions').where({ id: rp.permission_id }).first()
    if (!permExists) {
      console.warn('Skipping role_permissions: permissions missing for', rp.permission_id)
      continue
    }

    await db('role_permissions').insert({
      id: rp.id || generateId(),
      role_id: rp.role_id,
      permission_id: rp.permission_id,
      created_at: toDate(rp.created_at),
      updated_at: toDate(rp.updated_at)
    })
  }

  for (const u of data.users || []) {
    if (!u.company_id) continue
    await upsertRow('user_profiles', u.id, {
      company_id: u.company_id,
      branch_id: u.branch_id,
      email: u.email,
      first_name: u.first_name,
      last_name: u.last_name,
      role: u.role,
      is_active: true,
      email_verified: u.email_verified ?? false,
      created_at: toDate(u.created_at),
      updated_at: toDate(u.updated_at)
    })
  }

  for (const ur of data.userRoles || []) {
    const exists = await db('user_roles').where({ user_id: ur.user_id, role_id: ur.role_id }).first()
    if (exists) continue

    const userExists = await db('user_profiles').where({ id: ur.user_id }).first()
    if (!userExists) {
      console.warn('Skipping user_roles: user_profiles missing for', ur.user_id)
      continue
    }
    const roleExists = await db('roles').where({ id: ur.role_id }).first()
    if (!roleExists) {
      console.warn('Skipping user_roles: roles missing for', ur.role_id)
      continue
    }

    await db('user_roles').insert({
      id: ur.id || generateId(),
      user_id: ur.user_id,
      role_id: ur.role_id,
      created_at: toDate(ur.created_at),
      updated_at: toDate(ur.updated_at)
    })
  }

  for (const tax of data.taxes || []) {
    if (!tax.company_id) continue
    await upsertRow('taxes', tax.id, {
      company_id: tax.company_id,
      name: tax.name,
      code: tax.code ?? null,
      default_percent: Number(tax.default_percent ?? 0),
      inclusive_default: Boolean(tax.inclusive_default),
      is_system: Boolean(tax.is_system),
      sort_order: Number(tax.sort_order ?? 100),
      created_at: toDate(tax.created_at),
      updated_at: toDate(tax.updated_at)
    })
  }
}

/** Upsert the signed-in user profile only when local fields differ. */
export async function upsertSessionUserProfile(input: {
  id: string
  companyId: string
  branchId: string | null | undefined
  email: string
  firstName: string
  lastName: string
  role: string
  emailVerified?: boolean
}): Promise<void> {
  const db = getDb()
  const existing = await db('user_profiles').where({ id: input.id }).first()
  const row = {
    company_id: input.companyId,
    branch_id: input.branchId ?? null,
    email: input.email,
    first_name: input.firstName,
    last_name: input.lastName,
    role: input.role,
    is_active: true,
    email_verified: input.emailVerified ?? false
  }

  if (existing) {
    if (!rowNeedsUpdate(existing as Record<string, unknown>, row)) return
    await db('user_profiles').where({ id: input.id }).update({
      ...row,
      updated_at: new Date()
    })
    return
  }

  await db('user_profiles').insert({
    id: input.id,
    ...row,
    created_at: new Date(),
    updated_at: new Date()
  })
}
