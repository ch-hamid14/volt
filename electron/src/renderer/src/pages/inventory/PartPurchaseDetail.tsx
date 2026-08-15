import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Card, Col, Descriptions, Row, Spin, Statistic, Table, Tag, Typography, message } from 'antd'
import { ArrowLeftOutlined, EditOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { App_Routes, Roles, VIEW_ONLY_BRANCH_HINT } from '@/common'
import { partPurchaseAPI } from '@/renderer/services'
import { useSession } from '@/renderer/hooks/useSession'
import { EditPaymentModal } from '@/renderer/components/forms/EditPaymentModal'
import { formatRs, PageHeader } from '../shared/page-ui'

const { Text } = Typography

export const PartPurchaseDetail = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const { companyId, user, audit, canMutate } = useSession()
  const canEditPurchases = user?.role === Roles.COMPANY_OWNER && canMutate
  const canEditPayments = user?.role === Roles.COMPANY_OWNER && canMutate
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<any>(null)
  const [editPayment, setEditPayment] = useState<any>(null)

  const load = () => {
    if (!id) return
    setLoading(true)
    partPurchaseAPI
      .get(id)
      .then(setDetail)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [id])

  const totalUnits = useMemo(
    () => (detail?.lines || []).reduce((sum: number, line: any) => sum + Number(line.quantity || 0), 0),
    [detail?.lines]
  )
  const totalValue = useMemo(
    () =>
      (detail?.lines || []).reduce(
        (sum: number, line: any) => sum + Number(line.quantity || 0) * Number(line.unitCost || 0),
        0
      ),
    [detail?.lines]
  )

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Spin size="large" />
      </div>
    )
  }

  if (!detail?.purchase) {
    return (
      <div>
        <Button
          type="link"
          icon={<ArrowLeftOutlined />}
          className="!px-0 mb-4"
          onClick={() => navigate(App_Routes.PURCHASE_LIST)}
        >
          Back to Purchase List
        </Button>
        <Text type="secondary">Parts purchase not found.</Text>
      </div>
    )
  }

  const purchase = detail.purchase
  const payments = detail.payments || []
  const otherPaid = (excludeId: string) =>
    payments
      .filter((p: any) => p.id !== excludeId)
      .reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0)

  return (
    <div>
      <Button
        type="link"
        icon={<ArrowLeftOutlined />}
        className="!px-0 mb-2"
        onClick={() => navigate(App_Routes.PURCHASE_LIST)}
      >
        Back to Purchase List
      </Button>

      <PageHeader
        title="Parts Purchase Detail"
        subtitle={dayjs(purchase.purchaseDate).format('DD MMM YYYY')}
        extra={
          canEditPurchases ? (
            <Button
              type="primary"
              icon={<EditOutlined />}
              onClick={() => navigate(App_Routes.PART_PURCHASE_EDIT.replace(':id', purchase.id))}
            >
              Edit
            </Button>
          ) : (
            <Text type="secondary">
              {!canMutate ? VIEW_ONLY_BRANCH_HINT : 'Only company owners can edit purchases'}
            </Text>
          )
        }
      />

      <Card bordered={false} className="shadow-sm mb-4">
        <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="small">
          <Descriptions.Item label="Supplier">{purchase.supplier?.name || '—'}</Descriptions.Item>
          <Descriptions.Item label="Date">
            {dayjs(purchase.purchaseDate).format('DD MMM YYYY')}
          </Descriptions.Item>
          <Descriptions.Item label="Status">
            {Number(purchase.dueAmount) > 0 ? (
              <Tag color="red">Due {formatRs(purchase.dueAmount)}</Tag>
            ) : (
              <Tag color="green">Paid in full</Tag>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Notes" span={2}>
            {purchase.notes || '—'}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Row gutter={[16, 16]} className="mb-4">
        <Col xs={12} sm={8} lg={4}>
          <Card bordered={false} className="shadow-sm">
            <Statistic title="Lines" value={(detail.lines || []).length} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card bordered={false} className="shadow-sm">
            <Statistic title="Units" value={totalUnits} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card bordered={false} className="shadow-sm">
            <Statistic
              title="Net Total"
              value={Number(purchase.netTotal ?? totalValue)}
              formatter={(v) => formatRs(Number(v))}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card bordered={false} className="shadow-sm">
            <Statistic
              title="Paid"
              value={Number(purchase.paidAmount || 0)}
              formatter={(v) => formatRs(Number(v))}
              valueStyle={{ color: '#3f8600' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card bordered={false} className="shadow-sm">
            <Statistic
              title="Due"
              value={Number(purchase.dueAmount || 0)}
              formatter={(v) => formatRs(Number(v))}
              valueStyle={{ color: Number(purchase.dueAmount) > 0 ? '#cf1322' : undefined }}
            />
          </Card>
        </Col>
      </Row>

      <Card bordered={false} className="shadow-sm mb-4">
        <Table
          rowKey="id"
          dataSource={detail.lines || []}
          pagination={false}
          columns={[
            {
              title: 'Part',
              dataIndex: 'part',
              render: (p: any, row: any) => p?.name || row.partId
            },
            {
              title: 'Category',
              dataIndex: 'category',
              render: (c: any) => c?.name || '—'
            },
            { title: 'Units', dataIndex: 'quantity', align: 'right' as const },
            {
              title: 'Retail',
              dataIndex: 'unitSalePrice',
              align: 'right' as const,
              render: (v: number, r: any) => formatRs(Number(v ?? r.unitCost ?? 0))
            },
            {
              title: 'Net cost',
              dataIndex: 'unitCost',
              align: 'right' as const,
              render: formatRs
            },
            {
              title: 'Line total (cost)',
              align: 'right' as const,
              render: (_: unknown, r: any) =>
                formatRs(Number(r.quantity || 0) * Number(r.unitCost || 0))
            }
          ]}
        />
      </Card>

      {(payments.length > 0 || canEditPayments) && (
        <Card title="Payments" bordered={false} className="shadow-sm">
          <Table
            rowKey="id"
            dataSource={payments}
            pagination={false}
            locale={{ emptyText: 'No payments recorded' }}
            columns={[
              {
                title: 'Date',
                dataIndex: 'paymentDate',
                render: (v) => dayjs(v).format('DD MMM YYYY')
              },
              { title: 'Method', dataIndex: 'method' },
              { title: 'Amount', dataIndex: 'amount', align: 'right' as const, render: formatRs },
              ...(canEditPayments
                ? [
                    {
                      title: '',
                      width: 80,
                      render: (_: unknown, record: any) => (
                        <Button type="link" size="small" onClick={() => setEditPayment(record)}>
                          Edit
                        </Button>
                      )
                    }
                  ]
                : [])
            ]}
          />
        </Card>
      )}

      {editPayment && (
        <EditPaymentModal
          open={Boolean(editPayment)}
          maxAmount={Math.max(0, Number(purchase.netTotal || 0) - otherPaid(editPayment.id))}
          initial={{
            amount: Number(editPayment.amount || 0),
            method: editPayment.method,
            paymentDate: editPayment.paymentDate
          }}
          onCancel={() => setEditPayment(null)}
          onSave={async (values) => {
            try {
              await partPurchaseAPI.updatePayment(companyId, audit(), editPayment.id, values)
              message.success(values.amount > 0 ? 'Payment updated' : 'Payment removed')
              setEditPayment(null)
              load()
            } catch (err: any) {
              message.error(err.message || 'Update failed')
              throw err
            }
          }}
        />
      )}
    </div>
  )
}

export default PartPurchaseDetail
