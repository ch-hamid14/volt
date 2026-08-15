import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  Table,
  Typography,
  message
} from 'antd'
import { ArrowLeftOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useNavigate, useParams } from 'react-router-dom'
import { App_Routes, VIEW_ONLY_BRANCH_HINT } from '@/common'
import { partAPI, partPurchaseAPI, supplierAPI } from '@/renderer/services'
import { useSession } from '@/renderer/hooks/useSession'
import {
  applySupplierDiscount,
  formatSupplierDiscount,
  round2,
  SUPPLIER_DISCOUNT_TYPE_OPTIONS,
  type SupplierDiscountType
} from '@/renderer/utils/supplierDiscount'
import { formatRs, PageHeader } from '../shared/page-ui'
import { SupplierQuickModal } from '@/renderer/components/quick/SupplierQuickModal'
import { SelectQuickFooter } from '@/renderer/components/quick/SelectQuickFooter'

const { Text } = Typography

const RETAIL_BELOW_NET_MSG = 'Retail price cannot be less than net cost'

function retailBelowNet(retail: number, netCost: number): boolean {
  return netCost > retail
}

type PartPurchaseLine = {
  key: string
  id?: string
  partId: string
  partName: string
  categoryName: string
  quantity: number
  /** Retail (list) unit price entered by user. */
  listPrice: number
  /** Net unit cost after supplier + special discounts. */
  unitCost: number
  specialDiscount: number
  specialDiscountType: SupplierDiscountType
}

function computeNetPrice(
  listPrice: number,
  supplierDiscount: number,
  supplierDiscountType: SupplierDiscountType,
  specialDiscount: number,
  specialDiscountType: SupplierDiscountType
): number {
  const afterSupplier = applySupplierDiscount(listPrice, supplierDiscount, supplierDiscountType)
  return applySupplierDiscount(afterSupplier, specialDiscount, specialDiscountType)
}

