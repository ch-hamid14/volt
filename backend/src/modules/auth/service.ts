import type { Knex } from 'knex'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import { signToken, type JwtPayload } from '../../utils/jwt'
import { createOtp, verifyOtp, type OtpPurpose } from '../../utils/otp'
import { getCompanyDb } from '../../db'

export type LoginInput = {
  email: string
  password: string
  clientDeviceId: string
  otp?: string
  otpPurpose?: OtpPurpose
  appVersion?: string
}

export type AuthUserResponse = {
  id: string
  email: string
  firstName: string
  lastName: string
  companyId: string | null
  branchId: string | null
  role: string
  permissions: string[]
  emailVerified: boolean
}

export type LoginResult =
  | {
      status: 'success'
      token: string
      user: AuthUserResponse
      deviceId: string
      branchName?: string
      companyName?: string
      /** Logical Postgres database name for this company (local POS mirrors this name). */
      dbName?: string
      /** Bumped on flush/restore — POS wipes local data when this advances. */
      dataEpoch: number
      tokenExpiresAt: string
      offlineAllowedUntil: string
    }
  | { status: 'otp_required'; purpose: OtpPurpose; message: string }
  | { status: 'invalid_credentials' }
  | { status: 'blocked'; code: 'maintenance' | 'plan_expired' | 'app_version'; message: string }

export type RefreshResult =
  | Extract<LoginResult, { status: 'success' }>
  | { status: 'invalid_session' }

async function getUserPermissions(controlDb: Knex, companyDb: Knex | null, user: {
  id: string
  role: string
}): Promise<string[]> {
  if (user.role === 'super_admin') {
    const rows = await controlDb('user_roles as ur')
      .join('role_permissions as rp', 'ur.role_id', 'rp.role_id')
      .join('permissions as p', 'rp.permission_id', 'p.id')
      .where('ur.user_id', user.id)
      .select('p.key')
    return [...new Set(rows.map((r: { key: string }) => r.key))]
  }

  if (!companyDb) return []

  const rows = await companyDb('user_roles as ur')
    .join('role_permissions as rp', 'ur.role_id', 'rp.role_id')
    .join('permissions as p', 'rp.permission_id', 'p.id')
    .where('ur.user_id', user.id)
    .select('p.key')

  return [...new Set(rows.map((r: { key: string }) => r.key))]
}

async function bindDevice(
  controlDb: Knex,
  user: { id: string; company_id: string | null; branch_id: string | null },
  clientDeviceId: string
): Promise<string> {
  let device = await controlDb('devices').where({ client_device_id: clientDeviceId }).first()

  if (!device) {
    const id = randomUUID()
    await controlDb('devices').insert({
      id,
      company_id: user.company_id,
      branch_id: user.branch_id,
      user_id: user.id,
      client_device_id: clientDeviceId,
      device_code: clientDeviceId,
      name: 'Desktop POS',
      created_at: new Date(),
      updated_at: new Date()
    })
    device = await controlDb('devices').where({ id }).first()
  } else {
    await controlDb('devices').where({ id: device.id }).update({
      user_id: user.id,
      company_id: user.company_id,
      branch_id: user.branch_id,
      updated_at: new Date()
    })
  }

  await controlDb('users').where({ id: user.id }).update({
    bound_device_id: clientDeviceId,
    updated_at: new Date()
  })

  return device.device_code as string
}

async function issueSessionToken(
  controlDb: Knex,
  user: {
    id: string
    email: string
    first_name: string
    last_name: string
    company_id: string | null
    branch_id: string | null
    role: string
    email_verified: boolean
  },
  clientDeviceId: string,
  deviceId: string
): Promise<Extract<LoginResult, { status: 'success' }>> {
  const companyDb = user.company_id ? await getCompanyDb(user.company_id as string) : null
  const permissions = await getUserPermissions(controlDb, companyDb, user)

  let branchName: string | undefined
  let companyName: string | undefined
  let dbName: string | undefined
  let dataEpoch = 1

  if (user.branch_id && companyDb) {
    const branch = await companyDb('branches').where({ id: user.branch_id }).first()
    branchName = branch?.name
  }
  if (user.company_id) {
    const company = await controlDb('companies').where({ id: user.company_id }).first()
    companyName = company?.name
    dbName = company?.db_name as string | undefined
    dataEpoch = Number(company?.data_epoch ?? 1)
  }

  const authUser: AuthUserResponse = {
    id: user.id,
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
    companyId: user.company_id,
    branchId: user.branch_id,
    role: user.role,
    permissions,
    emailVerified: user.email_verified
  }

  const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  /** Offline convenience window — must re-auth online after this. */
  const offlineAllowedUntil = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()

  const token = signToken({
    userId: user.id,
    email: user.email,
    companyId: user.company_id,
    branchId: user.branch_id,
    role: user.role,
    permissions,
    deviceId: clientDeviceId,
    tokenExpiresAt,
    offlineAllowedUntil
  })

  return {
    status: 'success',
    token,
    user: authUser,
    deviceId,
    branchName,
    companyName,
    dbName,
    dataEpoch,
    tokenExpiresAt,
    offlineAllowedUntil
  }
}

