import { Router } from 'express'
import type { Knex } from 'knex'
import { loginUser, sendOtp, getBootstrapData, refreshSession, releaseDevice } from './service'
import type { OtpPurpose } from '../../utils/otp'
import { requireAuth, type AuthRequest } from '../../middleware/auth'
import { verifyTokenAllowExpired } from '../../utils/jwt'

export function authRouter(db: Knex): Router {
  const router = Router()

  router.post('/login', async (req, res) => {
    try {
      const { email, password, clientDeviceId, otp, otpPurpose, appVersion } = req.body

      if (!email || !password || !clientDeviceId) {
        return res.status(400).json({ error: 'email, password, and clientDeviceId are required' })
      }

      const result = await loginUser(db, {
        email,
        password,
        clientDeviceId,
        otp,
        otpPurpose,
        appVersion
      })

      if (result.status === 'invalid_credentials') {
        return res.status(401).json({ error: 'Invalid credentials or OTP' })
      }
      if (result.status === 'otp_required') {
        return res.status(403).json({
          requiresOtp: true,
          otpPurpose: result.purpose,
          message: result.message
        })
      }
      if (result.status === 'blocked') {
        return res.status(403).json({
          blocked: true,
          code: result.code,
          message: result.message
        })
      }
      if (result.status !== 'success') {
        return res.status(401).json({ error: 'Login failed' })
      }

      res.json({
        token: result.token,
        deviceId: result.deviceId,
        branchName: result.branchName,
        companyName: result.companyName,
        dbName: result.dbName,
        dataEpoch: result.dataEpoch,
        tokenExpiresAt: result.tokenExpiresAt,
        offlineAllowedUntil: result.offlineAllowedUntil,
        user: {
          id: result.user.id,
          email: result.user.email,
          firstName: result.user.firstName,
          lastName: result.user.lastName,
          companyId: result.user.companyId,
          branchId: result.user.branchId,
          role: result.user.role,
          permissions: result.user.permissions,
          emailVerified: result.user.emailVerified
        }
      })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  router.post('/refresh', async (req, res) => {
    try {
      const header = req.headers.authorization
      const { clientDeviceId } = req.body

      if (!header?.startsWith('Bearer ') || !clientDeviceId) {
        return res.status(400).json({ error: 'Bearer token and clientDeviceId are required' })
      }

      let payload
      try {
        payload = verifyTokenAllowExpired(header.slice(7))
      } catch {
        return res.status(401).json({ error: 'Invalid token' })
      }

      const result = await refreshSession(db, payload, clientDeviceId)
      if (result.status === 'invalid_session') {
        return res.status(401).json({ error: 'Session expired. Please login again.' })
      }

      res.json({
        token: result.token,
        deviceId: result.deviceId,
        branchName: result.branchName,
        companyName: result.companyName,
        dbName: result.dbName,
        dataEpoch: result.dataEpoch,
        tokenExpiresAt: result.tokenExpiresAt,
        offlineAllowedUntil: result.offlineAllowedUntil,
        user: {
          id: result.user.id,
          email: result.user.email,
          firstName: result.user.firstName,
          lastName: result.user.lastName,
          companyId: result.user.companyId,
          branchId: result.user.branchId,
          role: result.user.role,
          permissions: result.user.permissions,
          emailVerified: result.user.emailVerified
        }
      })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  router.post('/send-otp', async (req, res) => {
    try {
      const { email, purpose } = req.body as { email: string; purpose: OtpPurpose }
      if (!email || !purpose) {
        return res.status(400).json({ error: 'email and purpose are required' })
      }
      await sendOtp(db, email, purpose)
      res.json({ success: true, message: 'OTP sent if the account exists' })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/bootstrap', requireAuth, async (req: AuthRequest, res) => {
    try {
      const companyId = req.auth?.companyId
      const branchId = req.auth?.branchId ?? null

      if (!companyId) {
        return res.json({
          company: null,
          branch: null,
          branches: [],
          roles: [],
          permissions: [],
          rolePermissions: [],
          users: [],
          userRoles: [],
          taxes: []
        })
      }

      const data = await getBootstrapData(db, companyId, branchId)
      res.json(data)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  router.post('/release-device', requireAuth, async (req: AuthRequest, res) => {
    try {
      const clientDeviceId =
        (req.body?.clientDeviceId as string | undefined) || req.auth?.deviceId
      if (!clientDeviceId) {
        return res.status(400).json({ error: 'clientDeviceId is required' })
      }
      const result = await releaseDevice(db, clientDeviceId, req.auth?.deviceId)
      res.json(result)
    } catch (err: any) {
      res.status(400).json({ error: err.message })
    }
  })

  return router
}
