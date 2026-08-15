import { useEffect, useState } from 'react'
import {
  Button,
  Card,
  DatePicker,
  Form,
  InputNumber,
  Modal,
  Select,
  Table,
  Tag,
  Tooltip,
  Typography,
  message
} from 'antd'
import dayjs from 'dayjs'
import { VIEW_ONLY_BRANCH_HINT } from '@/common'
import { partPurchaseAPI, purchaseAPI } from '@/renderer/services'
import { useSession } from '@/renderer/hooks/useSession'
import { formatRs, PageHeader } from '../shared/page-ui'

const { Text } = Typography

type DueRow = {
  id: string
  kind: 'product' | 'part'
  purchaseDate: string
  netTotal: number
  paidAmount: number
  dueAmount: number
  supplier?: { name?: string } | null
}

export const DuePurchases = () => {
  const { companyId, branchId, audit, canMutate } = useSession()
  const [data, setData] = useState<DueRow[]>([])
  const [loading, setLoading] = useState(false)
  const [payModal, setPayModal] = useState<DueRow | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm()

  const load = async () => {
    if (!companyId || !branchId) return
    setLoading(true)
    try {
      const [productDue, partDue] = await Promise.all([
        purchaseAPI.due(companyId, branchId),
        partPurchaseAPI.due(companyId, branchId)
      ])
      const rows = [...(productDue as DueRow[]), ...(partDue as DueRow[])].sort(
        (a, b) => dayjs(b.purchaseDate).valueOf() - dayjs(a.purchaseDate).valueOf()
      )
      setData(rows)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [companyId, branchId])

  const openPayment = (row: DueRow) => {
    setPayModal(row)
    form.setFieldsValue({
      amount: Number(row.dueAmount),
      method: 'cash',
      paymentDate: dayjs()
    })
  }

  const handlePayment = async () => {
    if (!canMutate) {
      message.error(VIEW_ONLY_BRANCH_HINT)
      return
    }
    if (!payModal) return
    const values = await form.validateFields()
    if (Number(values.amount) > Number(payModal.dueAmount)) {
      message.error('Amount cannot exceed due balance')
      return
    }
    setSubmitting(true)
    try {
      const payload = {
        purchaseId: payModal.id,
        amount: Number(values.amount),
        method: values.method,
        paymentDate: values.paymentDate.format('YYYY-MM-DD')
      }
      if (payModal.kind === 'part') {
        await partPurchaseAPI.recordPayment(companyId, audit(), payload)
      } else {
        await purchaseAPI.recordPayment(companyId, audit(), payload)
      }
      message.success('Payment recorded')
      setPayModal(null)
      form.resetFields()
      await load()
    } catch (err: any) {
      message.error(err.message || 'Payment failed')
    } finally {
      setSubmitting(false)
    }
  }

  const totalDue = data.reduce((s, r) => s + Number(r.dueAmount || 0), 0)

  return (
    <div>
      <PageHeader
        title="Due Purchases"
        subtitle={`Outstanding payables at this branch · Total ${formatRs(totalDue)}`}
      />

      <Card bordered={false} className="shadow-sm">
        <Table
          rowKey={(r) => `${r.kind}-${r.id}`}
          loading={loading}
          dataSource={data}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          columns={[
            {
              title: 'Purchase Date',
              dataIndex: 'purchaseDate',
              render: (v) => dayjs(v).format('DD MMM YYYY')
            },
            {
              title: 'Type',
              dataIndex: 'kind',
              render: (v) => (
                <Tag color={v === 'part' ? 'purple' : 'blue'}>{v === 'part' ? 'Parts' : 'Product'}</Tag>
              )
            },
            { title: 'Supplier', render: (_, r) => r.supplier?.name || '—' },
            { title: 'Net Total', dataIndex: 'netTotal', align: 'right' as const, render: formatRs },
            { title: 'Paid', dataIndex: 'paidAmount', align: 'right' as const, render: formatRs },
            {
              title: 'Due',
              dataIndex: 'dueAmount',
              align: 'right' as const,
              render: (v) => (
                <Text type="danger" strong>
                  {formatRs(v)}
                </Text>
              )
            },
            {
              title: '',
              render: (_, r) => (
                <Tooltip title={!canMutate ? VIEW_ONLY_BRANCH_HINT : undefined}>
                  <span>
                    <Button type="primary" size="small" disabled={!canMutate} onClick={() => openPayment(r)}>
                      Record Payment
                    </Button>
                  </span>
                </Tooltip>
              )
            }
          ]}
        />
      </Card>

      <Modal
        title={`Record Payment — ${payModal?.supplier?.name || ''}`}
        open={Boolean(payModal)}
        onCancel={() => setPayModal(null)}
        onOk={handlePayment}
        confirmLoading={submitting}
        okText="Save Payment"
      >
        <Form form={form} layout="vertical" className="mt-4">
          <div className="mb-3 text-sm">
            Due:{' '}
            <Text strong type="danger">
              {formatRs(payModal?.dueAmount)}
            </Text>
          </div>
          <Form.Item name="amount" label="Amount" rules={[{ required: true }]}>
            <InputNumber className="w-full" min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="method" label="Method">
            <Select
              options={[
                { value: 'cash', label: 'Cash' },
                { value: 'bank', label: 'Bank' },
                { value: 'card', label: 'Card' }
              ]}
            />
          </Form.Item>
          <Form.Item name="paymentDate" label="Payment Date" rules={[{ required: true }]}>
            <DatePicker className="w-full" style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default DuePurchases
