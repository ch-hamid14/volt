import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Card, Col, Descriptions, Row, Spin, Statistic, Table, Tag, Typography, message } from 'antd'
import { ArrowLeftOutlined, EditOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { App_Routes, Roles, VIEW_ONLY_BRANCH_HINT } from '@/common'
import { purchaseAPI } from '@/renderer/services'
import { useSession } from '@/renderer/hooks/useSession'
import { formatSupplierDiscount } from '@/renderer/utils/supplierDiscount'
import { EditPaymentModal } from '@/renderer/components/forms/EditPaymentModal'
import { formatRs, PageHeader } from '../shared/page-ui'
import { STATUS_COLORS } from './inventory-ui'

const { Text } = Typography

export const PurchaseDetail = () => {
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
    purchaseAPI
      .get(id)
      .then(setDetail)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [id])

  const totalValue = useMemo(
    () => (detail?.items || []).reduce((sum: number, item: any) => sum + Number(item.purchasePrice ?? 0), 0),
    [detail?.items]
  )
  const listTotal = useMemo(
    () =>
      (detail?.items || []).reduce(
        (sum: number, item: any) => sum + Number(item.sellingPrice ?? item.purchasePrice ?? 0),
        0
      ),
    [detail?.items]
  )
  const discountTotal = useMemo(
    () => Math.max(0, listTotal - Number(detail?.purchase?.netTotal ?? totalValue)),
    [detail?.purchase?.netTotal, listTotal, totalValue]
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
        <Text type="secondary">Purchase not found.</Text>
      </div>
    )
  }

  const purchase = detail.purchase
  const editable = Boolean(detail.editable ?? purchase.editable)
  const canEdit = editable && canEditPurchases
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
        title="Purchase Detail"
        subtitle={dayjs(purchase.purchaseDate).format('DD MMM YYYY')}
        extra={
          canEdit ? (
            <Button
              type="primary"
              icon={<EditOutlined />}
              onClick={() => navigate(App_Routes.PURCHASE_EDIT.replace(':id', purchase.id))}
            >
              Edit
            </Button>
          ) : (
            <Text type="secondary">
              {!canMutate
                ? VIEW_ONLY_BRANCH_HINT
                : !canEditPurchases
                ? 'Only company owners can edit purchases'
                : 'Edit unavailable — no in-stock units remaining'}
            </Text>
          )
        }
      />

      <Card bordered={false} className="shadow-sm mb-4">
        <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="small">
          <Descriptions.Item label="Supplier">{purchase.supplier?.name || '—'}</Descriptions.Item>
          <Descriptions.Item label="Date">{dayjs(purchase.purchaseDate).format('DD MMM YYYY')}</Descriptions.Item>
          <Descriptions.Item label="Status">
            {Number(purchase.dueAmount) > 0 ? (
              <Tag color="red">Due {formatRs(purchase.dueAmount)}</Tag>
            ) : (
              <Tag color="green">Paid in full</Tag>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Supplier Discount">
            {formatSupplierDiscount(
              Number(purchase.supplier?.discount || 0),
              purchase.supplier?.discountType === 'percent' ? 'percent' : 'pkr'
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Notes" span={2}>{purchase.notes || '—'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Row gutter={[16, 16]} className="mb-4">
        <Col xs={12} sm={8} lg={4}>
          <Card bordered={false} className="shadow-sm">
            <Statistic title="Units" value={detail.items?.length ?? 0} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card bordered={false} className="shadow-sm">
            <Statistic title="List Total" value={listTotal} prefix="Rs" precision={0} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card bordered={false} className="shadow-sm">
            <Statistic title="Discount" value={discountTotal} prefix="Rs" precision={0} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card bordered={false} className="shadow-sm">
            <Statistic
              title="Net Total"
              value={Number(purchase.netTotal ?? totalValue)}
              prefix="Rs"
              precision={0}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card bordered={false} className="shadow-sm">
            <Statistic
              title="Paid"
              value={Number(purchase.paidAmount || 0)}
              prefix="Rs"
              precision={0}
              valueStyle={{ color: '#3f8600' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card bordered={false} className="shadow-sm">
            <Statistic
              title="Due"
              value={Number(purchase.dueAmount || 0)}
              prefix="Rs"
              precision={0}
              valueStyle={{ color: Number(purchase.dueAmount) > 0 ? '#cf1322' : undefined }}
            />
          </Card>
        </Col>
      </Row>

      <Card title="Received Units" bordered={false} className="shadow-sm mb-4">
        <Table
          rowKey="id"
          dataSource={detail.items || []}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          columns={[
            { title: 'Motor No.', dataIndex: 'motorNumber', render: (v) => v || '—' },
            { title: 'Chassis Number', dataIndex: 'serialNumber' },
            { title: 'Product', render: (_: unknown, r: any) => r.product?.name || '—' },
            { title: 'Category', render: (_: unknown, r: any) => r.category?.name || '—' },
            { title: 'Color', render: (_: unknown, r: any) => r.color?.name || '—' },
            {
              title: 'Special Disc.',
              key: 'specialDiscount',
              render: (_: unknown, r: any) =>
                formatSupplierDiscount(
                  Number(r.specialDiscount || 0),
                  r.specialDiscountType === 'percent' ? 'percent' : 'pkr'
                )
            },
            { title: 'Purchase Price', dataIndex: 'purchasePrice', align: 'right' as const, render: formatRs },
            { title: 'Selling Price', dataIndex: 'sellingPrice', align: 'right' as const, render: formatRs },
            {
              title: 'Status',
              dataIndex: 'status',
              render: (v) => <Tag color={STATUS_COLORS[v]}>{v?.replace(/_/g, ' ')}</Tag>
            },
            {
              title: 'Warranty',
              render: (_: unknown, r: any) =>
                r.warrantyActive
                  ? `${r.warrantyYears != null ? `${r.warrantyYears} yr · ` : ''}${
                      r.warrantyExpiryDate ? dayjs(r.warrantyExpiryDate).format('DD MMM YYYY') : '—'
                    }`
                  : 'No'
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
              await purchaseAPI.updatePayment(companyId, audit(), editPayment.id, values)
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

export default PurchaseDetail
