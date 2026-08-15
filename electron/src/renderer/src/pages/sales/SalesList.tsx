import { useEffect, useMemo, useState } from 'react'
import { Button, Card, DatePicker, Input, Select, Space, Table, Tooltip, Typography } from 'antd'
import type { TableProps } from 'antd'
import { EditOutlined, EyeOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useNavigate } from 'react-router-dom'
import { App_Routes, Roles, VIEW_ONLY_BRANCH_HINT } from '@/common'
import { customerAPI, saleAPI } from '@/renderer/services'
import { useSession } from '@/renderer/hooks/useSession'
import { formatRs, formatAuditUser, PageHeader } from '../shared/page-ui'

const { Text } = Typography
const { RangePicker } = DatePicker

type SaleSortField = 'netTotal' | 'paidAmount' | 'dueAmount'

export const SalesList = () => {
  const navigate = useNavigate()
  const { companyId, branchId, user, canMutate } = useSession()
  const canEditSales = user?.role === Roles.COMPANY_OWNER && canMutate
  const [data, setData] = useState<any[]>([])
  const [customers, setCustomers] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [customerId, setCustomerId] = useState<string>()
  const [billNo, setBillNo] = useState('')
  const [search, setSearch] = useState('')
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null)
  const [sortField, setSortField] = useState<SaleSortField>()
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>()

  useEffect(() => {
    if (!companyId) return
    customerAPI.list(companyId).then(setCustomers)
  }, [companyId])

  const load = () => {
    setLoading(true)
    saleAPI
      .list(companyId, branchId, {
        customerId,
        billNo: billNo || undefined,
        search: search || undefined,
        fromDate: dateRange?.[0]?.format('YYYY-MM-DD'),
        toDate: dateRange?.[1]?.format('YYYY-MM-DD'),
        sortField,
        sortOrder
      })
      .then(setData)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (companyId && branchId) load()
  }, [companyId, branchId, customerId, billNo, search, dateRange, sortField, sortOrder])

  const customerOptions = useMemo(
    () => customers.map((c) => ({ value: c.id, label: c.name })),
    [customers]
  )

  const columnSortOrder = (field: SaleSortField) =>
    sortField === field ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null

  const handleTableChange: TableProps<any>['onChange'] = (_pagination, _filters, sorter) => {
    const active = Array.isArray(sorter) ? sorter[0] : sorter
    if (
      active?.order &&
      (active.field === 'netTotal' || active.field === 'paidAmount' || active.field === 'dueAmount')
    ) {
      setSortField(active.field as SaleSortField)
      setSortOrder(active.order === 'ascend' ? 'asc' : 'desc')
    } else {
      setSortField(undefined)
      setSortOrder(undefined)
    }
  }

  return (
    <div>
      <PageHeader title="Sales List" subtitle="All sales at this branch." />

      <Card bordered={false} className="shadow-sm mb-4">
        <div className="flex flex-wrap gap-3">
          <Input.Search
            placeholder="Bill number"
            allowClear
            onSearch={setBillNo}
            style={{ width: 160 }}
          />
          <Input.Search
            placeholder="Chassis or motor number…"
            allowClear
            onSearch={setSearch}
            style={{ width: 240 }}
          />
          <RangePicker
            value={dateRange}
            onChange={(v) => setDateRange(v as [dayjs.Dayjs, dayjs.Dayjs] | null)}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Customer"
            style={{ width: 220 }}
            options={customerOptions}
            value={customerId}
            onChange={setCustomerId}
          />
          <Button
            onClick={() => {
              setCustomerId(undefined)
              setBillNo('')
              setSearch('')
              setDateRange(null)
              setSortField(undefined)
              setSortOrder(undefined)
            }}
          >
            Reset
          </Button>
        </div>
      </Card>

      <Card bordered={false} className="shadow-sm">
        <Table
          rowKey="id"
          loading={loading}
          dataSource={data}
          onChange={handleTableChange}
          pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `${t} sales` }}
          columns={[
            {
              title: 'Date',
              dataIndex: 'saleDate',
              render: (v) => dayjs(v).format('DD MMM YYYY')
            },
            { title: 'Customer', render: (_, r) => r.customer?.name || '—' },
            {
              title: 'Updated by',
              render: (_, r) => formatAuditUser(r.updatedByUser || r.createdByUser)
            },
            { title: 'Units', dataIndex: 'lineCount', align: 'center' as const },
            {
              title: 'Net Total',
              dataIndex: 'netTotal',
              sorter: true,
              sortOrder: columnSortOrder('netTotal'),
              align: 'right' as const,
              render: formatRs
            },
            {
              title: 'Paid',
              dataIndex: 'paidAmount',
              sorter: true,
              sortOrder: columnSortOrder('paidAmount'),
              align: 'right' as const,
              render: formatRs
            },
            {
              title: 'Due',
              dataIndex: 'dueAmount',
              sorter: true,
              sortOrder: columnSortOrder('dueAmount'),
              align: 'right' as const,
              render: (v) => (
                Number(v) > 0 ? <Text type="danger">{formatRs(v)}</Text> : formatRs(0)
              )
            },
            {
              title: '',
              width: 88,
              render: (_, r) => (
                <Space size={0}>
                  {canEditSales ? (
                    <Button
                      type="text"
                      icon={<EditOutlined />}
                      onClick={() => navigate(App_Routes.SALE_EDIT.replace(':id', r.id))}
                    />
                  ) : (
                    <Tooltip title={!canMutate ? VIEW_ONLY_BRANCH_HINT : 'Only company owners can edit sales'}>
                      <Button type="text" icon={<EditOutlined />} disabled />
                    </Tooltip>
                  )}
                  <Button
                    type="text"
                    icon={<EyeOutlined />}
                    onClick={() => navigate(App_Routes.SALE_DETAIL.replace(':id', r.id))}
                  />
                </Space>
              )
            }
          ]}
        />
      </Card>
    </div>
  )
}

export default SalesList