export async function refreshSession(
  controlDb: Knex,
  payload: JwtPayload,
  clientDeviceId: string
): Promise<RefreshResult> {
  if (
    payload.offlineAllowedUntil &&
    Date.now() > new Date(payload.offlineAllowedUntil).getTime()
  ) {
    return { status: 'invalid_session' }
  }

  const user = await controlDb('users').where({ id: payload.userId, is_active: true }).first()
  if (!user || user.email.toLowerCase() !== payload.email.toLowerCase()) {
    return { status: 'invalid_session' }
  }

  const isSuperAdmin = user.role === 'super_admin'
  if (!isSuperAdmin && user.bound_device_id && user.bound_device_id !== clientDeviceId) {
    return { status: 'invalid_session' }
  }

  const deviceId = isSuperAdmin
    ? clientDeviceId
    : await bindDevice(controlDb, user, clientDeviceId)

  return issueSessionToken(controlDb, user, clientDeviceId, deviceId)
}

export async function loginUser(controlDb: Knex, input: LoginInput): Promise<LoginResult> {
  const email = input.email.toLowerCase().trim()
  const user = await controlDb('users').where({ email, is_active: true }).first()
  if (!user) return { status: 'invalid_credentials' }

  const valid = await bcrypt.compare(input.password, user.password)
  if (!valid) return { status: 'invalid_credentials' }

  const isSuperAdmin = user.role === 'super_admin'

  if (!isSuperAdmin && user.company_id) {
    const company = await controlDb('companies').where({ id: user.company_id }).first()
    if (!company || company.status === 'inactive') {
      return {
        status: 'blocked',
        code: 'maintenance',
        message: 'This company account is inactive. Contact support.'
      }
    }
    if (company.maintenance_mode) {
      return {
        status: 'blocked',
        code: 'maintenance',
        message: 'This company is in maintenance mode. Try again later.'
      }
    }
    if (company.plan_expires_at && new Date(company.plan_expires_at) < new Date()) {
      return {
        status: 'blocked',
        code: 'plan_expired',
        message: 'This company subscription has expired. Contact support.'
      }
    }
    if (company.min_app_version && input.appVersion) {
      if (compareVersions(input.appVersion, company.min_app_version) < 0) {
        return {
          status: 'blocked',
          code: 'app_version',
          message: `Please update the POS app to version ${company.min_app_version} or newer.`
        }
      }
    }
    if (company.max_devices != null) {
      const [{ count }] = await controlDb('devices')
        .where({ company_id: user.company_id })
        .count('* as count')
      const deviceCount = Number(count)
      const existingDevice = await controlDb('devices')
        .where({ client_device_id: input.clientDeviceId })
        .first()
      if (!existingDevice && deviceCount >= Number(company.max_devices)) {
        return {
          status: 'blocked',
          code: 'maintenance',
          message: 'Device limit reached for this company.'
        }
      }
    }
  }

  if (!isSuperAdmin && !user.email_verified) {
    if (!input.otp || input.otpPurpose !== 'email_verify') {
      await createOtp(controlDb, email, 'email_verify')
      return {
        status: 'otp_required',
        purpose: 'email_verify',
        message: 'Please verify your email with the OTP sent to your inbox.'
      }
    }
    const otpValid = await verifyOtp(controlDb, email, input.otp, 'email_verify')
    if (!otpValid) return { status: 'invalid_credentials' }
    await controlDb('users').where({ id: user.id }).update({ email_verified: true, updated_at: new Date() })
    user.email_verified = true
  }

  if (!isSuperAdmin && user.bound_device_id && user.bound_device_id !== input.clientDeviceId) {
    if (!input.otp || input.otpPurpose !== 'device_reset') {
      await createOtp(controlDb, email, 'device_reset')
      return {
        status: 'otp_required',
        purpose: 'device_reset',
        message: 'This account is bound to another device. Verify OTP to reset device binding.'
      }
    }
    const otpValid = await verifyOtp(controlDb, email, input.otp, 'device_reset')
    if (!otpValid) return { status: 'invalid_credentials' }
    await controlDb('users').where({ id: user.id }).update({ bound_device_id: null, updated_at: new Date() })
    user.bound_device_id = null
  }

  const deviceId = isSuperAdmin
    ? input.clientDeviceId
    : await bindDevice(controlDb, user, input.clientDeviceId)

  return issueSessionToken(controlDb, user, input.clientDeviceId, deviceId)
}