export const AddPartPurchase = () => {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const { companyId, branchId, audit, canMutate } = useSession()
  const [suppliers, setSuppliers] = useState<any[]>([])
  const [supplierQuickOpen, setSupplierQuickOpen] = useState(false)
  const [supplierQuickEditing, setSupplierQuickEditing] = useState<any | null>(null)
  const [parts, setParts] = useState<any[]>([])
  const [lines, setLines] = useState<PartPurchaseLine[]>([])
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(isEdit)
  const [headerForm] = Form.useForm()
  const [lineForm] = Form.useForm()

  const lineSpecialDiscount = Number(Form.useWatch('specialDiscount', lineForm) || 0)
  const lineSpecialDiscountType: SupplierDiscountType =
    Form.useWatch('specialDiscountType', lineForm) === 'percent' ? 'percent' : 'pkr'

  // Create flow lives on unified Add Purchase; this page is edit-only.
  useEffect(() => {
    if (!isEdit) navigate(App_Routes.ADD_PURCHASE, { replace: true })
  }, [isEdit, navigate])

  const loadSuppliers = () => {
    if (!companyId) return Promise.resolve()
    return supplierAPI.list(companyId).then(setSuppliers)
  }

  useEffect(() => {
    if (!companyId || !isEdit) return
    loadSuppliers()
    partAPI.list(companyId).then(setParts)
  }, [companyId, isEdit])

  useEffect(() => {
    if (!isEdit || !id) return
    setLoadingDetail(true)
    partPurchaseAPI
      .get(id)
      .then((detail: any) => {
        if (!detail?.purchase) {
          message.error('Parts purchase not found')
          navigate(App_Routes.PURCHASE_LIST)
          return
        }

        const purchase = detail.purchase
        headerForm.setFieldsValue({
          supplierId: purchase.supplierId,
          purchaseDate: dayjs(purchase.purchaseDate),
          notes: purchase.notes || ''
        })

        setLines(
          (detail.lines || []).map((line: any) => ({
            key: line.id,
            id: line.id,
            partId: line.partId,
            partName: line.part?.name || '—',
            categoryName: line.category?.name || '—',
            quantity: Number(line.quantity || 0),
            listPrice: Number(line.unitSalePrice ?? line.unitCost ?? 0),
            unitCost: Number(line.unitCost || 0),
            specialDiscount: Number(line.specialDiscount || 0),
            specialDiscountType: line.specialDiscountType === 'percent' ? 'percent' : 'pkr'
          }))
        )
      })
      .catch((err: any) => {
        message.error(err.message || 'Failed to load parts purchase')
        navigate(App_Routes.PURCHASE_LIST)
      })
      .finally(() => setLoadingDetail(false))
  }, [id, isEdit, navigate, headerForm])

  const partMap = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts])
  const supplierMap = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers])
  const partOptions = parts.map((p) => ({
    value: p.id,
    label: `${p.name}${p.category?.name ? ` · ${p.category.name}` : ''}`
  }))
  const supplierOptions = suppliers.map((s) => ({ value: s.id, label: s.name }))

  const selectedSupplierId = Form.useWatch('supplierId', headerForm)
  const selectedSupplier = selectedSupplierId ? supplierMap.get(selectedSupplierId) : undefined
  const supplierDiscount = Number(selectedSupplier?.discount || 0)
  const supplierDiscountType: SupplierDiscountType =
    selectedSupplier?.discountType === 'percent' ? 'percent' : 'pkr'
  const hasSupplierDiscount = supplierDiscount > 0
  const hasSpecialDiscount = lines.some((l) => l.specialDiscount > 0)
  const hasDiscount = hasSupplierDiscount || hasSpecialDiscount
  const showNetPreview = hasSupplierDiscount || lineSpecialDiscount > 0

  const enteredListPrice = Number(Form.useWatch('purchasePrice', lineForm) || 0)
  const previewNetPrice = computeNetPrice(
    enteredListPrice,
    supplierDiscount,
    supplierDiscountType,
    lineSpecialDiscount,
    lineSpecialDiscountType
  )

  const selectedPartId = Form.useWatch('partId', lineForm)
  const categoryPreview = selectedPartId ? partMap.get(selectedPartId)?.category?.name || '—' : '—'

  const recalcLines = (supplier?: { discount?: number; discountType?: string }) => {
    const sDiscount = Number(supplier?.discount || 0)
    const sType: SupplierDiscountType = supplier?.discountType === 'percent' ? 'percent' : 'pkr'
    setLines((prev) =>
      prev.map((line) => ({
        ...line,
        unitCost: computeNetPrice(
          line.listPrice,
          sDiscount,
          sType,
          line.specialDiscount,
          line.specialDiscountType
        )
      }))
    )
  }

  const openAddSupplier = () => {
    setSupplierQuickEditing(null)
    setSupplierQuickOpen(true)
  }

  const openEditSupplier = () => {
    if (!selectedSupplier) return
    setSupplierQuickEditing(selectedSupplier)
    setSupplierQuickOpen(true)
  }

  const handleSupplierQuickSaved = async (supplier: { id: string }) => {
    setSupplierQuickOpen(false)
    setSupplierQuickEditing(null)
    const list = (await supplierAPI.list(companyId)) as any[]
    setSuppliers(list)
    headerForm.setFieldValue('supplierId', supplier.id)
    const updated = list.find((s) => s.id === supplier.id)
    if (updated) recalcLines(updated)
  }

  const resetLineForm = () => {
    lineForm.resetFields()
    lineForm.setFieldsValue({
      quantity: 1,
      purchasePrice: 0,
      specialDiscount: 0,
      specialDiscountType: 'pkr'
    })
    setEditingKey(null)
  }

  const addLine = async () => {
    try {
      const values = await lineForm.validateFields()
      const part = partMap.get(values.partId)
      if (!part) {
        message.error('Select a valid part')
        return
      }
      const quantity = Math.floor(Number(values.quantity))
      if (!Number.isFinite(quantity) || quantity <= 0) {
        message.error('Quantity must be a positive whole number')
        return
      }

      const listPrice = Number(values.purchasePrice || 0)
      const specialDiscount = Number(values.specialDiscount || 0)
      const specialDiscountType: SupplierDiscountType =
        values.specialDiscountType === 'percent' ? 'percent' : 'pkr'

      const nextLine: PartPurchaseLine = {
        key: editingKey || `${values.partId}-${Date.now()}`,
        id: editingKey ? lines.find((l) => l.key === editingKey)?.id : undefined,
        partId: values.partId,
        partName: part.name,
        categoryName: part.category?.name || '—',
        quantity,
        listPrice,
        specialDiscount,
        specialDiscountType,
        unitCost: computeNetPrice(
          listPrice,
          supplierDiscount,
          supplierDiscountType,
          specialDiscount,
          specialDiscountType
        )
      }

      if (retailBelowNet(nextLine.listPrice, nextLine.unitCost)) {
        message.error(RETAIL_BELOW_NET_MSG)
        return
      }

      setLines((prev) =>
        editingKey ? prev.map((l) => (l.key === editingKey ? nextLine : l)) : [...prev, nextLine]
      )
      resetLineForm()
    } catch {
      /* validation errors shown by form */
    }
  }

  const startEditLine = (line: PartPurchaseLine) => {
    setEditingKey(line.key)
    lineForm.setFieldsValue({
      partId: line.partId,
      quantity: line.quantity,
      purchasePrice: line.listPrice,
      specialDiscount: line.specialDiscount,
      specialDiscountType: line.specialDiscountType
    })
  }

  const removeLine = (key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key))
    if (editingKey === key) resetLineForm()
  }

  const totalUnits = lines.reduce((sum, l) => sum + l.quantity, 0)
  const grossTotal = round2(lines.reduce((sum, l) => sum + l.quantity * l.listPrice, 0))
  const netTotal = round2(lines.reduce((sum, l) => sum + l.quantity * l.unitCost, 0))

  const handleSubmit = async () => {
    if (!canMutate) {
      message.error(VIEW_ONLY_BRANCH_HINT)
      return
    }
    try {
      const header = await headerForm.validateFields()
      if (!lines.length) {
        message.error('Add at least one part line')
        return
      }
      const invalidLine = lines.find((l) => retailBelowNet(l.listPrice, l.unitCost))
      if (invalidLine) {
        message.error(`${invalidLine.partName}: ${RETAIL_BELOW_NET_MSG}`)
        return
      }
      setLoading(true)
      const payload = {
        supplierId: header.supplierId,
        purchaseDate: header.purchaseDate.format('YYYY-MM-DD'),
        notes: header.notes || '',
        lines: lines.map((l) => ({
          id: l.id,
          partId: l.partId,
          quantity: l.quantity,
          unitCost: l.unitCost,
          unitSalePrice: l.listPrice,
          specialDiscount: l.specialDiscount,
          specialDiscountType: l.specialDiscountType
        }))
      }

      if (isEdit && id) {
        await partPurchaseAPI.update(id, companyId, branchId, audit(), payload)
        message.success('Parts purchase updated')
        navigate(App_Routes.PART_PURCHASE_DETAIL.replace(':id', id))
      } else {
        const result: any = await partPurchaseAPI.create(companyId, branchId, audit(), payload)
        message.success('Parts purchase created')
        const newId = result?.purchase?.id
        navigate(
          newId
            ? App_Routes.PART_PURCHASE_DETAIL.replace(':id', newId)
            : App_Routes.PURCHASE_LIST
        )
      }
    } catch (err: any) {
      if (err?.errorFields) return
      message.error(err.message || 'Save failed')
    } finally {
      setLoading(false)
    }
  }

  if (loadingDetail) {
    return (
      <div className="flex justify-center py-24">
        <Spin size="large" />
      </div>
    )
  }

  if (!isEdit) return null

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
        title="Edit Parts Purchase"
        subtitle="Update spare part quantities and unit costs for this purchase."
      />

      <Card bordered={false} className="shadow-sm mb-4">
        <Form form={headerForm} layout="vertical">
          <div className="grid gap-4 md:grid-cols-3">
            <Form.Item
              name="supplierId"
              label="Supplier"
              rules={[{ required: true, message: 'Select a supplier' }]}
            >
              <Select
                options={supplierOptions}
                placeholder="Select supplier"
                showSearch
                optionFilterProp="label"
                onChange={(supplierId) => recalcLines(supplierMap.get(supplierId))}
                onOpenChange={(open) => {
                  if (open) loadSuppliers()
                }}
                dropdownRender={(menu) => (
                  <SelectQuickFooter
                    menu={menu}
                    addLabel="Add supplier"
                    onAdd={openAddSupplier}
                    editLabel="Edit supplier"
                    canEdit={Boolean(selectedSupplierId)}
                    onEdit={openEditSupplier}
                  />
                )}
              />
            </Form.Item>
            <Form.Item
              name="purchaseDate"
              label="Purchase date"
              rules={[{ required: true, message: 'Pick a date' }]}
            >
              <DatePicker className="w-full" format="DD MMM YYYY" />
            </Form.Item>
            <Form.Item name="notes" label="Notes">
              <Input placeholder="Optional notes" />
            </Form.Item>
          </div>
          {hasSupplierDiscount && (
            <Text type="secondary">
              Supplier discount: {formatSupplierDiscount(supplierDiscount, supplierDiscountType)}
            </Text>
          )}
        </Form>
      </Card>

      <Card bordered={false} className="shadow-sm mb-4" title="Add line">
        <Form form={lineForm} layout="vertical">
          <div className="grid gap-4 md:grid-cols-4">
            <Form.Item
              name="partId"
              label="Part"
              rules={[{ required: true, message: 'Select a part' }]}
              className="md:col-span-2"
            >
              <Select options={partOptions} placeholder="Select part" showSearch optionFilterProp="label" />
            </Form.Item>
            <Form.Item label="Category">
              <Input value={categoryPreview} disabled />
            </Form.Item>
            <Form.Item name="quantity" label="Units" rules={[{ required: true, message: 'Enter units' }]}>
              <InputNumber min={1} step={1} precision={0} className="w-full" />
            </Form.Item>
            <Form.Item name="purchasePrice" label="Retail price" rules={[{ required: true }]}>
              <InputNumber min={0} className="w-full" />
            </Form.Item>
            <Form.Item name="specialDiscountType" label="Special Discount Type">
              <Select options={[...SUPPLIER_DISCOUNT_TYPE_OPTIONS]} />
            </Form.Item>
            <Form.Item
              name="specialDiscount"
              label={lineSpecialDiscountType === 'percent' ? 'Special Discount %' : 'Special Discount (PKR)'}
              rules={[
                { type: 'number', min: 0, message: 'Discount cannot be negative' },
                ...(lineSpecialDiscountType === 'percent'
                  ? [{ type: 'number' as const, max: 100, message: 'Discount must be between 0 and 100' }]
                  : [])
              ]}
            >
              <InputNumber
                className="w-full"
                min={0}
                max={lineSpecialDiscountType === 'percent' ? 100 : undefined}
              />
            </Form.Item>
            {showNetPreview && (
              <Form.Item label="Net cost / unit">
                <Input value={formatRs(previewNetPrice)} disabled />
              </Form.Item>
            )}
          </div>
          <Space>
            <Button type="primary" icon={editingKey ? <EditOutlined /> : <PlusOutlined />} onClick={addLine}>
              {editingKey ? 'Update line' : 'Add line'}
            </Button>
            {editingKey && <Button onClick={resetLineForm}>Cancel edit</Button>}
          </Space>
        </Form>
      </Card>

      <Card bordered={false} className="shadow-sm mb-4">
        <Table
          rowKey="key"
          dataSource={lines}
          pagination={false}
          locale={{ emptyText: 'No parts added yet' }}
          columns={[
            { title: 'Part', dataIndex: 'partName', render: (v) => <Text strong>{v}</Text> },
            { title: 'Category', dataIndex: 'categoryName' },
            { title: 'Units', dataIndex: 'quantity', align: 'right' as const },
            ...(hasDiscount
              ? [
                  {
                    title: 'Retail Price',
                    dataIndex: 'listPrice',
                    align: 'right' as const,
                    render: formatRs
                  },
                  {
                    title: 'Special Disc.',
                    key: 'specialDiscount',
                    render: (_: unknown, r: PartPurchaseLine) =>
                      formatSupplierDiscount(r.specialDiscount, r.specialDiscountType)
                  },
                  {
                    title: 'Net Cost',
                    dataIndex: 'unitCost',
                    align: 'right' as const,
                    render: formatRs
                  }
                ]
              : [
                  {
                    title: 'Purchase Price',
                    dataIndex: 'unitCost',
                    align: 'right' as const,
                    render: formatRs
                  }
                ]),
            {
              title: 'Line total (cost)',
              align: 'right' as const,
              render: (_: unknown, r: PartPurchaseLine) => formatRs(r.quantity * r.unitCost)
            },
            {
              title: '',
              width: 100,
              render: (_: unknown, r: PartPurchaseLine) => (
                <Space size={0}>
                  <Button type="text" icon={<EditOutlined />} onClick={() => startEditLine(r)} />
                  <Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeLine(r.key)} />
                </Space>
              )
            }
          ]}
          summary={() =>
            lines.length ? (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={2}>
                  <Text strong>Totals</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={2} align="right">
                  <Text strong>{totalUnits}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={3} colSpan={hasDiscount ? 3 : 1} align="right">
                  {hasDiscount ? (
                    <Text type="secondary">
                      Retail {formatRs(grossTotal)} → Net {formatRs(netTotal)}
                    </Text>
                  ) : null}
                </Table.Summary.Cell>
                <Table.Summary.Cell index={4} align="right">
                  <Text strong>{formatRs(netTotal)}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={5} />
              </Table.Summary.Row>
            ) : null
          }
        />
      </Card>

      <Button type="primary" size="large" loading={loading} disabled={!canMutate} onClick={handleSubmit}>
        {isEdit ? 'Save changes' : 'Create purchase'}
      </Button>

      <SupplierQuickModal
        open={supplierQuickOpen}
        editing={supplierQuickEditing}
        onCancel={() => {
          setSupplierQuickOpen(false)
          setSupplierQuickEditing(null)
        }}
        onSaved={handleSupplierQuickSaved}
      />
    </div>
  )
}

export default AddPartPurchase
