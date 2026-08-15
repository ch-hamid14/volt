import { useEffect, useState } from 'react'
import { Button, Card, Input, Select, Table, Typography, message } from 'antd'
import { VIEW_ONLY_BRANCH_HINT } from '@/common'
import { inventoryAPI } from '@/renderer/services'
import { useSession } from '@/renderer/hooks/useSession'
import { PageHeader } from '../shared/page-ui'
import { ADJUST_STATUS_OPTIONS, STATUS_COLORS } from './inventory-ui'

const { Text } = Typography

export const Adjustment = () => {
  const { companyId, branchId, audit, canMutate } = useSession()
  const [items, setItems] = useState<any[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [status, setStatus] = useState<string>('returned')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)

  const load = () => {
    inventoryAPI.list(companyId, branchId, { pageSize: 500 }).then((res: any) => {
      setItems((res.items || []).filter((i: any) => i.status !== 'sold'))
    })
  }

  useEffect(() => {
    if (companyId && branchId) load()
  }, [companyId, branchId])

  const handleAdjust = async () => {
    if (!canMutate) {
      message.error(VIEW_ONLY_BRANCH_HINT)
      return
    }
    if (!selected.length) {
      message.error('Select at least one unit')
      return
    }
    setLoading(true)
    try {
      const res: any = await inventoryAPI.adjust(companyId, audit(), {
        branchId,
        productItemIds: selected,
        status,
        notes
      })
      message.success(`Adjusted ${res.count} unit(s)`)
      setSelected([])
      setNotes('')
      load()
    } catch (err: any) {
      message.error(err.message || 'Adjustment failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Adjustment"
        subtitle="Mark units as returned, damaged, in service, or back in stock."
        extra={
          <div className="flex flex-wrap gap-2 items-center">
            <Select
              style={{ width: 160 }}
              options={ADJUST_STATUS_OPTIONS}
              value={status}
              onChange={setStatus}
            />
            <Input
              placeholder="Notes (optional)"
              style={{ width: 220 }}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <Button type="primary" loading={loading} disabled={!canMutate || !selected.length} onClick={handleAdjust}>
              Apply {selected.length ? `(${selected.length})` : ''}
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
            {
              title: 'Current Status',
              dataIndex: 'status',
              render: (s) => (
                <span style={{ color: STATUS_COLORS[s] ? undefined : undefined }}>
                  {s?.replace(/_/g, ' ')}
                </span>
              )
            }
          ]}
        />
      </Card>
    </div>
  )
}

export default Adjustment
