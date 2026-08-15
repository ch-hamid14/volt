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
  Tooltip,
  Typography,
  message
} from 'antd'
import dayjs from 'dayjs'
import { VIEW_ONLY_BRANCH_HINT } from '@/common'
import { saleAPI } from '@/renderer/services'
import { useSession } from '@/renderer/hooks/useSession'
import { formatRs, PageHeader } from '../shared/page-ui'

const { Text } = Typography

export const DueSales = () => {
  const { companyId, branchId, audit, canMutate } = useSession()
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [payModal, setPayModal] = useState<any>(null)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm()

  const load = () => {
    setLoading(true)
    saleAPI.due(companyId, branchId).then(setData).finally(() => setLoading(false))
  }

  useEffect(() => {
    if (companyId && branchId) load()
  }, [companyId, branchId])

  const openPayment = (sale: any) => {
    setPayModal(sale)
    form.setFieldsValue({
      amount: Number(sale.dueAmount),
      method: 'cash',
      paymentDate: dayjs()
    })
  }

  const handlePayment = async () => {
    if (!canMutate) {
      message.error(VIEW_ONLY_BRANCH_HINT)
      return
    }
    const values = await form.validateFields()
    if (Number(values.amount) > Number(payModal.dueAmount)) {
      message.error('Amount cannot exceed due balance')
      return
    }
    setSubmitting(true)
    try {
      await saleAPI.recordPayment(companyId, audit(), {
        saleId: payModal.id,
        amount: Number(values.amount),
        method: values.method,
        paymentDate: values.paymentDate.format('YYYY-MM-DD')
      })
      message.success('Payment recorded')
      setPayModal(null)
      form.resetFields()
      load()
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
        title="Due Sales"
        subtitle={`Outstanding receivables at this branch · Total ${formatRs(totalDue)}`}
      />

      <Card bordered={false} className="shadow-sm">
        <Table
          rowKey="id"
          loading={loading}
          dataSource={data}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          columns={[
            {
              title: 'Sale Date',
              dataIndex: 'saleDate',
              render: (v) => dayjs(v).format('DD MMM YYYY')
            },
            { title: 'Customer', render: (_, r) => r.customer?.name || '—' },
            { title: 'Net Total', dataIndex: 'netTotal', align: 'right' as const, render: formatRs },
            { title: 'Paid', dataIndex: 'paidAmount', align: 'right' as const, render: formatRs },
            {
              title: 'Due',
              dataIndex: 'dueAmount',
              align: 'right' as const,
              render: (v) => <Text type="danger" strong>{formatRs(v)}</Text>
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
        title={`Record Payment — ${payModal?.customer?.name || ''}`}
        open={Boolean(payModal)}
        onCancel={() => setPayModal(null)}
        onOk={handlePayment}
        confirmLoading={submitting}
        okText="Save Payment"
      >
        <Form form={form} layout="vertical" className="mt-4">
          <div className="mb-3 text-sm">
            Due: <Text strong type="danger">{formatRs(payModal?.dueAmount)}</Text>
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

export default DueSales
