import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Button,
  Card,
  Checkbox,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message
} from 'antd'
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  PlusOutlined,
  UpOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { App_Routes, VIEW_ONLY_BRANCH_HINT } from '@/common'
import { customerAPI, inventoryAPI, partStockAPI, saleAPI, taxAPI } from '@/renderer/services'
import { useSession } from '@/renderer/hooks/useSession'
import { formatRs } from '../shared/page-ui'
import { CustomerQuickModal } from '@/renderer/components/quick/CustomerQuickModal'
import { SelectQuickFooter } from '@/renderer/components/quick/SelectQuickFooter'
import {
  focusFormFieldError,
  scrollToElementId,
  validateAndScroll
} from '@/renderer/utils/formScroll'
import {
  calcSaleLineAmounts,
  roundAmount,
  type CustomTaxLine
} from '@/renderer/utils/saleTaxCalc'

const { Text } = Typography

type SaleLineType = 'product' | 'part'

type SaleLine = {
  key: string
  id?: string
  lineType: SaleLineType
  productItemId?: string
  partId?: string
  serialNumber?: string
  productName: string
  categoryName: string
  colorName?: string
  quantity: number
  salePrice: number
  taxPercent: number
  taxInclusive: boolean
  whtPercent: number
  customTaxes: CustomTaxLine[]
  warrantyActive: boolean
  warrantyYears?: number
  warrantyExpiryDate?: string
  availableUnits?: number
  locked?: boolean
  /** Preserved DB amounts (edit load) so rounding does not drift until the line is re-entered. */
  fixedAmounts?: { base: number; tax: number; wht: number; other: number; total: number }
}

function calcLineAmounts(line: SaleLine) {
  return calcSaleLineAmounts(line)
}

function calcLineTotal(line: SaleLine) {
  return calcLineAmounts(line).total
}

/** Pricing fields for create/update API — keep frozen edit totals via inclusive resubmit. */
function lineApiPricing(l: SaleLine) {
  const customTaxes = (l.customTaxes || []).map((t) => ({
    taxId: t.taxId,
    name: t.name,
    percent: t.percent,
    inclusive: t.inclusive
  }))

  if (l.fixedAmounts) {
    const exclCustom = (l.customTaxes || [])
      .filter((t) => !t.inclusive)
      .reduce((s, t) => s + Number(t.amount || 0), 0)
    const systemExcl = !l.taxInclusive ? l.fixedAmounts.tax + l.fixedAmounts.wht : 0
    const exclusiveSum = exclCustom + systemExcl
    const hasIncl =
      l.taxInclusive || (l.customTaxes || []).some((t) => t.inclusive && Number(t.percent) > 0)
    if (hasIncl) {
      return {
        salePrice: roundAmount((l.fixedAmounts.total - exclusiveSum) / Math.max(1, l.quantity)),
        taxInclusive: l.taxInclusive,
        taxPercent: l.taxPercent,
        whtPercent: l.whtPercent,
        customTaxes
      }
    }
    return {
      salePrice: roundAmount(l.fixedAmounts.base / Math.max(1, l.quantity)),
      taxInclusive: false,
      taxPercent: l.taxPercent,
      whtPercent: l.whtPercent,
      customTaxes
    }
  }

  return {
    salePrice: l.salePrice,
    taxInclusive: l.taxInclusive,
    taxPercent: l.taxPercent,
    whtPercent: l.whtPercent,
    customTaxes
  }
}

function calcDueAmount(grossTotal: number, paid: number, discount: number) {
  if (grossTotal <= 0) return 0
  return Math.max(0, roundAmount(grossTotal - paid - discount))
}

function formatFifoLayers(layers: { unitCost: number; quantity: number }[]): string {
  if (!layers.length) return '—'
  return layers.map((l) => `${l.quantity} @ ${formatRs(l.unitCost)}`).join(' · ')
}

