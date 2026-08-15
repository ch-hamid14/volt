import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Card,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Statistic,
  Table,
  Tooltip,
  Typography,
  message
} from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { VIEW_ONLY_BRANCH_HINT } from '@/common'
import { expenseAPI } from '@/renderer/services'
import { useSession } from '@/renderer/hooks/useSession'
import { formatRs, formatAuditUser, PageHeader } from '../shared/page-ui'

const { Text } = Typography
const { RangePicker } = DatePicker

export const Expenses = () => {
  const { companyId, branchId, audit, canMutate } = useSession()
  const [data, setData] = useState<any[]>([])
  const [categories, setCategories] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null)
  const [expenseOpen, setExpenseOpen] = useState(false)
  const [expenseForm] = Form.useForm()

  const loadCategories = () => expenseAPI.categories(companyId).then(setCategories)

  const load = () => {
    setLoading(true)
    expenseAPI
      .list(
        companyId,
        branchId,
        audit(),
        dateRange?.[0]?.format('YYYY-MM-DD'),
        dateRange?.[1]?.format('YYYY-MM-DD')
      )
      .then(setData)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (companyId && branchId) {
      loadCategories()
      load()
    }
  }, [companyId, branchId, dateRange])

  const summary = useMemo(() => {
    const total = data.reduce((sum, row) => sum + Number(row.amount ?? 0), 0)
    return { count: data.length, total }
  }, [data])

  const categoryOptions = categories.map((c) => ({ value: c.id, label: c.name }))

  const openExpense = () => {
    expenseForm.resetFields()
    expenseForm.setFieldsValue({ date: dayjs() })
    setExpenseOpen(true)
  }

  const handleExpenseSubmit = async (values: any) => {
    if (!canMutate) {
      message.error(VIEW_ONLY_BRANCH_HINT)
      return
    }
    setLoading(true)
    try {
      await expenseAPI.create(companyId, branchId, audit(), {
        categoryId: values.categoryId,
        amount: Number(values.amount),
        date: values.date.format('YYYY-MM-DD'),
        description: values.description
      })
      message.success('Expense recorded')
      setExpenseOpen(false)
      expenseForm.resetFields()
      load()
    } catch (err: any) {
      message.error(err.message || 'Failed to save expense')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteExpense = async (id: string) => {
    try {
      await expenseAPI.remove(id, companyId, audit())
      message.success('Expense deleted')
      load()
    } catch (err: any) {
      message.error(err.message || 'Delete failed')
    }
  }

  return (
    <div>
      <PageHeader
        title="Expense Management"
        subtitle="Record and review branch expenses."
        extra={
          <Tooltip title={!canMutate ? VIEW_ONLY_BRANCH_HINT : undefined}>
            <span>
              <Button type="primary" icon={<PlusOutlined />} disabled={!canMutate} onClick={openExpense}>
                Add Expense
              </Button>
            </span>
          </Tooltip>
        }
      />

      <Row gutter={[16, 16]} className="mb-4">
        <Col xs={24} sm={12}>
          <Card bordered={false} className="shadow-sm">
            <Statistic title="Expenses in Range" value={summary.count} />
          </Card>
        </Col>
        <Col xs={24} sm={12}>
          <Card bordered={false} className="shadow-sm">
            <Statistic
              title="Total Spent"
              value={summary.total}
              prefix="Rs"
              precision={0}
              valueStyle={{ color: '#cf1322' }}
            />
          </Card>
        </Col>
      </Row>

      <Card bordered={false} className="shadow-sm">
        <div className="mb-4 flex flex-wrap gap-3">
          <RangePicker
            value={dateRange}
            onChange={(v) => setDateRange(v as [dayjs.Dayjs, dayjs.Dayjs] | null)}
          />
          <Button onClick={() => setDateRange(null)}>Clear dates</Button>
        </div>

        <Table
          rowKey="id"
          loading={loading}
          dataSource={data}
          pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `${t} expenses` }}
          columns={[
            {
              title: 'Date',
              dataIndex: 'date',
              render: (v) => dayjs(v).format('DD MMM YYYY')
            },
            { title: 'Category', render: (_, r) => r.category?.name || '—' },
            { title: 'Description', dataIndex: 'description', render: (v) => v || '—' },
            {
              title: 'Updated by',
              render: (_, r) => formatAuditUser(r.updatedByUser || r.createdByUser)
            },
            {
              title: 'Amount',
              dataIndex: 'amount',
              align: 'right' as const,
              render: (v) => <Text type="danger" strong>{formatRs(v)}</Text>
            },
            {
              title: '',
              width: 80,
              render: (_, r) => (
                <Popconfirm
                  title="Delete this expense?"
                  onConfirm={() => handleDeleteExpense(r.id)}
                  disabled={!canMutate}
                >
                  <Button type="link" size="small" danger disabled={!canMutate}>Delete</Button>
                </Popconfirm>
              )
            }
          ]}
        />
      </Card>

      <Modal
        title="Add Expense"
        open={expenseOpen}
        onCancel={() => setExpenseOpen(false)}
        footer={null}
        destroyOnClose
      >
        <Form form={expenseForm} layout="vertical" onFinish={handleExpenseSubmit} className="mt-4">
          <Form.Item name="date" label="Date" rules={[{ required: true }]}>
            <DatePicker className="w-full" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="categoryId" label="Category">
            <Select allowClear placeholder="Select category" options={categoryOptions} />
          </Form.Item>
          <Form.Item name="amount" label="Amount" rules={[{ required: true }]}>
            <InputNumber className="w-full" min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={3} placeholder="Optional notes" styles={{ textarea: { resize: 'none' } }} />
          </Form.Item>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setExpenseOpen(false)}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={loading}>Save</Button>
          </div>
        </Form>
      </Modal>
    </div>
  )
}

export default Expenses
