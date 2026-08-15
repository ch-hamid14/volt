import { canSwitchBranch, IUser } from '@/common'
import { createSlice } from '@reduxjs/toolkit'

type AppState = {
  user: IUser | null
  deviceId: string | null
  branchName: string | null
  viewingBranchId: string | null
  viewingBranchName: string | null
  token: string | null
  tokenExpiresAt: string | null
  offlineAllowedUntil: string | null
  cachedEmail: string | null
}

const initialState: AppState = {
  user: null,
  deviceId: null,
  branchName: null,
  viewingBranchId: null,
  viewingBranchName: null,
  token: null,
  tokenExpiresAt: null,
  offlineAllowedUntil: null,
  cachedEmail: null
}

const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    setSession: (state, action) => {
      const { user, deviceId, branchName, token, tokenExpiresAt, offlineAllowedUntil } = action.payload
      const keepViewing =
        canSwitchBranch(user?.role) &&
        state.user?.id === user?.id &&
        Boolean(state.viewingBranchId)

      state.user = user
      state.deviceId = deviceId
      state.branchName = branchName || null
      state.token = token || user?.token || null
      state.tokenExpiresAt = tokenExpiresAt || null
      state.offlineAllowedUntil = offlineAllowedUntil || null
      state.cachedEmail = user?.email || null

      if (!keepViewing) {
        state.viewingBranchId = user?.branchId || null
        state.viewingBranchName = branchName || null
      }
    },
    setViewingBranch: (state, action) => {
      if (!canSwitchBranch(state.user?.role)) return
      state.viewingBranchId = action.payload.id || null
      state.viewingBranchName = action.payload.name || null
    },
    clearSession: (state) => {
      state.user = null
      state.deviceId = null
      state.branchName = null
      state.viewingBranchId = null
      state.viewingBranchName = null
      state.token = null
      state.tokenExpiresAt = null
      state.offlineAllowedUntil = null
      state.cachedEmail = null
    }
  }
})

export const appActions = appSlice.actions
export const appReducer = appSlice.reducer