export const NewSale = () => {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const { companyId, branchId, audit, canMutate } = useSession()
  const [customers, setCustomers] = useState<any[]>([])
  const [taxDefs, setTaxDefs] = useState<any[]>([])
  const [customerQuickOpen, setCustomerQuickOpen] = useState(false)
  const [customerQuickEditing, setCustomerQuickEditing] = useState<any | null>(null)
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [partStocks, setPartStocks] = useState<any[]>([])
  const [lines, setLines] = useState<SaleLine[]>([])
  const [lineType, setLineType] = useState<SaleLineType>('product')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(isEdit)
  const [paidAmount, setPaidAmount] = useState(0)
  const [recordedPaid, setRecordedPaid] = useState(0)
  const [discountAmount, setDiscountAmount] = useState(0)
  const [dueAmount, setDueAmount] = useState(0)
  const [cartSearch, setCartSearch] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [headerForm] = Form.useForm()
  const [lineForm] = Form.useForm()

  const effectivePaid = isEdit ? recordedPaid : paidAmount

  const warrantyActive = Form.useWatch('warrantyActive', lineForm)
  const selectedPartId = Form.useWatch('partId', lineForm)
  const partQuantity = Form.useWatch('quantity', lineForm)
  const selectedCustomerId = Form.useWatch('customerId', headerForm)
  const [partFifoPreview, setPartFifoPreview] = useState<{
    unitCost: number
    nextLotUnitCost: number
    nextLotSalePrice: number
    layers: { unitCost: number; quantity: number; purchaseDate: string }[]
  } | null>(null)

  const loadCustomers = () => {
    if (!companyId) return Promise.resolve()
    return customerAPI.list(companyId).then(setCustomers)
  }

  const loadPartStocks = () => {
    if (!companyId || !branchId) return Promise.resolve()
    return partStockAPI
      .list(companyId, branchId, { page: 1, pageSize: 200 })
      .then((res: any) =>
        setPartStocks(
          (res.items || []).filter((i: any) => isEdit || Number(i.quantityOnHand) > 0)
        )
      )
  }

  const loadTaxes = () => {
    if (!companyId) return Promise.resolve([] as any[])
    return taxAPI
      .list(companyId)
      .then((rows: any) => {
        const list = (rows as any[]) || []
        setTaxDefs(list)
        return list
      })
      .catch(() => {
        setTaxDefs([])
        return [] as any[]
      })
  }

  const applyTaxDefaults = (list: any[]) => {
    const saleTax = list.find((t) => t.code === 'sale_tax')
    const tax236 = list.find((t) => t.code === 'tax_236_gh')
    lineForm.setFieldsValue({
      taxPercent: Number(saleTax?.defaultPercent ?? 0),
      whtPercent: Number(tax236?.defaultPercent ?? 0),
      taxInclusive: true,
      customTaxIds: [],
      warrantyActive: true,
      warrantyYears: 1,
      quantity: 1,
      salePrice: 0
    })
  }

  useEffect(() => {
    if (!companyId) return
    loadCustomers()
    loadPartStocks()
    loadTaxes().then((list) => {
      if (!isEdit) applyTaxDefaults(list)
    })
    if (!isEdit) {
      headerForm.setFieldsValue({
        saleDate: dayjs(),
        paidAmount: 0,
        discount: 0,
        balance: 0,
        paymentMethod: 'cash'
      })
      setPaidAmount(0)
      setDiscountAmount(0)
      setDueAmount(0)
    }
  }, [companyId, branchId, headerForm, lineForm, isEdit])

  useEffect(() => {
    if (!isEdit || !id) return
    setLoadingDetail(true)
    saleAPI
      .get(id)
      .then((detail: any) => {
        if (!detail?.sale) {
          message.error('Sale not found')
          navigate(App_Routes.SALES_LIST)
          return
        }
        if (!detail.editable && !detail.sale.editable) {
          message.warning('This sale can no longer be edited')
          navigate(App_Routes.SALE_DETAIL.replace(':id', id))
          return
        }

        const sale = detail.sale
        const payments = detail.payments || []
        const totalPaid = payments.reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0)
        const discount = Number(sale.discount || 0)

        setRecordedPaid(totalPaid)
        setPaidAmount(totalPaid)
        setDiscountAmount(discount)
        setDueAmount(Number(sale.dueAmount || 0))

        headerForm.setFieldsValue({
          customerId: sale.customerId,
          saleDate: dayjs(sale.saleDate),
          discount,
          paidAmount: totalPaid,
          balance: Number(sale.dueAmount || 0),
          dueReminderDate: sale.dueReminderDate ? dayjs(sale.dueReminderDate) : undefined,
          notes: sale.notes || ''
        })

        setLines(
          (detail.lines || []).map((line: any) => {
            const lineTypeValue: SaleLineType = line.lineType === 'part' ? 'part' : 'product'
            const quantity = Number(line.quantity || 1)
            const base = Number(line.salePrice || 0) * quantity
            const tax = Number(line.taxAmount || 0)
            const wht = Number(line.whtAmount || 0)
            const customTaxes: CustomTaxLine[] = (line.customTaxes || []).map((t: any) => ({
              taxId: t.taxId || undefined,
              name: t.name || 'Tax',
              percent: Number(t.percent || 0),
              inclusive: Boolean(t.inclusive),
              amount: Number(t.amount || 0)
            }))
            const other = roundAmount(customTaxes.reduce((s, t) => s + Number(t.amount || 0), 0))
            const total = Number(line.lineTotal != null ? line.lineTotal : base + tax + wht + other)
            return {
              key: line.id,
              id: line.id,
              lineType: lineTypeValue,
              productItemId: line.productItemId || undefined,
              partId: line.partId || undefined,
              serialNumber: line.serialNumber || undefined,
              productName: line.productName || '—',
              categoryName: line.categoryName || '—',
              colorName: line.colorName || undefined,
              quantity,
              salePrice: Number(line.salePrice || 0),
              taxPercent: Number(line.taxPercent || 0),
              taxInclusive: Boolean(line.taxInclusive),
              whtPercent: Number(line.whtPercent || 0),
              customTaxes,
              warrantyActive: Boolean(line.warrantyActive),
              warrantyYears: line.warrantyYears != null ? Number(line.warrantyYears) : undefined,
              warrantyExpiryDate: line.warrantyExpiryDate
                ? dayjs(line.warrantyExpiryDate).format('YYYY-MM-DD')
                : undefined,
              fixedAmounts: {
                base: roundAmount(base),
                tax: roundAmount(tax),
                wht: roundAmount(wht),
                other,
                total: roundAmount(total)
              }
            }
          })
        )
      })
      .catch((err: any) => {
        message.error(err.message || 'Failed to load sale')
        navigate(App_Routes.SALES_LIST)
      })
      .finally(() => setLoadingDetail(false))
  }, [id, isEdit, navigate, headerForm])

  const customTaxDefs = useMemo(
    () => taxDefs.filter((t) => !t.isSystem && !t.code),
    [taxDefs]
  )

  const resolveCustomTaxesFromForm = (customTaxIds: unknown): CustomTaxLine[] => {
    const ids = Array.isArray(customTaxIds) ? (customTaxIds as string[]) : []
    return ids
      .map((id) => {
        const def = customTaxDefs.find((t) => t.id === id)
        if (!def) return null
        return {
          taxId: def.id as string,
          name: String(def.name),
          percent: Number(def.defaultPercent || 0),
          inclusive: Boolean(def.inclusiveDefault)
        } as CustomTaxLine
      })
      .filter(Boolean) as CustomTaxLine[]
  }

  const customerOptions = customers.map((c) => {
    const outstanding = Number(c.balance ?? 0)
    return {
      value: c.id,
      label: `${c.name}${c.phone ? ` · ${c.phone}` : ''}${outstanding > 0 ? ` · Due ${formatRs(outstanding)}` : ''}`
    }
  })

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) || null,
    [customers, selectedCustomerId]
  )

  const openAddCustomer = () => {
    setCustomerQuickEditing(null)
    setCustomerQuickOpen(true)
  }

  const openEditCustomer = () => {
    if (!selectedCustomer) return
    setCustomerQuickEditing(selectedCustomer)
    setCustomerQuickOpen(true)
  }

  const handleCustomerQuickSaved = async (customer: { id: string }) => {
    setCustomerQuickOpen(false)
    setCustomerQuickEditing(null)
    await loadCustomers()
    headerForm.setFieldValue('customerId', customer.id)
  }

  const partOptions = useMemo(
    () =>
      partStocks.map((s) => ({
        value: s.partId,
        label: `${s.part?.name || 'Part'} · ${s.quantityOnHand} available${
          s.category?.name ? ` · ${s.category.name}` : ''
        }`
      })),
    [partStocks]
  )

  const selectedPartStock = useMemo(
    () => partStocks.find((s) => s.partId === selectedPartId),
    [partStocks, selectedPartId]
  )

  const partQtyMax = useMemo(() => {
    if (!selectedPartId) return undefined
    const stock = partStocks.find((s) => s.partId === selectedPartId)
    if (!stock) return undefined
    const available = Number(stock.quantityOnHand || 0)
    const onSale = lines
      .filter((l) => l.lineType === 'part' && l.partId === selectedPartId && l.key !== editingKey)
      .reduce((sum, l) => sum + l.quantity, 0)
    return available + (isEdit ? onSale : 0)
  }, [selectedPartId, partStocks, lines, editingKey, isEdit])

  const searchSerial = async (query: string) => {
    if (!query?.trim() || !companyId || !branchId) {
      setSearchResults([])
      return
    }
    const res = await inventoryAPI.search(companyId, branchId, query.trim())
    setSearchResults(res as any[])
  }

  const selectedItemId = Form.useWatch('productItemId', lineForm)
  const selectedItem = useMemo(
    () => searchResults.find((r) => r.id === selectedItemId),
    [searchResults, selectedItemId]
  )

  useEffect(() => {
    if (selectedItem && !editingKey) {
      lineForm.setFieldsValue({
        salePrice: Number(selectedItem.sellingPrice || selectedItem.purchasePrice || 0),
        warrantyActive:
          selectedItem.warrantyActive != null ? Boolean(selectedItem.warrantyActive) : true,
        warrantyYears:
          selectedItem.warrantyYears != null ? Number(selectedItem.warrantyYears) : 1,
        quantity: 1
      })
    }
  }, [selectedItem, lineForm, editingKey])

  useEffect(() => {
    if (selectedPartStock && !editingKey) {
      lineForm.setFieldsValue({
        salePrice: Number(
          selectedPartStock.sellingPrice ||
            selectedPartStock.part?.defaultSalePrice ||
            0
        ),
        quantity: 1,
        warrantyActive: false,
        warrantyYears: undefined
      })
    }
  }, [selectedPartStock, lineForm, editingKey])

  useEffect(() => {
    if (!companyId || !branchId || !selectedPartId || lineType !== 'part') {
      setPartFifoPreview(null)
      return
    }
    const qty = Math.max(1, Math.floor(Number(partQuantity || 1)))
    partStockAPI
      .fifoPreview(companyId, branchId, selectedPartId, qty)
      .then((preview: any) => setPartFifoPreview(preview))
      .catch(() => setPartFifoPreview(null))
  }, [companyId, branchId, selectedPartId, partQuantity, lineType])

  const resetLineForm = () => {
    lineForm.resetFields()
    const saleTax = taxDefs.find((t) => t.code === 'sale_tax')
    const tax236 = taxDefs.find((t) => t.code === 'tax_236_gh')
    lineForm.setFieldsValue({
      taxPercent: Number(saleTax?.defaultPercent ?? 0),
      taxInclusive: true,
      whtPercent: Number(tax236?.defaultPercent ?? 0),
      customTaxIds: [],
      warrantyActive: true,
      warrantyYears: 1,
      quantity: 1,
      salePrice: 0
    })
    setSearchResults([])
  }

  const handleTabChange = (key: string) => {
    setLineType(key as SaleLineType)
    setEditingKey(null)
    resetLineForm()
  }

  const productItemFromForm = (productItemId: string) => {
    const fromSearch = searchResults.find((r) => r.id === productItemId)
    if (fromSearch) return fromSearch
    const fromLine = lines.find((l) => l.lineType === 'product' && l.productItemId === productItemId)
    if (!fromLine) return null
    return {
      id: fromLine.productItemId,
      serialNumber: fromLine.serialNumber,
      product: { name: fromLine.productName },
      category: { name: fromLine.categoryName },
      color: fromLine.colorName ? { name: fromLine.colorName } : undefined
    }
  }

  const addProductLine = async () => {
    const values = await validateAndScroll(lineForm, [
      'productItemId',
      'salePrice',
      'taxPercent',
      'taxInclusive',
      'whtPercent',
      'warrantyActive',
      'warrantyYears',
      'customTaxIds'
    ])
    const item = productItemFromForm(values.productItemId)
    if (!item) {
      focusFormFieldError(lineForm, 'productItemId', 'Select a valid unit')
      message.error('Select a valid unit')
      return
    }
    if (
      lines.some(
        (l) =>
          l.lineType === 'product' &&
          l.productItemId === item.id &&
          (!editingKey || l.key !== editingKey)
      )
    ) {
      focusFormFieldError(lineForm, 'productItemId', 'Unit already added to this sale')
      message.error('Unit already added to this sale')
      return
    }
    if (values.warrantyActive && !(Number(values.warrantyYears) >= 1)) {
      focusFormFieldError(
        lineForm,
        'warrantyYears',
        'Warranty years (at least 1) required when warranty is active'
      )
      message.error('Warranty years (at least 1) required when warranty is active')
      return
    }

    const saleDate = headerForm.getFieldValue('saleDate')
    const baseDate = saleDate ? dayjs(saleDate) : dayjs()
    const warrantyYears = values.warrantyActive ? Math.floor(Number(values.warrantyYears)) : undefined
    const warrantyExpiryDate =
      values.warrantyActive && warrantyYears
        ? baseDate.add(warrantyYears, 'year').format('YYYY-MM-DD')
        : undefined

    const nextLine: SaleLine = {
      key: editingKey || `product-${item.id}`,
      lineType: 'product',
      productItemId: item.id,
      serialNumber: item.serialNumber,
      productName: item.product?.name || '—',
      categoryName: item.category?.name || '—',
      colorName: item.color?.name,
      quantity: 1,
      salePrice: Number(values.salePrice || 0),
      taxPercent: Number(values.taxPercent || 0),
      taxInclusive: Boolean(values.taxInclusive),
      whtPercent: Number(values.whtPercent || 0),
      customTaxes: resolveCustomTaxesFromForm(values.customTaxIds),
      warrantyActive: Boolean(values.warrantyActive),
      warrantyYears,
      warrantyExpiryDate
    }

    if (editingKey) {
      const existing = lines.find((l) => l.key === editingKey)
      if (!existing || existing.locked || existing.lineType !== 'product') {
        message.error('This line cannot be edited')
        return
      }
      setLines((prev) =>
        prev.map((l) =>
          l.key === editingKey ? { ...nextLine, id: existing.id, key: existing.key } : l
        )
      )
      setEditingKey(null)
      message.success('Line updated')
    } else {
      setLines((prev) => [...prev, nextLine])
    }

    resetLineForm()
  }

  const partQtyOnSale = (partId: string, excludeKey?: string | null) =>
    lines
      .filter((l) => l.lineType === 'part' && l.partId === partId && l.key !== excludeKey)
      .reduce((sum, l) => sum + l.quantity, 0)

  const addPartLine = async () => {
    const values = await validateAndScroll(lineForm, [
      'partId',
      'quantity',
      'salePrice',
      'taxPercent',
      'taxInclusive',
      'whtPercent',
      'customTaxIds'
    ])
    const stock = partStocks.find((s) => s.partId === values.partId)
    if (!stock) {
      focusFormFieldError(lineForm, 'partId', 'Select a valid part')
      message.error('Select a valid part')
      return
    }
    const quantity = Math.floor(Number(values.quantity))
    if (!Number.isFinite(quantity) || quantity <= 0) {
      focusFormFieldError(lineForm, 'quantity', 'Quantity must be a positive whole number')
      message.error('Quantity must be a positive whole number')
      return
    }
    const available = Number(stock.quantityOnHand || 0)
    const alreadyOnSale = partQtyOnSale(stock.partId, editingKey)
    const effectiveAvailable = available + (isEdit ? alreadyOnSale : 0)
    if (quantity > effectiveAvailable) {
      focusFormFieldError(
        lineForm,
        'quantity',
        `Only ${effectiveAvailable} unit(s) available for this part`
      )
      message.error(`Only ${effectiveAvailable} unit(s) available for this part`)
      return
    }

    const nextLine: SaleLine = {
      key: editingKey || `part-${stock.partId}-${Date.now()}`,
      lineType: 'part',
      partId: stock.partId,
      productName: stock.part?.name || '—',
      categoryName: stock.category?.name || '—',
      quantity,
      salePrice: Number(values.salePrice || 0),
      taxPercent: Number(values.taxPercent || 0),
      taxInclusive: Boolean(values.taxInclusive),
      whtPercent: Number(values.whtPercent || 0),
      customTaxes: resolveCustomTaxesFromForm(values.customTaxIds),
      warrantyActive: false,
      availableUnits: available
    }

    if (editingKey) {
      const existing = lines.find((l) => l.key === editingKey)
      if (!existing || existing.locked || existing.lineType !== 'part') {
        message.error('This line cannot be edited')
        return
      }
      setLines((prev) =>
        prev.map((l) => (l.key === editingKey ? { ...nextLine, id: existing.id, key: existing.key } : l))
      )
      setEditingKey(null)
      message.success('Line updated')
      resetLineForm()
      return
    }

    const existingIdx = lines.findIndex((l) => l.lineType === 'part' && l.partId === stock.partId)
    if (existingIdx >= 0) {
      const requestedTotal = partQtyOnSale(stock.partId) + quantity
      if (requestedTotal > effectiveAvailable) {
        focusFormFieldError(
          lineForm,
          'quantity',
          `Only ${effectiveAvailable} unit(s) available for this part`
        )
        message.error(`Only ${effectiveAvailable} unit(s) available for this part`)
        return
      }
      setLines((prev) =>
        prev.map((l, i) =>
          i === existingIdx
            ? {
                ...l,
                quantity: l.quantity + quantity,
                salePrice: Number(values.salePrice || 0),
                taxPercent: Number(values.taxPercent || 0),
                taxInclusive: Boolean(values.taxInclusive),
                whtPercent: Number(values.whtPercent || 0),
                customTaxes: resolveCustomTaxesFromForm(values.customTaxIds)
              }
            : l
        )
      )
    } else {
      setLines((prev) => [...prev, nextLine])
    }
    resetLineForm()
  }

  const startEditLine = async (line: SaleLine) => {
    if (line.locked) {
      message.warning('This line cannot be edited')
      return
    }

    setEditingKey(line.key)
    setLineType(line.lineType)

    // Prefer the frozen customer-facing total so re-saving does not reintroduce rounding drift.
    const editSalePrice = line.fixedAmounts
      ? roundAmount(
          (line.fixedAmounts.total -
            (line.customTaxes || [])
              .filter((t) => !t.inclusive)
              .reduce((s, t) => s + Number(t.amount || 0), 0) -
            (!line.taxInclusive ? line.fixedAmounts.tax + line.fixedAmounts.wht : 0)) /
            Math.max(1, line.quantity)
        )
      : line.salePrice
    const editTaxInclusive = line.taxInclusive
    const customTaxIds = (line.customTaxes || [])
      .map((t) => t.taxId)
      .filter(Boolean) as string[]

    if (line.lineType === 'product') {
      if (line.productItemId) {
        try {
          const detail: any = await inventoryAPI.detail(line.productItemId)
          if (detail?.item) setSearchResults([detail.item])
        } catch {
          setSearchResults([
            {
              id: line.productItemId,
              serialNumber: line.serialNumber,
              product: { name: line.productName },
              category: { name: line.categoryName },
              color: line.colorName ? { name: line.colorName } : undefined
            }
          ])
        }
      }
      lineForm.setFieldsValue({
        productItemId: line.productItemId,
        serialSearch: line.productItemId,
        salePrice: editSalePrice,
        taxPercent: line.taxPercent,
        taxInclusive: editTaxInclusive,
        whtPercent: line.whtPercent,
        customTaxIds,
        warrantyActive: line.warrantyActive,
        warrantyYears: line.warrantyYears
      })
      return
    }

    lineForm.setFieldsValue({
      partId: line.partId,
      quantity: line.quantity,
      salePrice: editSalePrice,
      taxPercent: line.taxPercent,
      taxInclusive: editTaxInclusive,
      whtPercent: line.whtPercent,
      customTaxIds,
      warrantyActive: false,
      warrantyYears: undefined
    })
  }

  const cancelEditLine = () => {
    setEditingKey(null)
    resetLineForm()
  }

  const addLine = async () => {
    try {
      if (lineType === 'product') await addProductLine()
      else await addPartLine()
    } catch {
      // validation shown by form
    }
  }

  const removeLine = (key: string) => {
    const line = lines.find((l) => l.key === key)
    if (line?.locked) return
    setLines((prev) => prev.filter((l) => l.key !== key))
    if (editingKey === key) cancelEditLine()
  }

  const totalSaleTax = lines.reduce((s, l) => s + calcLineAmounts(l).tax, 0)
  const totalWht = lines.reduce((s, l) => s + calcLineAmounts(l).wht, 0)
  const totalOther = lines.reduce((s, l) => s + calcLineAmounts(l).other, 0)
  const grossTotal = lines.reduce((s, l) => s + calcLineAmounts(l).total, 0)
  const anyTaxInclusive = lines.some(
    (l) =>
      Boolean(l.fixedAmounts) ||
      (l.taxInclusive && (Number(l.taxPercent) > 0 || Number(l.whtPercent) > 0)) ||
      (l.customTaxes || []).some((t) => t.inclusive && Number(t.percent) > 0)
  )
  const maxDiscount = Math.max(0, roundAmount(grossTotal - effectivePaid))

  const lockedCount = lines.filter((l) => l.locked).length
  const productLines = lines.filter((l) => l.lineType === 'product')
  const partLines = lines.filter((l) => l.lineType === 'part')

  const filteredLines = useMemo(() => {
    const term = cartSearch.trim().toLowerCase()
    if (!term) return lines
    return lines.filter((l) => {
      const hay = [l.serialNumber, l.productName, l.categoryName, l.colorName, l.lineType]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(term)
    })
  }, [lines, cartSearch])

  useEffect(() => {
    const due = calcDueAmount(grossTotal, effectivePaid, discountAmount)
    if (due !== dueAmount) {
      setDueAmount(due)
      headerForm.setFieldValue('balance', due)
    }
  }, [grossTotal, effectivePaid, discountAmount, dueAmount, headerForm])

  const handlePaymentValuesChange = (
    changed: Record<string, unknown>,
    all: { paidAmount?: number; discount?: number }
  ) => {
    if (grossTotal <= 0) return

    const paid = isEdit
      ? recordedPaid
      : Math.max(0, Math.min(Number(all.paidAmount ?? paidAmount), grossTotal))
    let discount = Math.max(0, Number(all.discount ?? discountAmount))

    if ('paidAmount' in changed || 'discount' in changed) {
      if (paid + discount > grossTotal) {
        if ('discount' in changed || isEdit) {
          discount = roundAmount(grossTotal - paid)
          if ('discount' in changed) {
            message.warning('Discount cannot exceed sale total minus recorded payments')
          }
        } else {
          discount = roundAmount(Math.max(0, grossTotal - paid))
        }
      }

      const due = calcDueAmount(grossTotal, paid, discount)
      const patch: Record<string, unknown> = { discount, balance: due }
      if (!isEdit) patch.paidAmount = paid
      headerForm.setFieldsValue(patch)
      if (!isEdit) setPaidAmount(paid)
      setDiscountAmount(discount)
      setDueAmount(due)
      if (due === 0) {
        headerForm.setFieldValue('dueReminderDate', undefined)
      }
    }
  }

  const handleSubmit = async () => {
    if (!canMutate) {
      message.error(VIEW_ONLY_BRANCH_HINT)
      return
    }
    if (!lines.length) {
      message.error('Add at least one line')
      scrollToElementId('sale-line-form')
      return
    }
    let header: any
    try {
      header = await validateAndScroll(headerForm)
    } catch {
      return
    }
    const paid = isEdit ? recordedPaid : Number(header.paidAmount || 0)
    const discount = Number(header.discount || 0)
    const due = calcDueAmount(grossTotal, paid, discount)
    if (roundAmount(paid + discount) > grossTotal) {
      const msg = isEdit
        ? 'Discount cannot exceed sale total minus recorded payments'
        : 'Paid amount + discount cannot exceed sale total'
      focusFormFieldError(headerForm, isEdit ? 'discount' : 'paidAmount', msg)
      message.error(msg)
      return
    }
    if (due > 0 && !header.dueReminderDate) {
      focusFormFieldError(headerForm, 'dueReminderDate', 'Select a due reminder date')
      message.error('Select a due reminder date')
      return
    }
    setLoading(true)
    try {
      const payload = {
        customerId: header.customerId,
        saleDate: header.saleDate.format('YYYY-MM-DD'),
        discount,
        notes: header.notes?.trim() || undefined,
        dueReminderDate: due > 0 ? header.dueReminderDate.format('YYYY-MM-DD') : undefined,
        lines: lines.map((l) => {
          const pricing = lineApiPricing(l)
          return l.lineType === 'product'
            ? {
                lineType: 'product',
                productItemId: l.productItemId,
                quantity: 1,
                ...pricing,
                warrantyActive: l.warrantyActive,
                warrantyYears: l.warrantyYears,
                warrantyExpiryDate: l.warrantyExpiryDate
              }
            : {
                lineType: 'part',
                partId: l.partId,
                quantity: l.quantity,
                ...pricing
              }
        })
      }

      const res: any = isEdit
        ? await saleAPI.update(id!, companyId, branchId, audit(), payload)
        : await saleAPI.create(companyId, branchId, audit(), {
            ...payload,
            paidAmount: paid,
            paymentMethod: header.paymentMethod
          })

      const savedDue = res?.dueAmount ?? due
      if (isEdit) {
        message.success(
          savedDue > 0
            ? `Sale updated — ${formatRs(savedDue)} due from customer`
            : `Sale updated — ${lines.length} line(s)`
        )
        navigate(App_Routes.SALE_DETAIL.replace(':id', id!))
        return
      }

      message.success(
        savedDue > 0
          ? `Sale saved — ${formatRs(savedDue)} due from customer`
          : `Sale saved — ${lines.length} line(s)`
      )
      setLines([])
      setEditingKey(null)
      headerForm.resetFields()
      resetLineForm()
      setPaidAmount(0)
      setDiscountAmount(0)
      setDueAmount(0)
      headerForm.setFieldsValue({
        saleDate: dayjs(),
        paidAmount: 0,
        discount: 0,
        balance: 0,
        paymentMethod: 'cash'
      })
      loadCustomers()
      loadPartStocks()
    } catch (err: any) {
      message.error(err.message || (isEdit ? 'Update failed' : 'Sale failed'))
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

  const lineCountLabel = isEdit
    ? `${lines.length} line(s)${lockedCount > 0 ? ` · ${lockedCount} locked` : ''}`
    : `${productLines.length} product · ${partLines.length} part`

  return (
    <div className="flex flex-col gap-2 min-h-0" style={{ height: 'calc(100vh - 112px)' }}>
      <div className="flex-1 min-h-0 app-scroll-y flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {isEdit && (
            <Button
              type="text"
              size="small"
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate(App_Routes.SALE_DETAIL.replace(':id', id!))}
            />
          )}
          <div className="min-w-0">
            <Text strong className="text-base">
              {isEdit ? 'Edit Sale' : 'New Sale'}
            </Text>
            <div className="text-xs text-slate-500">{lineCountLabel}</div>
          </div>
        </div>
        <Space size="small" wrap>
          <Tag>{formatRs(grossTotal)} total</Tag>
          {dueAmount > 0 ? (
            <Tag color="red">Due {formatRs(dueAmount)}</Tag>
          ) : effectivePaid > 0 ? (
            <Tag color="green">Paid</Tag>
          ) : null}
        </Space>
      </div>

      <Card size="small" bordered={false} className="shadow-sm shrink-0">
        <Form form={headerForm} layout="vertical" size="small" scrollToFirstError>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-x-3 gap-y-1">
            <Form.Item
              name="customerId"
              label="Customer"
              className="!mb-1 col-span-2"
              rules={[{ required: true, message: 'Select customer' }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="Select customer"
                options={customerOptions}
                onOpenChange={(open) => {
                  if (open) loadCustomers()
                }}
                dropdownRender={(menu) => (
                  <SelectQuickFooter
                    menu={menu}
                    addLabel="Add customer"
                    onAdd={openAddCustomer}
                    canAdd={canMutate}
                    editLabel="Edit customer"
                    canEdit={canMutate && Boolean(selectedCustomerId)}
                    onEdit={openEditCustomer}
                  />
                )}
              />
            </Form.Item>
            <Form.Item name="saleDate" label="Date" className="!mb-1" rules={[{ required: true }]}>
              <DatePicker className="w-full" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="notes" label="Notes" className="!mb-1 col-span-2">
              <Input placeholder="Optional" />
            </Form.Item>
          </div>
        </Form>
      </Card>

      <Card
        id="sale-line-form"
        size="small"
        bordered={false}
        className="shadow-sm shrink-0 sticky top-0 z-20"
        styles={{
          header: { background: '#fff' },
          body: { background: '#fff' }
        }}
        title={
          <div className="flex flex-wrap items-center justify-between gap-2 py-0.5">
            <span className="text-sm font-semibold">
              {editingKey ? (lineType === 'part' ? 'Edit part' : 'Edit unit') : 'Add line'}
            </span>
            {!isEdit && (
              <Tabs
                size="small"
                activeKey={lineType}
                onChange={handleTabChange}
                className="!mb-0 [&_.ant-tabs-nav]:!mb-0"
                items={[
                  { key: 'product', label: 'Product' },
                  { key: 'part', label: 'Part' }
                ]}
              />
            )}
          </div>
        }
      >
        <Form
          form={lineForm}
          layout="vertical"
          size="small"
          scrollToFirstError
          initialValues={{
            taxPercent: 0,
            taxInclusive: true,
            whtPercent: 0,
            customTaxIds: [],
            warrantyActive: true,
            warrantyYears: 1,
            quantity: 1
          }}
        >
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-x-3 gap-y-0">
            {lineType === 'product' ? (
              <>
                <Form.Item name="serialSearch" label="Chassis" className="!mb-2">
                  <Select
                    showSearch
                    filterOption={false}
                    placeholder="Search chassis"
                    onSearch={searchSerial}
                    notFoundContent="Type to search"
                    options={searchResults.map((r) => ({
                      value: r.id,
                      label: `${r.serialNumber} · ${r.product?.name || ''}`
                    }))}
                    onChange={(itemId) => lineForm.setFieldValue('productItemId', itemId)}
                  />
                </Form.Item>
                <Form.Item
                  name="productItemId"
                  hidden
                  rules={[{ required: true, message: 'Select a unit' }]}
                >
                  <Input />
                </Form.Item>
                <Form.Item label="Product" className="!mb-2 col-span-2">
                  <Input value={selectedItem?.product?.name || '—'} disabled />
                </Form.Item>
                <Form.Item label="Category" className="!mb-2">
                  <Input value={selectedItem?.category?.name || '—'} disabled />
                </Form.Item>
                <Form.Item
                  name="salePrice"
                  label="Sale price"
                  className="!mb-2"
                  rules={[{ required: true }]}
                >
                  <InputNumber className="w-full" min={0} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item
                  name="warrantyActive"
                  label="Warranty"
                  className="!mb-2"
                  valuePropName="checked"
                >
                  <Switch size="small" />
                </Form.Item>
                {warrantyActive && (
                  <Form.Item
                    name="warrantyYears"
                    label="Years"
                    className="!mb-2"
                    rules={[
                      { required: true, message: 'Enter years' },
                      { type: 'number', min: 1, message: 'Min 1' }
                    ]}
                  >
                    <InputNumber
                      className="w-full"
                      min={1}
                      step={1}
                      precision={0}
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                )}
              </>
            ) : (
              <>
                <Form.Item
                  name="partId"
                  label="Part"
                  className="!mb-2 col-span-2"
                  rules={[{ required: true, message: 'Select a part' }]}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    placeholder="Select part"
                    options={partOptions}
                    onOpenChange={(open) => {
                      if (open) loadPartStocks()
                    }}
                  />
                </Form.Item>
                <Form.Item label="Available" className="!mb-2">
                  <Input
                    value={selectedPartStock ? String(selectedPartStock.quantityOnHand) : '—'}
                    disabled
                  />
                </Form.Item>
                <Form.Item
                  name="quantity"
                  label="Units"
                  className="!mb-2"
                  rules={[{ required: true, message: 'Enter units' }]}
                >
                  <InputNumber
                    className="w-full"
                    min={1}
                    max={partQtyMax}
                    step={1}
                    precision={0}
                    style={{ width: '100%' }}
                    onPressEnter={(e) => {
                      e.preventDefault()
                      void addLine()
                    }}
                  />
                </Form.Item>
                <Form.Item
                  name="salePrice"
                  label="Sale price"
                  className="!mb-2"
                  rules={[{ required: true }]}
                >
                  <InputNumber className="w-full" min={0} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item label="Category" className="!mb-2">
                  <Input value={selectedPartStock?.category?.name || '—'} disabled />
                </Form.Item>
              </>
            )}
            <Form.Item label=" " className="!mb-2">
              <Space size="small" wrap>
                <Button
                  type="primary"
                  size="small"
                  icon={editingKey ? <EditOutlined /> : <PlusOutlined />}
                  onClick={addLine}
                >
                  {editingKey ? 'Update' : 'Add'}
                </Button>
                {editingKey && (
                  <Button size="small" onClick={cancelEditLine}>
                    Cancel
                  </Button>
                )}
                <Button
                  type="link"
                  size="small"
                  className="!px-1"
                  icon={showAdvanced ? <UpOutlined /> : <DownOutlined />}
                  onClick={() => setShowAdvanced((v) => !v)}
                >
                  More
                </Button>
              </Space>
            </Form.Item>
          </div>

          {showAdvanced && (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-x-3 gap-y-0 pt-1 border-t border-slate-100 mt-1">
              {lineType === 'part' && (
                <Form.Item
                  label="FIFO cost"
                  className="!mb-2 col-span-2"
                  tooltip="FIFO cost per purchase batch"
                >
                  <Input
                    value={partFifoPreview ? formatFifoLayers(partFifoPreview.layers) : '—'}
                    disabled
                  />
                </Form.Item>
              )}
              <Form.Item label="Sales tax %" className="!mb-2">
                <Form.Item name="taxPercent" noStyle>
                  <InputNumber
                    className="w-full"
                    min={0}
                    max={100}
                    addonAfter="%"
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Form.Item>
              <Form.Item name="whtPercent" label="236 G/H %" className="!mb-2">
                <InputNumber className="w-full" min={0} max={100} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item
                name="taxInclusive"
                label="Tax inclusive"
                className="!mb-2"
                valuePropName="checked"
              >
                <Switch size="small" />
              </Form.Item>
              {customTaxDefs.length > 0 && (
                <Form.Item
                  name="customTaxIds"
                  label="Other taxes"
                  className="!mb-2 col-span-2 lg:col-span-4"
                >
                  <Checkbox.Group
                    options={customTaxDefs.map((t) => ({
                      value: t.id,
                      label: `${t.name} (${Number(t.defaultPercent || 0)}%${
                        t.inclusiveDefault ? ', incl.' : ''
                      })`
                    }))}
                  />
                </Form.Item>
              )}
            </div>
          )}
        </Form>
      </Card>

      <Card
        size="small"
        bordered={false}
        className="shadow-sm shrink-0"
        styles={{ body: { paddingTop: 8 } }}
        title={
          <div className="flex flex-wrap items-center justify-between gap-2 py-0.5">
            <span className="text-sm font-semibold">
              Cart ({filteredLines.length}
              {cartSearch.trim() && filteredLines.length !== lines.length
                ? ` / ${lines.length}`
                : ''}
              )
            </span>
            <Input.Search
              allowClear
              size="small"
              placeholder="Filter cart…"
              style={{ width: 220 }}
              value={cartSearch}
              onChange={(e) => setCartSearch(e.target.value)}
            />
          </div>
        }
      >
          <Table
            rowKey="key"
            size="small"
            dataSource={filteredLines}
            pagination={false}
            scroll={{ x: 900 }}
            className="[&_.ant-table-cell]:!whitespace-nowrap [&_.ant-table-cell]:!py-1.5"
            locale={{
              emptyText: cartSearch.trim() ? 'No matching lines' : 'No lines yet — add above'
            }}
            columns={[
              {
                title: '',
                dataIndex: 'lineType',
                width: 56,
                render: (v: SaleLineType) => (
                  <Tag className="!m-0" color={v === 'part' ? 'blue' : 'default'}>
                    {v === 'part' ? 'P' : 'U'}
                  </Tag>
                )
              },
              {
                title: 'Chassis / Qty',
                width: 130,
                render: (_: unknown, r: SaleLine) =>
                  r.lineType === 'product' ? (
                    <Text strong className="text-xs whitespace-nowrap">
                      {r.serialNumber}
                    </Text>
                  ) : (
                    <Text strong className="text-xs">
                      ×{r.quantity}
                    </Text>
                  )
              },
              {
                title: 'Name',
                dataIndex: 'productName',
                ellipsis: true,
                render: (v: string) => <span className="text-xs">{v}</span>
              },
              {
                title: 'Color',
                width: 90,
                ellipsis: true,
                dataIndex: 'colorName',
                render: (v: string | undefined, r: SaleLine) =>
                  r.lineType === 'product' ? <span className="text-xs">{v || '—'}</span> : '—'
              },
              {
                title: 'Price',
                dataIndex: 'salePrice',
                width: 100,
                align: 'right' as const,
                render: (v: number) => <span className="text-xs">{formatRs(v)}</span>
              },
              {
                title: 'Tax',
                width: 72,
                render: (_: unknown, r: SaleLine) => (
                  <span className="text-xs">
                    {r.taxPercent > 0 ? `${r.taxPercent}%` : '—'}
                  </span>
                )
              },
              {
                title: 'Total',
                width: 100,
                align: 'right' as const,
                render: (_: unknown, r: SaleLine) => (
                  <span className="text-xs font-medium">{formatRs(calcLineTotal(r))}</span>
                )
              },
              {
                title: 'Warr.',
                width: 72,
                render: (_: unknown, r: SaleLine) =>
                  r.lineType === 'product' ? (
                    <span className="text-xs">
                      {r.warrantyActive ? `${r.warrantyYears || '—'}y` : '—'}
                    </span>
                  ) : (
                    '—'
                  )
              },
              {
                title: '',
                width: 72,
                fixed: 'right' as const,
                render: (_: unknown, r: SaleLine) =>
                  r.locked ? (
                    <Space size={0}>
                      <Button type="text" size="small" icon={<EditOutlined />} disabled />
                      <Button type="text" size="small" danger icon={<DeleteOutlined />} disabled />
                    </Space>
                  ) : (
                    <Space size={0}>
                      <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => startEditLine(r)}
                      />
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => removeLine(r.key)}
                      />
                    </Space>
                  )
              }
            ]}
          />
      </Card>
      </div>

      <div className="shrink-0 border border-slate-200 rounded-lg bg-white px-3 py-2 shadow-sm z-30">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <Form
            form={headerForm}
            layout="inline"
            size="small"
            onValuesChange={handlePaymentValuesChange}
            className="flex flex-wrap gap-y-1"
          >
            {isEdit ? (
              <Form.Item label="Paid" className="!mb-0">
                <InputNumber value={recordedPaid} disabled style={{ width: 110 }} />
              </Form.Item>
            ) : (
              <Form.Item
                name="paidAmount"
                label="Paid now"
                className="!mb-0"
                rules={[
                  {
                    validator: (_, value) => {
                      const paid = Number(value || 0)
                      const discount = Number(headerForm.getFieldValue('discount') || 0)
                      if (grossTotal > 0 && paid + discount > grossTotal) {
                        return Promise.reject(new Error('Exceeds total'))
                      }
                      return Promise.resolve()
                    }
                  }
                ]}
              >
                <InputNumber
                  min={0}
                  max={grossTotal > 0 ? grossTotal : undefined}
                  style={{ width: 110 }}
                />
              </Form.Item>
            )}
            <Form.Item
              name="discount"
              label="Discount"
              className="!mb-0"
              rules={[
                {
                  validator: (_, value) => {
                    const discount = Number(value || 0)
                    const paid = isEdit
                      ? recordedPaid
                      : Number(headerForm.getFieldValue('paidAmount') || 0)
                    if (grossTotal > 0 && paid + discount > grossTotal) {
                      return Promise.reject(new Error('Exceeds total'))
                    }
                    return Promise.resolve()
                  }
                }
              ]}
            >
              <InputNumber min={0} max={maxDiscount || undefined} style={{ width: 110 }} />
            </Form.Item>
            <Form.Item name="balance" label="Due" className="!mb-0" initialValue={0}>
              <InputNumber disabled style={{ width: 110 }} />
            </Form.Item>
            {dueAmount > 0 && (
              <Form.Item
                name="dueReminderDate"
                label="Reminder"
                className="!mb-0"
                rules={[{ required: true, message: 'Select reminder date' }]}
              >
                <DatePicker style={{ width: 130 }} />
              </Form.Item>
            )}
            {!isEdit && (
              <Form.Item name="paymentMethod" label="Method" className="!mb-0" initialValue="cash">
                <Select
                  style={{ width: 100 }}
                  options={[
                    { value: 'cash', label: 'Cash' },
                    { value: 'bank', label: 'Bank' },
                    { value: 'card', label: 'Card' }
                  ]}
                />
              </Form.Item>
            )}
          </Form>

          <div className="flex flex-wrap items-center gap-3">
            <div className="text-xs text-slate-600 hidden sm:block">
              {discountAmount > 0 && (
                <span className="mr-3">Disc −{formatRs(discountAmount)}</span>
              )}
              {totalSaleTax + totalWht + totalOther > 0 && (
                <span className="mr-3">
                  Tax +{formatRs(totalSaleTax + totalWht + totalOther)}
                  {anyTaxInclusive ? ' (incl.)' : ''}
                </span>
              )}
              <span className="font-semibold text-slate-900">Total {formatRs(grossTotal)}</span>
              {dueAmount > 0 && (
                <span className="ml-3 text-red-600 font-semibold">Due {formatRs(dueAmount)}</span>
              )}
            </div>
            <Space size="small">
              {!isEdit && (
                <Button
                  size="small"
                  disabled={!lines.length}
                  onClick={() => {
                    if (lines.length > 20 && !window.confirm(`Clear ${lines.length} lines?`)) return
                    setLines([])
                    setCartSearch('')
                    cancelEditLine()
                  }}
                >
                  Clear
                </Button>
              )}
              {isEdit && (
                <Button
                  size="small"
                  onClick={() => navigate(App_Routes.SALE_DETAIL.replace(':id', id!))}
                >
                  Cancel
                </Button>
              )}
              <Button
                type="primary"
                size="small"
                loading={loading}
                onClick={handleSubmit}
                disabled={!canMutate || !lines.length}
              >
                {isEdit ? 'Update' : 'Save sale'}
              </Button>
            </Space>
          </div>
        </div>
      </div>

      <CustomerQuickModal
        open={customerQuickOpen}
        editing={customerQuickEditing}
        onCancel={() => {
          setCustomerQuickOpen(false)
          setCustomerQuickEditing(null)
        }}
        onSaved={handleCustomerQuickSaved}
      />
    </div>
  )
}

export default NewSale
