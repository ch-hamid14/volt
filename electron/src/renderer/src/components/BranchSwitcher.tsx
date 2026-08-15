import { useEffect, useMemo, useState } from 'react'
import { useDispatch } from 'react-redux'
import { useLocation, useNavigate } from 'react-router-dom'
import { Select, Tag, message } from 'antd'
import { App_Routes } from '@/common'
import { appActions } from '@/renderer/redux'
import { useSession } from '@/renderer/hooks/useSession'
import { branchAPI } from '@/renderer/services'

type BranchOption = { id: string; name: string }

export function BranchSwitcher() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const location = useLocation()
  const { companyId, branchId, branchName, assignedBranchId, canSwitchBranch } = useSession()
  const [branches, setBranches] = useState<BranchOption[]>([])

  useEffect(() => {
    if (!companyId || !canSwitchBranch) return
    branchAPI.list(companyId).then((rows: BranchOption[]) => {
      setBranches((rows || []).map((b) => ({ id: b.id, name: b.name })))
    }).catch(() => setBranches([]))
  }, [companyId, canSwitchBranch])

  useEffect(() => {
    if (!canSwitchBranch || !branches.length) return

    const current = branches.find((b) => b.id === branchId)
    if (current) {
      if (current.name !== branchName) {
        dispatch(appActions.setViewingBranch({ id: current.id, name: current.name }))
      }
      return
    }

    const fallback =
      branches.find((b) => b.id === assignedBranchId) || branches[0]
    if (!fallback) return
    dispatch(appActions.setViewingBranch({ id: fallback.id, name: fallback.name }))
  }, [assignedBranchId, branchId, branchName, branches, canSwitchBranch, dispatch])

  const options = useMemo(
    () => branches.map((b) => ({ value: b.id, label: b.name })),
    [branches]
  )

  if (!canSwitchBranch) {
    if (!branchName) return null
    return (
      <Tag bordered={false} className="app-branch-tag">
        {branchName}
      </Tag>
    )
  }

  if (!options.length) {
    if (!branchName) return null
    return (
      <Tag bordered={false} className="app-branch-tag">
        {branchName}
      </Tag>
    )
  }

  const handleChange = (id: string) => {
    const branch = branches.find((b) => b.id === id)
    if (!branch || branch.id === branchId) return
    dispatch(appActions.setViewingBranch({ id: branch.id, name: branch.name }))
    if (location.pathname !== App_Routes.DASHBOARD) {
      navigate(App_Routes.DASHBOARD)
    }
    message.success(`Viewing ${branch.name}`)
  }

  return (
    <Select
      className="app-branch-select"
      popupMatchSelectWidth={false}
      options={options}
      value={branchId || undefined}
      onChange={handleChange}
      optionFilterProp="label"
      showSearch
      aria-label="Viewing branch"
    />
  )
}