export async function sendOtp(controlDb: Knex, email: string, purpose: OtpPurpose): Promise<void> {
  const normalized = email.toLowerCase().trim()
  const user = await controlDb('users').where({ email: normalized, is_active: true }).first()
  if (!user) return
  // Explicit resend: rotate so the user gets a fresh code
  await createOtp(controlDb, normalized, purpose, { rotate: true })
}

/**
 * Release this physical POS from control-plane binding so the next login can
 * register as a fresh device. Clears all users bound to clientDeviceId and
 * deletes the devices row(s) for that client id.
 */
export async function releaseDevice(
  controlDb: Knex,
  clientDeviceId: string,
  authDeviceId?: string
): Promise<{ ok: true }> {
  if (!clientDeviceId) {
    throw new Error('clientDeviceId is required')
  }
  // Only allow releasing the device on the current session token (or explicit match).
  if (authDeviceId && authDeviceId !== clientDeviceId) {
    throw new Error('Cannot release a different device than the authenticated session')
  }

  await controlDb.transaction(async (trx) => {
    await trx('users')
      .where({ bound_device_id: clientDeviceId })
      .update({ bound_device_id: null, updated_at: new Date() })
    await trx('devices').where({ client_device_id: clientDeviceId }).delete()
  })

  return { ok: true }
}

export async function getBootstrapData(
  controlDb: Knex,
  companyId: string,
  branchId: string | null
) {
  const companyDb = await getCompanyDb(companyId)
  const company = await controlDb('companies').where({ id: companyId }).first()
  const profile = await companyDb('company_profile').where({ id: companyId }).first()
  const branches = await companyDb('branches').where({ company_id: companyId }).whereNull('deleted_at')
  const branch = branchId
    ? await companyDb('branches').where({ id: branchId }).first()
    : branches[0]

  const roles = await companyDb('roles').where({ company_id: companyId }).whereNull('deleted_at')
  const permissions = await companyDb('permissions').select('*')
  const rolePermissions = await companyDb('role_permissions as rp')
    .join('roles as r', 'rp.role_id', 'r.id')
    .where('r.company_id', companyId)
    .select('rp.*')
  const users = await companyDb('user_profiles')
    .where({ company_id: companyId, is_active: true })
    .whereNull('deleted_at')
    .select('id', 'company_id', 'branch_id', 'email', 'first_name', 'last_name', 'role', 'email_verified', 'created_at', 'updated_at')
  const userRoles = await companyDb('user_roles as ur')
    .join('user_profiles as u', 'ur.user_id', 'u.id')
    .join('roles as r', 'ur.role_id', 'r.id')
    .where('u.company_id', companyId)
    .andWhere('u.is_active', true)
    .whereNull('u.deleted_at')
    .whereNull('r.deleted_at')
    .select('ur.*')

  const taxes = (await companyDb.schema.hasTable('taxes'))
    ? await companyDb('taxes')
        .where({ company_id: companyId })
        .whereNull('deleted_at')
        .select(
          'id',
          'company_id',
          'name',
          'code',
          'default_percent',
          'inclusive_default',
          'is_system',
          'sort_order',
          'created_at',
          'updated_at'
        )
    : []

  return {
    company: {
      ...(company || profile),
      plan: company?.plan,
      maintenanceMode: Boolean(company?.maintenance_mode),
      featureFlags: parseFlags(company?.feature_flags),
      minAppVersion: company?.min_app_version ?? null,
      planExpiresAt: company?.plan_expires_at ?? null
    },
    branch,
    branches,
    roles,
    permissions,
    rolePermissions,
    users,
    userRoles,
    taxes
  }
}

function parseFlags(value: unknown): Record<string, boolean> {
  if (!value) return {}
  if (typeof value === 'object') return value as Record<string, boolean>
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return {}
    }
  }
  return {}
}

/** Returns negative if a < b, 0 if equal, positive if a > b. */
function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0)
  const pb = b.replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d
  }
  return 0
}
