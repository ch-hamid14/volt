import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Select, Table, Typography, message } from 'antd'
import { VIEW_ONLY_BRANCH_HINT } from '@/common'
import { branchAPI, inventoryAPI } from '@/renderer/services'
import { useSession } from '@/renderer/hooks/useSession'
import { PageHeader } from '../shared/page-ui'

const { Text } = Typography

export const Transfer = () => {
  const { companyId, branchId, audit, canMutate } = useSession()
  const [branches, setBranches] = useState<any[]>([])
  const [items, setItems] = useState<any[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [toBranchId, setToBranchId] = useState<string>()
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!companyId || !branchId) return
    branchAPI.list(companyId).then(setBranches)
    inventoryAPI.list(companyId, branchId, { status: 'in_stock', pageSize: 500 }).then((res: any) => {
      setItems(res.items || [])
    })
  }, [companyId, branchId])

  const branchOptions = useMemo(
    () => branches.filter((b) => b.id !== branchId).map((b) => ({ value: b.id, label: b.name })),
    [branches, branchId]
  )

  const handleTransfer = async () => {
    if (!canMutate) {
      message.error(VIEW_ONLY_BRANCH_HINT)
      return
    }
    if (!toBranchId) {
      message.error('Select destination branch')
      return
    }
    if (!selected.length) {
      message.error('Select at least one unit')
      return
    }
    setLoading(true)
    try {
      const res: any = await inventoryAPI.transfer(companyId, audit(), {
        fromBranchId: branchId,
        toBranchId,
        productItemIds: selected
      })
      message.success(`Transferred ${res.count} unit(s)`)
      setSelected([])
      setToBranchId(undefined)
      const list: any = await inventoryAPI.list(companyId, branchId, { status: 'in_stock', pageSize: 500 })
      setItems(list.items || [])
    } catch (err: any) {
      message.error(err.message || 'Transfer failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Transfer"
        subtitle="Move in-stock units to another branch."
        extra={
          <div className="flex flex-wrap gap-2 items-center">
            <Select
              placeholder="Transfer to branch"
              style={{ width: 220 }}
              options={branchOptions}
              value={toBranchId}
              onChange={setToBranchId}
            />
            <Button type="primary" loading={loading} disabled={!canMutate || !selected.length} onClick={handleTransfer}>
              Transfer {selected.length ? `(${selected.length})` : ''}
            </Button>
          </div>
        }
      />

      <Card bordered={false} className="shadow-sm">
        <Table
          rowKey="id"
          dataSource={items}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: (keys) => setSelected(keys as string[])
          }}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          columns={[
            { title: 'Chassis Number', dataIndex: 'serialNumber', render: (v) => <Text strong>{v}</Text> },
            { title: 'Product', render: (_, r) => r.product?.name || '—' },
            { title: 'Color', render: (_, r) => r.color?.name || '—' }
          ]}
        />
      </Card>
    </div>
  )
}

export default Transfer
