import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button,
  Card,
  Col,
  Input,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tooltip,
  Typography,
  message
} from 'antd'
import type { TableProps } from 'antd'
import { FileTextOutlined, PlusOutlined } from '@ant-design/icons'
import { App_Routes, VIEW_ONLY_BRANCH_HINT } from '@/common'
import { customerAPI } from '@/renderer/services'
import { useSession } from '@/renderer/hooks/useSession'
import { CustomerFormModal } from '@/renderer/components/forms/CustomerFormModal'
import { formatRs, PageHeader } from '../shared/page-ui'

const { Text } = Typography

export const Customers = () => {
  const navigate = useNavigate()
  const { companyId, audit, canMutate } = useSession()
  const [data, setData] = useState<any[]>([])
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<any | null>(null)
  const [search, setSearch] = useState('')
  const [dueFilter, setDueFilter] = useState<'due' | 'not_due'>()
  const [balanceSort, setBalanceSort] = useState<'asc' | 'desc'>()

  const load = () =>
    customerAPI
      .list(
        companyId,
        search || undefined,
        balanceSort ? 'balance' : undefined,
        balanceSort,
        dueFilter
      )
      .then(setData)

  useEffect(() => {
    if (companyId) load()
  }, [companyId, search, dueFilter, balanceSort])

  const handleTableChange: TableProps<any>['onChange'] = (_pagination, _filters, sorter) => {
    const active = Array.isArray(sorter) ? sorter[0] : sorter
    if (active?.field === 'balance' && active.order) {
      setBalanceSort(active.order === 'ascend' ? 'asc' : 'desc')
    } else {
      setBalanceSort(undefined)
    }
  }

  const summary = useMemo(() => {
    const withDue = data.filter((c) => Number(c.balance ?? 0) > 0).length
    const totalDue = data.reduce((sum, c) => sum + Number(c.balance ?? 0), 0)
    return { total: data.length, withDue, totalDue }
  }, [data])

  const openCreate = () => {
    setEditing(null)
    setOpen(true)
  }

  const openEdit = (record: any) => {
    setEditing(record)
    setOpen(true)
  }

  const handleDelete = async (id: string) => {
    try {
      await customerAPI.remove(id, companyId, audit())
      message.success('Customer deleted')
      load()
    } catch (err: any) {
      message.error(err.message || 'Delete failed')
    }
  }

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="Customer records with opening balance for amounts already owed to you."
        extra={
          <Tooltip title={!canMutate ? VIEW_ONLY_BRANCH_HINT : undefined}>
            <span>
              <Button type="primary" icon={<PlusOutlined />} disabled={!canMutate} onClick={openCreate}>
                Add Customer
              </Button>
            </span>
          </Tooltip>
        }
      />

      <Row gutter={[16, 16]} className="mb-4">
        <Col xs={24} sm={8}>
          <Card bordered={false} className="shadow-sm">
            <Statistic title="Total Customers" value={summary.total} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card bordered={false} className="shadow-sm">
            <Statistic
              title="With Outstanding"
              value={summary.withDue}
              valueStyle={{ color: summary.withDue ? '#fa8c16' : undefined }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card bordered={false} className="shadow-sm">
            <Statistic
              title="Total Outstanding"
              value={summary.totalDue}
              prefix="Rs"
              precision={0}
              valueStyle={{ color: '#cf1322' }}
            />
          </Card>
        </Col>
      </Row>

      <Card bordered={false} className="shadow-sm">
        <div className="mb-4 flex flex-wrap gap-3">
          <Input.Search
            placeholder="Search name, phone or CNIC…"
            allowClear
            onSearch={setSearch}
            style={{ width: 280 }}
          />
          <Select
            allowClear
            placeholder="Outstanding"
            style={{ width: 160 }}
            options={[
              { value: 'due', label: 'Has due' },
              { value: 'not_due', label: 'No due' }
            ]}
            value={dueFilter}
            onChange={setDueFilter}
          />
        </div>

        <Table
          rowKey="id"
          dataSource={data}
          onChange={handleTableChange}
          pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `${t} customers` }}
          columns={[
            {
              title: 'Name',
              dataIndex: 'name',
              render: (v) => <Text strong>{v}</Text>
            },
            {
              title: 'Phone',
              dataIndex: 'phone',
              render: (v) => v || '—'
            },
            {
              title: 'CNIC',
              dataIndex: 'cnic',
              render: (v) => v || '—'
            },
            {
              title: 'Outstanding',
              dataIndex: 'balance',
              sorter: true,
              sortOrder:
                balanceSort === 'asc' ? 'ascend' : balanceSort === 'desc' ? 'descend' : null,
              align: 'right' as const,
              render: (v) => {
                const bal = Number(v ?? 0)
                return bal > 0 ? <Text type="danger" strong>{formatRs(v)}</Text> : formatRs(v)
              }
            },
            {
              title: 'Actions',
              width: 220,
              render: (_, record) => (
                <Space>
                  <Button
                    type="link"
                    size="small"
                    icon={<FileTextOutlined />}
                    onClick={() =>
                      navigate(App_Routes.CUSTOMER_REPORT_DETAIL.replace(':id', record.id))
                    }
                  >
                    Report
                  </Button>
                  <Button type="link" size="small" disabled={!canMutate} onClick={() => openEdit(record)}>
                    Edit
                  </Button>
                  <Popconfirm
                    title="Delete this customer?"
                    onConfirm={() => handleDelete(record.id)}
                    disabled={!canMutate}
                  >
                    <Button type="link" size="small" danger disabled={!canMutate}>
                      Delete
                    </Button>
                  </Popconfirm>
                </Space>
              )
            }
          ]}
        />
      </Card>

      <CustomerFormModal
        open={open}
        editing={editing}
        onCancel={() => {
          setOpen(false)
          setEditing(null)
        }}
        onSaved={() => {
          setOpen(false)
          setEditing(null)
          load()
        }}
      />
    </div>
  )
}

export default Customers
