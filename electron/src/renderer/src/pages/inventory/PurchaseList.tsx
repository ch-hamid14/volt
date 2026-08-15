import { useEffect, useMemo, useState } from 'react'
import { Button, Card, DatePicker, Input, Select, Space, Table, Tag, Tooltip } from 'antd'
import type { TableProps } from 'antd'
import { EditOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useNavigate } from 'react-router-dom'
import { App_Routes, Roles, VIEW_ONLY_BRANCH_HINT } from '@/common'
import { partPurchaseAPI, purchaseAPI, supplierAPI } from '@/renderer/services'
import { useSession } from '@/renderer/hooks/useSession'
import { formatRs, formatAuditUser, PageHeader } from '../shared/page-ui'

const { RangePicker } = DatePicker

type PurchaseKind = 'product' | 'part' | 'all'

type UnifiedRow = {
  key: string
  kind: 'product' | 'part'
  id: string
  reference: string
  purchaseDate: string
  supplier?: { name?: string } | null
  updatedByUser?: unknown
  createdByUser?: unknown
  itemCount: number
  totalValue: number
  editable: boolean
}

export const PurchaseList = () => {
  const navigate = useNavigate()
  const { companyId, branchId, user, canMutate } = useSession()
  const canEditPurchases = user?.role === Roles.COMPANY_OWNER && canMutate
  const [data, setData] = useState<UnifiedRow[]>([])
  const [suppliers, setSuppliers] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [supplierId, setSupplierId] = useState<string>()
  const [kind, setKind] = useState<PurchaseKind>('all')
  const [search, setSearch] = useState('')
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null)
  const [totalValueSort, setTotalValueSort] = useState<'asc' | 'desc'>()

  useEffect(() => {
    if (!companyId) return
    supplierAPI.list(companyId).then(setSuppliers)
  }, [companyId])

  const load = () => {
    if (!companyId || !branchId) return
    setLoading(true)
    const filters = {
      supplierId,
      search: search || undefined,
      fromDate: dateRange?.[0]?.format('YYYY-MM-DD'),
      toDate: dateRange?.[1]?.format('YYYY-MM-DD')
    }

    const productPromise =
      kind === 'part'
        ? Promise.resolve([])
        : purchaseAPI.list(companyId, branchId, filters)

    const partPromise =
      kind === 'product'
        ? Promise.resolve([])
        : partPurchaseAPI.list(companyId, branchId, filters)

    Promise.all([productPromise, partPromise])
      .then(([products, parts]) => {
        const productRows: UnifiedRow[] = ((products as any[]) || []).map((r) => ({
          key: `product-${r.id}`,
          kind: 'product',
          id: r.id,
          reference: String(r.id || '').slice(0, 8),
          purchaseDate: r.purchaseDate,
          supplier: r.supplier,
          updatedByUser: r.updatedByUser,
          createdByUser: r.createdByUser,
          itemCount: Number(r.itemCount || 0),
          totalValue: Number(r.totalValue || 0),
          editable: Boolean(r.editable)
        }))
        const partRows: UnifiedRow[] = ((parts as any[]) || []).map((r) => ({
          key: `part-${r.id}`,
          kind: 'part',
          id: r.id,
          reference: String(r.id || '').slice(0, 8),
          purchaseDate: r.purchaseDate,
          supplier: r.supplier,
          updatedByUser: r.updatedByUser,
          createdByUser: r.createdByUser,
          itemCount: Number(r.totalUnits ?? r.lineCount ?? 0),
          totalValue: Number(r.totalValue || 0),
          editable: Boolean(r.editable)
        }))

        let merged = [...productRows, ...partRows]
        merged.sort((a, b) => dayjs(b.purchaseDate).valueOf() - dayjs(a.purchaseDate).valueOf())

        if (totalValueSort) {
          merged.sort((a, b) =>
            totalValueSort === 'asc' ? a.totalValue - b.totalValue : b.totalValue - a.totalValue
          )
        }
        setData(merged)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [companyId, branchId, supplierId, search, dateRange, totalValueSort, kind])

  const supplierOptions = useMemo(
    () => suppliers.map((s) => ({ value: s.id, label: s.name })),
    [suppliers]
  )

  const handleTableChange: TableProps<UnifiedRow>['onChange'] = (_pagination, _filters, sorter) => {
    const active = Array.isArray(sorter) ? sorter[0] : sorter
    if (active?.field === 'totalValue' && active.order) {
      setTotalValueSort(active.order === 'ascend' ? 'asc' : 'desc')
    } else {
      setTotalValueSort(undefined)
    }
  }

  return (
    <div>
      <PageHeader
        title="Purchase List"
        subtitle="Product and parts purchases at this branch."
        extra={
          <Tooltip title={!canMutate ? VIEW_ONLY_BRANCH_HINT : undefined}>
            <span>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                disabled={!canMutate}
                onClick={() => navigate(App_Routes.ADD_PURCHASE)}
              >
                Add Purchase
              </Button>
            </span>
          </Tooltip>
        }
      />

      <Card bordered={false} className="shadow-sm mb-4">
        <div className="flex flex-wrap gap-3">
          <RangePicker
            value={dateRange}
            onChange={(v) => setDateRange(v as [dayjs.Dayjs, dayjs.Dayjs] | null)}
          />
          <Select
            allowClear
            placeholder="Supplier"
            style={{ width: 200 }}
            options={supplierOptions}
            value={supplierId}
            onChange={setSupplierId}
          />
          <Select
            placeholder="Type"
            style={{ width: 140 }}
            value={kind}
            onChange={setKind}
            options={[
              { value: 'all', label: 'All' },
              { value: 'product', label: 'Products' },
              { value: 'part', label: 'Parts' }
            ]}
          />
          <Input.Search
            placeholder="Search reference, chassis, motor, or part…"
            allowClear
            onSearch={setSearch}
            style={{ width: 300 }}
          />
          <Button
            onClick={() => {
              setSupplierId(undefined)
              setSearch('')
              setDateRange(null)
              setTotalValueSort(undefined)
              setKind('all')
            }}
          >
            Reset
          </Button>
        </div>
      </Card>

      <Card bordered={false} className="shadow-sm">
        <Table
          rowKey="key"
          loading={loading}
          dataSource={data}
          onChange={handleTableChange}
          pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `${t} purchases` }}
          columns={[
            {
              title: 'Type',
              dataIndex: 'kind',
              width: 100,
              render: (v: UnifiedRow['kind']) =>
                v === 'part' ? <Tag color="blue">Part</Tag> : <Tag>Product</Tag>
            },
            {
              title: 'Reference',
              dataIndex: 'reference',
              width: 110,
              render: (v: string, r) => (
                <Tooltip title={r.id}>
                  <span className="font-mono text-xs">{v}</span>
                </Tooltip>
              )
            },
            {
              title: 'Date',
              dataIndex: 'purchaseDate',
              render: (v) => dayjs(v).format('DD MMM YYYY')
            },
            {
              title: 'Supplier',
              dataIndex: 'supplier',
              render: (s) => s?.name || '—'
            },
            {
              title: 'Updated by',
              render: (_, r) => formatAuditUser((r.updatedByUser || r.createdByUser) as any)
            },
            {
              title: 'Units',
              dataIndex: 'itemCount',
              align: 'right' as const
            },
            {
              title: 'Total Value',
              dataIndex: 'totalValue',
              sorter: true,
              sortOrder:
                totalValueSort === 'asc'
                  ? 'ascend'
                  : totalValueSort === 'desc'
                    ? 'descend'
                    : null,
              align: 'right' as const,
              render: formatRs
            },
            {
              title: '',
              width: 88,
              render: (_, r) => {
                const detail =
                  r.kind === 'part'
                    ? App_Routes.PART_PURCHASE_DETAIL.replace(':id', r.id)
                    : App_Routes.PURCHASE_DETAIL.replace(':id', r.id)
                const edit =
                  r.kind === 'part'
                    ? App_Routes.PART_PURCHASE_EDIT.replace(':id', r.id)
                    : App_Routes.PURCHASE_EDIT.replace(':id', r.id)
                const canEdit = Boolean(r.editable) && canEditPurchases
                return (
                  <Space size={0}>
                    <Button type="text" icon={<EyeOutlined />} onClick={() => navigate(detail)} />
                    {canEdit ? (
                      <Button type="text" icon={<EditOutlined />} onClick={() => navigate(edit)} />
                    ) : (
                      <Tooltip
                        title={
                          !canMutate
                            ? VIEW_ONLY_BRANCH_HINT
                            : !canEditPurchases
                            ? 'Only company owners can edit purchases'
                            : 'Edit unavailable'
                        }
                      >
                        <Button type="text" icon={<EditOutlined />} disabled />
                      </Tooltip>
                    )}
                  </Space>
                )
              }
            }
          ]}
        />
      </Card>
    </div>
  )
}

export default PurchaseList
