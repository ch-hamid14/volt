import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Card, Col, Descriptions, Row, Spin, Statistic, Table, Tag, Typography, message } from 'antd'
import { ArrowLeftOutlined, EditOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { App_Routes, Roles, VIEW_ONLY_BRANCH_HINT } from '@/common'
import { saleAPI } from '@/renderer/services'
import { useSession } from '@/renderer/hooks/useSession'
import { useSaleInvoicePrint } from '@/renderer/hooks/useSaleInvoicePrint'
import { PrintInvoiceButton } from '@/renderer/components/print/PrintInvoiceButton'
import { SaleInvoicePrint } from '@/renderer/components/print/SaleInvoicePrint'
import { ThermalReceiptPrint } from '@/renderer/components/print/ThermalReceiptPrint'
import { EditPaymentModal } from '@/renderer/components/forms/EditPaymentModal'
import { formatRs, PageHeader } from '../shared/page-ui'

const { Text } = Typography

export const SaleDetail = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const { companyId, branchName, user, audit, canMutate } = useSession()
  const canEditSales = user?.role === Roles.COMPANY_OWNER && canMutate
  const canEditPayments = user?.role === Roles.COMPANY_OWNER && canMutate
  const [editable, setEditable] = useState(false)
  const [editPayment, setEditPayment] = useState<any>(null)
  const {
    preparePrint,
    clearPrint,
    handlePrintInvoice,
    handleThermalPrint,
    printDetail,
    hasPrintDetail
  } = useSaleInvoicePrint(branchName || 'Company')

  const load = useCallback(() => {
    if (!id) return
    saleAPI.get(id).then((res) => {
      if (res?.sale) {
        preparePrint(res)
        setEditable(Boolean(res.editable ?? res.sale.editable))
      }
    })
  }, [id, preparePrint])

  useEffect(() => {
    load()
    return () => clearPrint()
  }, [load, clearPrint])

  const detail = printDetail
  const loading = Boolean(id && !detail?.sale)

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Spin size="large" />
      </div>
    )
  }

  if (!detail?.sale) {
    return (
      <div>
        <Button
          type="link"
          icon={<ArrowLeftOutlined />}
          className="!px-0 mb-4"
          onClick={() => navigate(App_Routes.SALES_LIST)}
        >
          Back to Sales List
        </Button>
        <Text type="secondary">Sale not found.</Text>
      </div>
    )
  }

  const sale = detail.sale
  const canEdit = editable && canEditSales
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
        onClick={() => navigate(App_Routes.SALES_LIST)}
      >
        Back to Sales List
      </Button>

      <PageHeader
        title={`Sale #${sale.billNo ?? '—'}`}
        subtitle={dayjs(sale.saleDate).format('DD MMM YYYY')}
        extra={
          <div className="flex items-center gap-3">
            {canEdit ? (
              <Button
                type="primary"
                icon={<EditOutlined />}
                onClick={() => navigate(App_Routes.SALE_EDIT.replace(':id', sale.id))}
              >
                Edit
              </Button>
            ) : (
              canEditSales || editable ? (
                <Text type="secondary">
                  {!canMutate
                    ? VIEW_ONLY_BRANCH_HINT
                    : !canEditSales
                    ? 'Only company owners can edit sales'
                    : 'Edit unavailable — one or more sold units are no longer editable'}
                </Text>
              ) : null
            )}
            <PrintInvoiceButton
              onThermal={handleThermalPrint}
              onA4Print={handlePrintInvoice}
              disabled={!hasPrintDetail}
            />
          </div>
        }
      />

      <Card bordered={false} className="shadow-sm mb-4">
        <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="small">
          <Descriptions.Item label="Customer">{sale.customer?.name || '—'}</Descriptions.Item>
          <Descriptions.Item label="Date">{dayjs(sale.saleDate).format('DD MMM YYYY')}</Descriptions.Item>
          <Descriptions.Item label="Status">
            {Number(sale.dueAmount) > 0 ? (
              <Tag color="red">Due {formatRs(sale.dueAmount)}</Tag>
            ) : (
              <Tag color="green">Paid in full</Tag>
            )}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Row gutter={[16, 16]} className="mb-4">
        <Col xs={12} sm={8} lg={4}>
          <Card bordered={false} className="shadow-sm">
            <Statistic title="Subtotal" value={sale.subtotal ?? 0} prefix="Rs" precision={0} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card bordered={false} className="shadow-sm">
            <Statistic title="Tax" value={sale.totalTax ?? 0} prefix="Rs" precision={0} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card bordered={false} className="shadow-sm">
            <Statistic title="Tax u/s 236 G/H" value={sale.totalWht ?? 0} prefix="Rs" precision={0} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card bordered={false} className="shadow-sm">
            <Statistic title="Discount" value={sale.discount ?? 0} prefix="Rs" precision={0} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card bordered={false} className="shadow-sm">
            <Statistic title="Net Total" value={sale.netTotal ?? 0} prefix="Rs" precision={0} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card bordered={false} className="shadow-sm">
            <Statistic
              title="Paid"
              value={sale.paidAmount ?? 0}
              prefix="Rs"
              precision={0}
              valueStyle={{ color: '#3f8600' }}
            />
          </Card>
        </Col>
      </Row>

      <Card title="Line Items" bordered={false} className="shadow-sm mb-4">
        <Table
          rowKey="id"
          dataSource={detail.lines || []}
          pagination={false}
          columns={[
            {
              title: 'Type',
              dataIndex: 'lineType',
              width: 90,
              render: (v: string) => (v === 'part' ? <Tag color="blue">Part</Tag> : <Tag>Product</Tag>)
            },
            {
              title: 'Chassis',
              dataIndex: 'serialNumber',
              render: (v: string) => v || '—'
            },
            { title: 'Motor', dataIndex: 'motorNumber', render: (v) => v || '—' },
            { title: 'Name', dataIndex: 'productName' },
            { title: 'Category', dataIndex: 'categoryName', render: (v) => v || '—' },
            {
              title: 'Qty',
              dataIndex: 'quantity',
              align: 'right' as const,
              render: (v) => Number(v || 1)
            },
            { title: 'Color', dataIndex: 'colorName', render: (v) => v || '—' },
            { title: 'Unit price', dataIndex: 'salePrice', align: 'right' as const, render: formatRs },
            { title: 'Sale Tax', dataIndex: 'taxAmount', align: 'right' as const, render: formatRs },
            { title: 'Tax u/s 236 G/H', dataIndex: 'whtAmount', align: 'right' as const, render: formatRs },
            {
              title: 'Other taxes',
              render: (_: unknown, r: any) => {
                const taxes = r.customTaxes || []
                if (!taxes.length) return '—'
                return taxes
                  .map(
                    (t: any) =>
                      `${t.name}${t.percent != null ? ` ${t.percent}%` : ''}: ${formatRs(t.amount)}`
                  )
                  .join(' · ')
              }
            },
            { title: 'Total', dataIndex: 'lineTotal', align: 'right' as const, render: formatRs }
          ]}
        />
      </Card>

      <Card title="Notes" bordered={false} className="shadow-sm mb-4">
        <Text type={sale.notes ? undefined : 'secondary'}>{sale.notes || '—'}</Text>
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
          maxAmount={Math.max(0, Number(sale.netTotal || 0) - otherPaid(editPayment.id))}
          initial={{
            amount: Number(editPayment.amount || 0),
            method: editPayment.method,
            paymentDate: editPayment.paymentDate
          }}
          onCancel={() => setEditPayment(null)}
          onSave={async (values) => {
            try {
              await saleAPI.updatePayment(companyId, audit(), editPayment.id, values)
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

      {printDetail?.sale && (
        <>
          <SaleInvoicePrint detail={printDetail} companyName={branchName || 'Company'} />
          <ThermalReceiptPrint detail={printDetail} companyName={branchName || 'Company'} />
        </>
      )}
    </div>
  )
}

export default SaleDetail
