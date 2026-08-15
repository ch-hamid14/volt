import { canSwitchBranch } from '@/common'
import { useSelector } from 'react-redux'
import { IRootState } from '../redux'
import { sessionAudit, type SessionAudit } from '../services/session-audit'

export function useSession() {
  const { user, deviceId, branchName, viewingBranchId, viewingBranchName, token } = useSelector(
    (s: IRootState) => s.app
  )
  const companyId = user?.companyId || ''
  const assignedBranchId = user?.branchId || ''
  const branchId = viewingBranchId || assignedBranchId
  const activeBranchName = viewingBranchName || branchName
  const canSwitch = canSwitchBranch(user?.role)
  const isViewingOtherBranch = Boolean(
    canSwitch && assignedBranchId && branchId && branchId !== assignedBranchId
  )

  const audit = (): SessionAudit => sessionAudit(user, deviceId, branchId)

  return {
    user,
    deviceId,
    branchName: activeBranchName,
    token,
    companyId,
    branchId,
    assignedBranchId,
    assignedBranchName: branchName,
    canSwitchBranch: canSwitch,
    isViewingOtherBranch,
    canMutate: !isViewingOtherBranch,
    audit
  }
}
