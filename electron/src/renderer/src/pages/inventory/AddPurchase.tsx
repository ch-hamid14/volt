import { useEffect, useMemo, useRef, useState } from 'react'
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
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message
} from 'antd'
import { ArrowLeftOutlined, DeleteOutlined, DownOutlined, EditOutlined, PlusOutlined, UpOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useNavigate, useParams } from 'react-router-dom'
import { App_Routes, VIEW_ONLY_BRANCH_HINT } from '@/common'
import {
  categoryAPI,
  colorAPI,
  productAPI,
  purchaseAPI,
  partAPI,
  partPurchaseAPI,
  supplierAPI
} from '@/renderer/services'
import { useSession } from '@/renderer/hooks/useSession'
import {
  applySupplierDiscount,
  formatSupplierDiscount,
  round2,
  SUPPLIER_DISCOUNT_TYPE_OPTIONS,
  type SupplierDiscountType
} from '@/renderer/utils/supplierDiscount'
import { formatRs } from '../shared/page-ui'
import { SupplierQuickModal } from '@/renderer/components/quick/SupplierQuickModal'
import { ProductQuickModal } from '@/renderer/components/quick/ProductQuickModal'
import { ColorQuickModal } from '@/renderer/components/quick/ColorQuickModal'
import { SelectQuickFooter } from '@/renderer/components/quick/SelectQuickFooter'
import { STATUS_COLORS } from './inventory-ui'
import {
  focusFormFieldError,
  scrollToElementId,
  validateAndScroll
} from '@/renderer/utils/formScroll'

const { Text } = Typography

type LineType = 'product' | 'part'

/** Which discounts are subtracted when computing net cost / unit. */
type DiscountApplyMode = 'both' | 'supplier' | 'special'

const DISCOUNT_APPLY_OPTIONS: { value: DiscountApplyMode; label: string }[] = [
  { value: 'special', label: 'Special only' },
  { value: 'supplier', label: 'Supplier only' },
  { value: 'both', label: 'Supplier + Special' }
]

type CartLine = {
  key: string
  lineType: LineType
  id?: string
  // product
  motorNumber?: string
  serialNumber?: string
  productId?: string
  colorId?: string
  colorName?: string
  warrantyActive?: boolean
  warrantyYears?: number
  warrantyExpiryDate?: string
  locked?: boolean
  status?: string
  // part
  partId?: string
  quantity?: number
  // shared
  productName: string
  categoryName: string
  listPrice: number
  purchasePrice: number
  specialDiscount: number
  specialDiscountType: SupplierDiscountType
  discountApplyMode: DiscountApplyMode
}

function effectiveDiscounts(
  supplierDiscount: number,
  specialDiscount: number,
  mode: DiscountApplyMode
): { supplier: number; special: number } {
  if (mode === 'supplier') return { supplier: supplierDiscount, special: 0 }
  if (mode === 'special') return { supplier: 0, special: specialDiscount }
  return { supplier: supplierDiscount, special: specialDiscount }
}

function computeNetPrice(
  listPrice: number,
  supplierDiscount: number,
  supplierDiscountType: SupplierDiscountType,
  specialDiscount: number,
  specialDiscountType: SupplierDiscountType,
  discountApplyMode: DiscountApplyMode = 'supplier'
): number {
  const { supplier, special } = effectiveDiscounts(
    supplierDiscount,
    specialDiscount,
    discountApplyMode
  )
  const afterSupplier = applySupplierDiscount(listPrice, supplier, supplierDiscountType)
  return applySupplierDiscount(afterSupplier, special, specialDiscountType)
}

function resolveLineNetCost(
  listPrice: number,
  supplierDiscount: number,
  supplierDiscountType: SupplierDiscountType,
  specialDiscount: number,
  specialDiscountType: SupplierDiscountType,
  discountApplyMode: DiscountApplyMode = 'supplier',
  manualNetCost?: number
): number {
  const { supplier, special } = effectiveDiscounts(
    supplierDiscount,
    specialDiscount,
    discountApplyMode
  )
  if (supplier > 0 || special > 0) {
    return computeNetPrice(
      listPrice,
      supplierDiscount,
      supplierDiscountType,
      specialDiscount,
      specialDiscountType,
      discountApplyMode
    )
  }
  return round2(Number(manualNetCost ?? listPrice))
}

function parseDiscountApplyMode(value: unknown): DiscountApplyMode {
  if (value === 'supplier' || value === 'special' || value === 'both') return value
  return 'supplier'
}

function lineQty(line: CartLine): number {
  if (line.lineType === 'part') return Math.max(1, Number(line.quantity || 1))
  return 1
}

const RETAIL_BELOW_NET_MSG = 'Retail price cannot be less than net cost'

function retailBelowNet(retail: number, netCost: number): boolean {
  return netCost > retail
}

export const AddPurchase = () => {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const { companyId, branchId, audit, canMutate } = useSession()
  const [suppliers, setSuppliers] = useState<any[]>([])
  const [supplierQuickOpen, setSupplierQuickOpen] = useState(false)
  const [supplierQuickEditing, setSupplierQuickEditing] = useState<any | null>(null)
  const [productQuickOpen, setProductQuickOpen] = useState(false)
  const [colorQuickOpen, setColorQuickOpen] = useState(false)
  const [products, setProducts] = useState<any[]>([])
  const [parts, setParts] = useState<any[]>([])
  const [colors, setColors] = useState<any[]>([])
  const [categories, setCategories] = useState<any[]>([])
  const [lines, setLines] = useState<CartLine[]>([])
  const [lineType, setLineType] = useState<LineType>('product')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [activeProduct, setActiveProduct] = useState<any | null>(null)
  const [activePart, setActivePart] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(isEdit)
  const [recordedPaid, setRecordedPaid] = useState(0)
  const [cartSearch, setCartSearch] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [tableHeight, setTableHeight] = useState(200)
  const cartBodyRef = useRef<HTMLDivElement>(null)
  const [headerForm] = Form.useForm()
  const [lineForm] = Form.useForm()

  const warrantyActive = Form.useWatch('warrantyActive', lineForm)
  const lineSpecialDiscount = Number(Form.useWatch('specialDiscount', lineForm) || 0)
  const lineSpecialDiscountType: SupplierDiscountType =
    Form.useWatch('specialDiscountType', lineForm) === 'percent' ? 'percent' : 'pkr'
  const lineDiscountApplyMode = parseDiscountApplyMode(Form.useWatch('discountApplyMode', lineForm))

  const activeLineType: LineType = isEdit ? 'product' : lineType

  const loadSuppliers = () => {
    if (!companyId) return Promise.resolve()
    return supplierAPI.list(companyId).then((rows) => setSuppliers(Array.isArray(rows) ? rows : []))
  }

  const loadProducts = () => {
    if (!companyId) return Promise.resolve()
    return productAPI.list(companyId).then((rows) => setProducts(Array.isArray(rows) ? rows : []))
  }

  const loadColors = () => {
    if (!companyId) return Promise.resolve()
    return colorAPI.list(companyId).then((rows) => setColors(Array.isArray(rows) ? rows : []))
  }

  const loadCategories = () => {
    if (!companyId) return Promise.resolve()
    return categoryAPI.list(companyId).then((rows) => setCategories(Array.isArray(rows) ? rows : []))
  }

  useEffect(() => {
    if (!companyId) return
    loadSuppliers()
    loadProducts()
    loadColors()
    loadCategories()
    if (!isEdit) {
      partAPI.list(companyId).then((rows) => setParts(Array.isArray(rows) ? rows : []))
      headerForm.setFieldsValue({ purchaseDate: dayjs(), paidAmount: 0, paymentMethod: 'cash', balance: 0 })
      lineForm.setFieldsValue({
        specialDiscount: 0,
        specialDiscountType: 'pkr',
        discountApplyMode: 'supplier',
        quantity: 1,
        warrantyActive: false,
        netCost: 0
      })
    }
  }, [companyId, headerForm, lineForm, isEdit])

  useEffect(() => {
    const el = cartBodyRef.current
    if (!el || typeof ResizeObserver === 'undefined') return

    const updateHeight = () => {
      const next = Math.max(120, Math.floor(el.clientHeight - 42))
      setTableHeight((prev) => (prev === next ? prev : next))
    }

    updateHeight()
    const raf = requestAnimationFrame(updateHeight)
    const ro = new ResizeObserver(updateHeight)
    ro.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [showAdvanced, isEdit])

  useEffect(() => {
    if (!isEdit || !id) return
    setLoadingDetail(true)
    purchaseAPI
      .get(id)
      .then((detail: any) => {
        if (!detail?.purchase) {
          message.error('Purchase not found')
          navigate(App_Routes.PURCHASE_LIST)
          return
        }
        if (!detail.editable && !detail.purchase.editable) {
          message.warning('No in-stock units left to edit on this purchase')
          navigate(App_Routes.PURCHASE_DETAIL.replace(':id', id))
          return
        }

        const purchase = detail.purchase
        const totalPaid = Number(purchase.paidAmount || 0)
        const totalDue = Number(purchase.dueAmount || 0)
        setRecordedPaid(totalPaid)
        headerForm.setFieldsValue({
          supplierId: purchase.supplierId,
          purchaseDate: dayjs(purchase.purchaseDate),
          notes: purchase.notes || '',
          paidAmount: totalPaid,
          balance: totalDue
        })

        setLines(
          (detail.items || []).map((item: any) => ({
            key: item.id,
            lineType: 'product' as const,
            id: item.id,
            serialNumber: item.serialNumber,
            motorNumber: item.motorNumber || undefined,
            productId: item.productId,
            productName: item.product?.name || '—',
            categoryName: item.category?.name || '—',
            colorId: item.colorId || undefined,
            colorName: item.color?.name,
            listPrice: Number(item.sellingPrice ?? item.purchasePrice ?? 0),
            purchasePrice: Number(item.purchasePrice ?? 0),
            specialDiscount: Number(item.specialDiscount || 0),
            specialDiscountType: item.specialDiscountType === 'percent' ? 'percent' : 'pkr',
            // Saved net cost already reflects how discounts were applied; default special for recalc.
            discountApplyMode: 'special' as DiscountApplyMode,
            warrantyActive: Boolean(item.warrantyActive),
            warrantyYears: item.warrantyYears != null ? Number(item.warrantyYears) : undefined,
            warrantyExpiryDate: item.warrantyExpiryDate
              ? dayjs(item.warrantyExpiryDate).format('YYYY-MM-DD')
              : undefined,
            status: item.status,
            locked: item.status !== 'in_stock'
          }))
        )
      })
      .catch((err: any) => {
        message.error(err.message || 'Failed to load purchase')
        navigate(App_Routes.PURCHASE_LIST)
      })
      .finally(() => setLoadingDetail(false))
  }, [id, isEdit, navigate, headerForm])

  const productMap = useMemo(
    () => new Map(products.map((p) => [String(p.id), p])),
    [products]
  )
  const partMap = useMemo(() => new Map(parts.map((p) => [String(p.id), p])), [parts])
  const colorMap = useMemo(() => new Map(colors.map((c) => [String(c.id), c])), [colors])
  const categoryMap = useMemo(
    () => new Map(categories.map((c) => [String(c.id), c])),
    [categories]
  )
  const supplierMap = useMemo(
    () => new Map(suppliers.map((s) => [String(s.id), s])),
    [suppliers]
  )

  const resolveProduct = (id: unknown) => {
    if (id == null || id === '') return undefined
    const key = String(id)
    return productMap.get(key) || products.find((p) => String(p.id) === key)
  }

  const resolvePart = (id: unknown) => {
    if (id == null || id === '') return undefined
    const key = String(id)
    return partMap.get(key) || parts.find((p) => String(p.id) === key)
  }

  const productCategoryName = (product: any | undefined) =>
    product?.category?.name ||
    product?.categoryName ||
    categoryMap.get(String(product?.categoryId ?? ''))?.name ||
    '—'

  const selectedSupplierId = Form.useWatch('supplierId', headerForm)
  const watchedPaidAmount = Number(Form.useWatch('paidAmount', headerForm) || 0)
  const selectedSupplier = selectedSupplierId
    ? supplierMap.get(String(selectedSupplierId))
    : undefined
  const supplierDiscount = Number(selectedSupplier?.discount || 0)
  const supplierDiscountType: SupplierDiscountType =
    selectedSupplier?.discountType === 'percent' ? 'percent' : 'pkr'
  const hasSupplierDiscount = supplierDiscount > 0
  const showDiscountApplyControl = hasSupplierDiscount || lineSpecialDiscount > 0
  const showComputedNet = showDiscountApplyControl
  const showEditableNetCost = !showDiscountApplyControl
  const partLines = lines.filter((l) => l.lineType === 'part')

  const watchedPurchasePrice = Form.useWatch('purchasePrice', lineForm)
  const enteredListPrice = Number(watchedPurchasePrice ?? 0)
  const previewNetPrice = computeNetPrice(
    Number.isFinite(enteredListPrice) ? enteredListPrice : 0,
    supplierDiscount,
    supplierDiscountType,
    lineSpecialDiscount,
    lineSpecialDiscountType,
    lineDiscountApplyMode
  )

  const recalcLines = (supplier?: { discount?: number; discountType?: string }) => {
    const sDiscount = Number(supplier?.discount || 0)
    const sType: SupplierDiscountType = supplier?.discountType === 'percent' ? 'percent' : 'pkr'
    setLines((prev) =>
      prev.map((line) => {
        if (line.locked) return line
        const hasLineDiscount = sDiscount > 0 || line.specialDiscount > 0
        // Keep manually entered net cost when no discounts apply
        if (!hasLineDiscount) return line
        return {
          ...line,
          purchasePrice: resolveLineNetCost(
            line.listPrice,
            sDiscount,
            sType,
            line.specialDiscount,
            line.specialDiscountType,
            line.discountApplyMode
          )
        }
      })
    )
  }

  const productOptions = products.map((p) => ({
    value: String(p.id),
    label: `${p.name}${productCategoryName(p) !== '—' ? ` · ${productCategoryName(p)}` : ''}`
  }))
  const partOptions = parts.map((p) => ({
    value: String(p.id),
    label: `${p.name}${productCategoryName(p) !== '—' ? ` · ${productCategoryName(p)}` : ''}`
  }))
  const colorOptions = colors.map((c) => ({ value: String(c.id), label: c.name }))
  const supplierOptions = suppliers.map((s) => ({ value: String(s.id), label: s.name }))

  const selectedProductId = Form.useWatch('productId', lineForm)
  const selectedPartId = Form.useWatch('partId', lineForm)

  useEffect(() => {
    if (activeLineType === 'product') {
      if (!selectedProductId) {
        setActiveProduct(null)
        return
      }
      const product = resolveProduct(selectedProductId)
      if (product) setActiveProduct(product)
      return
    }
    if (!selectedPartId) {
      setActivePart(null)
      return
    }
    const part = resolvePart(selectedPartId)
    if (part) setActivePart(part)
  }, [activeLineType, selectedProductId, selectedPartId, products, parts])

  const categoryPreview =
    activeLineType === 'product'
      ? productCategoryName(
          activeProduct && String(activeProduct.id) === String(selectedProductId ?? '')
            ? activeProduct
            : resolveProduct(selectedProductId)
        )
      : productCategoryName(
          activePart && String(activePart.id) === String(selectedPartId ?? '')
            ? activePart
            : resolvePart(selectedPartId)
        )

  const applyProductDefaults = (productId: string) => {
    const product = resolveProduct(productId)
    setActiveProduct(product ?? null)
    if (!product) return
    const retail = Number(product.defaultSalePrice ?? product.defaultPurchasePrice ?? 0)
    const net = Number(product.defaultPurchasePrice ?? retail ?? 0)
    lineForm.setFieldsValue({
      productId: String(product.id),
      ...(retail > 0 ? { purchasePrice: retail } : {}),
      ...(net > 0 ? { netCost: net } : {})
    })
  }

  const applyPartDefaults = (partId: string) => {
    const part = resolvePart(partId)
    setActivePart(part ?? null)
    if (!part) return
    const retail = Number(part.defaultSalePrice ?? part.defaultPurchasePrice ?? 0)
    const net = Number(part.defaultPurchasePrice ?? retail ?? 0)
    lineForm.setFieldsValue({
      partId: String(part.id),
      ...(retail > 0 ? { purchasePrice: retail } : {}),
      ...(net > 0 ? { netCost: net } : {})
    })
  }

  const handleSupplierChange = (supplierId: string) => {
    recalcLines(supplierMap.get(String(supplierId)))
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

  const handleProductQuickSaved = async (product: { id: string }) => {
    setProductQuickOpen(false)
    await loadProducts()
    applyProductDefaults(String(product.id))
  }

  const handleColorQuickSaved = async (color: { id: string }) => {
    setColorQuickOpen(false)
    await loadColors()
    lineForm.setFieldValue('colorId', String(color.id))
  }

  const resetLineForm = () => {
    lineForm.resetFields()
    setActiveProduct(null)
    setActivePart(null)
    lineForm.setFieldsValue({
      warrantyActive: false,
      motorNumber: '',
      serialNumber: '',
      quantity: 1,
      specialDiscount: 0,
      specialDiscountType: 'pkr',
      discountApplyMode: 'supplier',
      netCost: 0
    })
  }

  const handleTabChange = (key: string) => {
    if (key === lineType) return
    setLineType(key as LineType)
    setEditingKey(null)
    resetLineForm()
  }

  const addProductLine = async () => {
    const values = await validateAndScroll(lineForm)
    const productId = values.productId ?? lineForm.getFieldValue('productId')
    const product =
      (activeProduct && String(activeProduct.id) === String(productId) ? activeProduct : null) ||
      resolveProduct(productId)
    if (!product) {
      focusFormFieldError(lineForm, 'productId', 'Select a valid product')
      message.error('Select a valid product')
      return
    }
    const serial = String(values.serialNumber || '').trim()
    if (
      lines.some(
        (l) =>
          l.lineType === 'product' &&
          l.serialNumber === serial &&
          (!editingKey || l.key !== editingKey)
      )
    ) {
      focusFormFieldError(lineForm, 'serialNumber', 'Chassis number already added to this purchase')
      message.error('Chassis number already added to this purchase')
      return
    }
    if (values.warrantyActive && !(Number(values.warrantyYears) >= 1)) {
      focusFormFieldError(
        lineForm,
        'warrantyYears',
        'Warranty years (whole number ≥ 1) required when warranty is active'
      )
      message.error('Warranty years (whole number ≥ 1) required when warranty is active')
      return
    }

    const color = values.colorId ? colorMap.get(String(values.colorId)) : undefined
    const listPrice = Number(
      values.purchasePrice ?? lineForm.getFieldValue('purchasePrice') ?? 0
    )
    if (!(listPrice > 0)) {
      focusFormFieldError(lineForm, 'purchasePrice', 'Enter retail price')
      message.error('Enter retail price')
      return
    }
    const specialDiscount = Number(values.specialDiscount || 0)
    const specialDiscountType: SupplierDiscountType =
      values.specialDiscountType === 'percent' ? 'percent' : 'pkr'
    const discountApplyMode = parseDiscountApplyMode(
      values.discountApplyMode ?? lineForm.getFieldValue('discountApplyMode') ?? 'supplier'
    )
    const hasDiscountOnLine = supplierDiscount > 0 || specialDiscount > 0
    const netCost = Number(values.netCost ?? lineForm.getFieldValue('netCost') ?? 0)
    if (!hasDiscountOnLine && netCost <= 0) {
      focusFormFieldError(lineForm, 'netCost', 'Enter net cost per unit')
      message.error('Enter net cost per unit')
      return
    }

    const warrantyYears = values.warrantyActive ? Math.floor(Number(values.warrantyYears)) : undefined
    const purchaseDateValue = headerForm.getFieldValue('purchaseDate')
    const warrantyExpiryDate =
      values.warrantyActive && warrantyYears && purchaseDateValue
        ? dayjs(purchaseDateValue).add(warrantyYears, 'year').format('YYYY-MM-DD')
        : undefined

    const nextLine: CartLine = {
      key: editingKey || `${serial}-${Date.now()}`,
      lineType: 'product',
      serialNumber: serial,
      motorNumber: values.motorNumber?.trim() || undefined,
      productId: String(product.id),
      productName: product.name,
      categoryName: productCategoryName(product),
      colorId: values.colorId ? String(values.colorId) : undefined,
      colorName: color?.name,
      listPrice,
      specialDiscount,
      specialDiscountType,
      discountApplyMode,
      purchasePrice: resolveLineNetCost(
        listPrice,
        supplierDiscount,
        supplierDiscountType,
        specialDiscount,
        specialDiscountType,
        discountApplyMode,
        hasDiscountOnLine ? undefined : netCost
      ),
      warrantyActive: Boolean(values.warrantyActive),
      warrantyYears,
      warrantyExpiryDate
    }

    if (retailBelowNet(nextLine.listPrice, nextLine.purchasePrice)) {
      focusFormFieldError(lineForm, 'purchasePrice', RETAIL_BELOW_NET_MSG)
      message.error(RETAIL_BELOW_NET_MSG)
      return
    }

    if (editingKey) {
      const existing = lines.find((l) => l.key === editingKey)
      if (!existing || existing.locked || existing.lineType !== 'product') {
        message.error('This unit cannot be edited')
        return
      }
      setLines((prev) =>
        prev.map((l) =>
          l.key === editingKey
            ? {
                ...nextLine,
                id: existing.id,
                locked: existing.locked,
                status: existing.status || 'in_stock'
              }
            : l
        )
      )
      setEditingKey(null)
      message.success('Unit updated in list')
      resetLineForm()
    } else {
      setLines((prev) => [...prev, nextLine])
      focusChassisInput()
    }
  }

  const addPartLine = async () => {
    const values = await validateAndScroll(lineForm)
    const partId = values.partId ?? lineForm.getFieldValue('partId')
    const part =
      (activePart && String(activePart.id) === String(partId) ? activePart : null) ||
      resolvePart(partId)
    if (!part) {
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

    const listPrice = Number(
      values.purchasePrice ?? lineForm.getFieldValue('purchasePrice') ?? 0
    )
    if (!(listPrice > 0)) {
      focusFormFieldError(lineForm, 'purchasePrice', 'Enter retail price')
      message.error('Enter retail price')
      return
    }
    const specialDiscount = Number(values.specialDiscount || 0)
    const specialDiscountType: SupplierDiscountType =
      values.specialDiscountType === 'percent' ? 'percent' : 'pkr'
    const discountApplyMode = parseDiscountApplyMode(
      values.discountApplyMode ?? lineForm.getFieldValue('discountApplyMode') ?? 'supplier'
    )
    const hasDiscountOnLine = supplierDiscount > 0 || specialDiscount > 0
    const netCost = Number(values.netCost ?? lineForm.getFieldValue('netCost') ?? 0)
    if (!hasDiscountOnLine && netCost <= 0) {
      focusFormFieldError(lineForm, 'netCost', 'Enter net cost per unit')
      message.error('Enter net cost per unit')
      return
    }

    const nextLine: CartLine = {
      key: editingKey || `part-${values.partId}-${Date.now()}`,
      lineType: 'part',
      partId: String(part.id),
      productName: part.name,
      categoryName: productCategoryName(part),
      quantity,
      listPrice,
      specialDiscount,
      specialDiscountType,
      discountApplyMode,
      purchasePrice: resolveLineNetCost(
        listPrice,
        supplierDiscount,
        supplierDiscountType,
        specialDiscount,
        specialDiscountType,
        discountApplyMode,
        hasDiscountOnLine ? undefined : netCost
      )
    }

    if (retailBelowNet(nextLine.listPrice, nextLine.purchasePrice)) {
      focusFormFieldError(lineForm, 'purchasePrice', RETAIL_BELOW_NET_MSG)
      message.error(RETAIL_BELOW_NET_MSG)
      return
    }

    if (editingKey) {
      const existing = lines.find((l) => l.key === editingKey)
      if (!existing || existing.lineType !== 'part') {
        message.error('This line cannot be edited')
        return
      }
      setLines((prev) =>
        prev.map((l) => (l.key === editingKey ? { ...nextLine, id: existing.id } : l))
      )
      setEditingKey(null)
      message.success('Part line updated')
      resetLineForm()
    } else {
      setLines((prev) => [...prev, nextLine])
      // Keep part / price / discounts; only reset quantity for the next line.
      lineForm.setFieldsValue({ quantity: 1 })
    }
  }

  const addLine = async () => {
    try {
      if (activeLineType === 'product') await addProductLine()
      else await addPartLine()
    } catch {
      // validation shown by form
    }
  }

  const startEditLine = (line: CartLine) => {
    if (line.locked) {
      message.warning('Sold or not in stock units cannot be edited')
      return
    }
    if (isEdit && line.lineType !== 'product') return

    setEditingKey(line.key)
    if (!isEdit) setLineType(line.lineType)
    if (
      line.specialDiscount > 0 ||
      line.warrantyActive ||
      (line.discountApplyMode && line.discountApplyMode !== 'supplier')
    ) {
      setShowAdvanced(true)
    }
    scrollToElementId('purchase-line-form')

    if (line.lineType === 'product') {
      setActiveProduct(resolveProduct(line.productId) ?? null)
      setActivePart(null)
      lineForm.setFieldsValue({
        serialNumber: line.serialNumber,
        motorNumber: line.motorNumber || '',
        productId: line.productId ? String(line.productId) : undefined,
        colorId: line.colorId ? String(line.colorId) : undefined,
        purchasePrice: line.listPrice,
        netCost: line.purchasePrice,
        specialDiscount: line.specialDiscount,
        specialDiscountType: line.specialDiscountType,
        discountApplyMode: line.discountApplyMode || 'supplier',
        warrantyActive: line.warrantyActive,
        warrantyYears: line.warrantyYears
      })
    } else {
      setActivePart(resolvePart(line.partId) ?? null)
      setActiveProduct(null)
      lineForm.setFieldsValue({
        partId: line.partId ? String(line.partId) : undefined,
        quantity: line.quantity ?? 1,
        purchasePrice: line.listPrice,
        netCost: line.purchasePrice,
        specialDiscount: line.specialDiscount,
        specialDiscountType: line.specialDiscountType,
        discountApplyMode: line.discountApplyMode || 'supplier'
      })
    }
  }

  const cancelEditLine = () => {
    setEditingKey(null)
    resetLineForm()
  }

  const removeLine = (key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key || l.locked))
    if (editingKey === key) cancelEditLine()
  }

  const lockedCount = lines.filter((l) => l.locked).length
  const productLines = lines.filter((l) => l.lineType === 'product')

  const grossTotal = round2(lines.reduce((sum, l) => sum + l.listPrice * lineQty(l), 0))
  const netTotal = round2(lines.reduce((sum, l) => sum + l.purchasePrice * lineQty(l), 0))
  const discountAmount = round2(grossTotal - netTotal)
  const effectivePaid = isEdit
    ? recordedPaid
    : Math.max(0, Math.min(watchedPaidAmount, netTotal))
  const dueAmount = isEdit ? Math.max(0, netTotal - recordedPaid) : Math.max(0, netTotal - effectivePaid)

  const filteredLines = useMemo(() => {
    const term = cartSearch.trim().toLowerCase()
    if (!term) return lines
    return lines.filter((l) => {
      const hay = [
        l.serialNumber,
        l.motorNumber,
        l.productName,
        l.categoryName,
        l.colorName,
        l.lineType
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(term)
    })
  }, [lines, cartSearch])

  const focusChassisInput = () => {
    requestAnimationFrame(() => {
      document.getElementById('purchase-chassis-input')?.focus()
    })
  }

  useEffect(() => {
    if (isEdit) {
      headerForm.setFieldsValue({
        balance: Math.max(0, netTotal - recordedPaid)
      })
      return
    }
    const paid = Math.max(0, Math.min(Number(headerForm.getFieldValue('paidAmount') || 0), netTotal))
    headerForm.setFieldsValue({
      paidAmount: paid,
      balance: Math.max(0, netTotal - paid)
    })
  }, [netTotal, isEdit, recordedPaid, headerForm])

  const buildProductPayload = (header: any, paidAmount = 0) => ({
    supplierId: header.supplierId,
    purchaseDate: header.purchaseDate.format('YYYY-MM-DD'),
    notes: header.notes,
    specialDiscount: 0,
    specialDiscountType: 'pkr' as const,
    paidAmount,
    paymentMethod: header.paymentMethod || 'cash',
    lines: productLines.map((l) => ({
      ...(l.id ? { id: l.id } : {}),
      serialNumber: l.serialNumber,
      motorNumber: l.motorNumber,
      productId: l.productId,
      colorId: l.colorId,
      purchasePrice: l.purchasePrice,
      sellingPrice: l.listPrice,
      specialDiscount: l.specialDiscount,
      specialDiscountType: l.specialDiscountType,
      warrantyActive: l.warrantyActive,
      warrantyYears: l.warrantyYears
    }))
  })

  const buildPartPayload = (header: any, paidAmount = 0) => ({
    supplierId: header.supplierId,
    purchaseDate: header.purchaseDate.format('YYYY-MM-DD'),
    notes: header.notes || '',
    paidAmount,
    paymentMethod: header.paymentMethod || 'cash',
    lines: partLines.map((l) => ({
      unitCost: l.purchasePrice,
      unitSalePrice: l.listPrice,
      quantity: lineQty(l),
      partId: l.partId,
      specialDiscount: l.specialDiscount,
      specialDiscountType: l.specialDiscountType
    }))
  })

  const handlePaymentValuesChange = (changed: { paidAmount?: number }) => {
    if (!('paidAmount' in changed)) return
    const paid = Math.max(0, Math.min(Number(changed.paidAmount || 0), netTotal))
    headerForm.setFieldsValue({
      paidAmount: paid,
      balance: Math.max(0, netTotal - paid)
    })
  }

  const handleSubmit = async () => {
    if (!canMutate) {
      message.error(VIEW_ONLY_BRANCH_HINT)
      return
    }
    if (!lines.length) {
      message.error('Add at least one line')
      scrollToElementId('purchase-line-form')
      return
    }
    const invalidLine = lines.find((l) => retailBelowNet(l.listPrice, l.purchasePrice))
    if (invalidLine) {
      const label = invalidLine.lineType === 'part' ? invalidLine.productName : invalidLine.serialNumber
      message.error(`${label}: ${RETAIL_BELOW_NET_MSG}`)
      startEditLine(invalidLine)
      scrollToElementId('purchase-line-form')
      requestAnimationFrame(() => {
        focusFormFieldError(lineForm, 'purchasePrice', RETAIL_BELOW_NET_MSG)
      })
      return
    }
    let header: any
    try {
      header = await validateAndScroll(headerForm)
    } catch {
      return
    }
    setLoading(true)
    try {
      if (isEdit && id) {
        await purchaseAPI.update(id, companyId, branchId, audit(), buildProductPayload(header))
        message.success(`Purchase updated — ${lines.length} unit(s)`)
        navigate(App_Routes.PURCHASE_DETAIL.replace(':id', id))
        return
      }

      const productNet = round2(productLines.reduce((sum, l) => sum + l.purchasePrice * lineQty(l), 0))
      const partNet = round2(partLines.reduce((sum, l) => sum + l.purchasePrice * lineQty(l), 0))
      const totalPaid = Math.min(Math.max(0, Number(header.paidAmount || 0)), productNet + partNet)
      const productPaid = Math.min(totalPaid, productNet)
      const partPaid = Math.max(0, totalPaid - productPaid)

      const created: string[] = []
      if (productLines.length) {
        await purchaseAPI.create(
          companyId,
          branchId,
          audit(),
          buildProductPayload(header, productPaid)
        )
        created.push(`${productLines.length} product unit(s)`)
      }
      if (partLines.length) {
        await partPurchaseAPI.create(
          companyId,
          branchId,
          audit(),
          buildPartPayload(header, partPaid)
        )
        created.push(`${partLines.length} part line(s)`)
      }

      message.success(`Purchase saved — ${created.join(' · ')}`)
      setLines([])
      setEditingKey(null)
      setLineType('product')
      headerForm.resetFields()
      headerForm.setFieldsValue({
        purchaseDate: dayjs(),
        paidAmount: 0,
        paymentMethod: 'cash',
        balance: 0
      })
      resetLineForm()
      navigate(App_Routes.PURCHASE_LIST)
    } catch (err: any) {
      message.error(err.message || (isEdit ? 'Update failed' : 'Purchase failed'))
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
    ? `${lines.length} unit(s)${lockedCount > 0 ? ` · ${lockedCount} locked` : ''}`
    : `${productLines.length} product · ${partLines.length} part`

  return (
    <div className="flex flex-col gap-2 min-h-0" style={{ height: 'calc(100vh - 112px)' }}>
      <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {isEdit && (
            <Button
              type="text"
              size="small"
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate(App_Routes.PURCHASE_DETAIL.replace(':id', id!))}
            />
          )}
          <div className="min-w-0">
            <Text strong className="text-base">
              {isEdit ? 'Edit Purchase' : 'Add Purchase'}
            </Text>
            <div className="text-xs text-slate-500">{lineCountLabel}</div>
          </div>
        </div>
        <Space size="small" wrap>
          <Tag>{formatRs(netTotal)} net</Tag>
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
              name="supplierId"
              label="Supplier"
              className="!mb-1 col-span-2"
              rules={[{ required: true, message: 'Select supplier' }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="Select supplier"
                options={supplierOptions}
                onChange={handleSupplierChange}
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
            <Form.Item name="purchaseDate" label="Date" className="!mb-1" rules={[{ required: true }]}>
              <DatePicker className="w-full" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="Supplier disc." className="!mb-1">
              <Input
                size="small"
                value={
                  selectedSupplierId
                    ? formatSupplierDiscount(supplierDiscount, supplierDiscountType)
                    : '—'
                }
                disabled
              />
            </Form.Item>
            <Form.Item name="notes" label="Notes" className="!mb-1 col-span-2">
              <Input placeholder="Optional" />
            </Form.Item>
          </div>
        </Form>
      </Card>

      <Card
        id="purchase-line-form"
        size="small"
        bordered={false}
        className="shadow-sm shrink-0"
        title={
          <div className="flex flex-wrap items-center justify-between gap-2 py-0.5">
            <span className="text-sm font-semibold">
              {editingKey ? (activeLineType === 'part' ? 'Edit part' : 'Edit unit') : 'Add line'}
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
            warrantyActive: false,
            specialDiscount: 0,
            specialDiscountType: 'pkr',
            discountApplyMode: 'supplier',
            quantity: 1
          }}
        >
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-x-3 gap-y-0">
            {activeLineType === 'product' ? (
              <>
                <Form.Item
                  name="serialNumber"
                  label="Chassis"
                  className="!mb-2"
                  rules={[{ required: true, whitespace: true }]}
                >
                  <Input
                    id="purchase-chassis-input"
                    placeholder="Chassis number"
                    onPressEnter={(e) => {
                      e.preventDefault()
                      void addLine()
                    }}
                  />
                </Form.Item>
                <Form.Item name="motorNumber" label="Motor" className="!mb-2">
                  <Input placeholder="Optional" />
                </Form.Item>
                <Form.Item
                  name="productId"
                  label="Product"
                  className="!mb-2 col-span-2"
                  rules={[{ required: true, message: 'Select product' }]}
                  normalize={(v) => (v == null || v === '' ? v : String(v))}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    placeholder="Select product"
                    options={productOptions}
                    onChange={(id) => applyProductDefaults(String(id))}
                    dropdownRender={(menu) => (
                      <SelectQuickFooter
                        menu={menu}
                        addLabel="Add product"
                        onAdd={() => setProductQuickOpen(true)}
                      />
                    )}
                  />
                </Form.Item>
                <Form.Item name="colorId" label="Color" className="!mb-2">
                  <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder="Color"
                    options={colorOptions}
                    dropdownRender={(menu) => (
                      <SelectQuickFooter
                        menu={menu}
                        addLabel="Add color"
                        onAdd={() => setColorQuickOpen(true)}
                      />
                    )}
                  />
                </Form.Item>
              </>
            ) : (
              <>
                <Form.Item
                  name="partId"
                  label="Part"
                  className="!mb-2 col-span-2"
                  rules={[{ required: true, message: 'Select a part' }]}
                  normalize={(v) => (v == null || v === '' ? v : String(v))}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    placeholder="Select part"
                    options={partOptions}
                    onChange={(id) => applyPartDefaults(String(id))}
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
                    step={1}
                    precision={0}
                    style={{ width: '100%' }}
                    onPressEnter={(e) => {
                      e.preventDefault()
                      void addLine()
                    }}
                  />
                </Form.Item>
              </>
            )}
            <Form.Item name="purchasePrice" label="Retail" className="!mb-2" rules={[{ required: true }]}>
              <InputNumber className="w-full" min={0} style={{ width: '100%' }} />
            </Form.Item>            {showEditableNetCost && (
              <Form.Item
                name="netCost"
                label="Net cost"
                className="!mb-2"
                dependencies={['purchasePrice']}
                rules={[
                  { required: true, message: 'Enter net cost' },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      const retail = Number(getFieldValue('purchasePrice') || 0)
                      const net = Number(value || 0)
                      if (retailBelowNet(retail, net)) {
                        return Promise.reject(new Error(RETAIL_BELOW_NET_MSG))
                      }
                      return Promise.resolve()
                    }
                  })
                ]}
              >
                <InputNumber className="w-full" min={0} style={{ width: '100%' }} />
              </Form.Item>
            )}
            {showComputedNet && (
              <Form.Item label="Net cost" className="!mb-2">
                <Input value={formatRs(previewNetPrice)} disabled />
              </Form.Item>
            )}
            <Form.Item label="Category" className="!mb-2">
              <Input value={categoryPreview} disabled />
            </Form.Item>
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
              <Form.Item name="specialDiscountType" label="Disc. type" className="!mb-2">
                <Select options={[...SUPPLIER_DISCOUNT_TYPE_OPTIONS]} />
              </Form.Item>
              <Form.Item
                name="specialDiscount"
                label={lineSpecialDiscountType === 'percent' ? 'Special %' : 'Special PKR'}
                className="!mb-2"
                rules={[
                  { type: 'number', min: 0, message: 'Cannot be negative' },
                  ...(lineSpecialDiscountType === 'percent'
                    ? [{ type: 'number' as const, max: 100, message: 'Max 100' }]
                    : [])
                ]}
              >
                <InputNumber
                  className="w-full"
                  min={0}
                  max={lineSpecialDiscountType === 'percent' ? 100 : undefined}
                  style={{ width: '100%' }}
                />
              </Form.Item>
              {showDiscountApplyControl && (
                <Form.Item name="discountApplyMode" label="Apply" className="!mb-2">
                  <Select options={DISCOUNT_APPLY_OPTIONS} />
                </Form.Item>
              )}
              {activeLineType === 'product' && (
                <>
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
              )}
            </div>
          )}
        </Form>
      </Card>

      <Card
        size="small"
        bordered={false}
        className="shadow-sm flex-1 min-h-0 flex flex-col overflow-hidden"
        styles={{
          body: {
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            paddingTop: 8,
            overflow: 'hidden'
          }
        }}
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
        <div ref={cartBodyRef} className="flex-1 min-h-0 overflow-hidden">
        <Table
          rowKey="key"
          size="small"
          dataSource={filteredLines}
          pagination={false}
          virtual={filteredLines.length > 40}
          scroll={{ x: 900, y: tableHeight }}
          className="[&_.ant-table-cell]:!whitespace-nowrap [&_.ant-table-cell]:!py-1.5"
          locale={{ emptyText: cartSearch.trim() ? 'No matching lines' : 'No lines yet — add above' }}
          columns={[
            ...(!isEdit
              ? [
                  {
                    title: '',
                    dataIndex: 'lineType',
                    width: 56,
                    render: (v: LineType) => (
                      <Tag className="!m-0" color={v === 'part' ? 'blue' : 'default'}>
                        {v === 'part' ? 'P' : 'U'}
                      </Tag>
                    )
                  }
                ]
              : []),
            {
              title: isEdit ? 'Chassis' : 'Chassis / Qty',
              width: 190,
              render: (_: unknown, r: CartLine) =>
                r.lineType === 'product' ? (
                  <Text strong className="text-xs whitespace-nowrap">
                    {r.serialNumber}
                  </Text>
                ) : (
                  <Text strong className="text-xs">
                    ×{r.quantity ?? 1}
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
              render: (v: string | undefined, r: CartLine) =>
                r.lineType === 'product' ? <span className="text-xs">{v || '—'}</span> : '—'
            },
            {
              title: 'Retail',
              dataIndex: 'listPrice',
              width: 100,
              align: 'right' as const,
              render: (v: number) => <span className="text-xs">{formatRs(v)}</span>
            },
            {
              title: 'Net',
              dataIndex: 'purchasePrice',
              width: 100,
              align: 'right' as const,
              render: (v: number, r: CartLine) => (
                <Tooltip
                  title={
                    r.specialDiscount > 0
                      ? `Special: ${formatSupplierDiscount(r.specialDiscount, r.specialDiscountType)}`
                      : undefined
                  }
                >
                  <span className="text-xs font-medium">{formatRs(v)}</span>
                </Tooltip>
              )
            },
            {
              title: 'Warr.',
              width: 72,
              render: (_: unknown, r: CartLine) =>
                r.lineType === 'product' ? (
                  <span className="text-xs">
                    {r.warrantyActive ? `${r.warrantyYears || '—'}y` : '—'}
                  </span>
                ) : (
                  '—'
                )
            },
            ...(isEdit
              ? [
                  {
                    title: 'Status',
                    width: 96,
                    dataIndex: 'status',
                    render: (v: string | undefined, r: CartLine) =>
                      r.locked ? (
                        <Tag className="!m-0" color={STATUS_COLORS[v || ''] || 'default'}>
                          {(v || 'locked').replace(/_/g, ' ')}
                        </Tag>
                      ) : (
                        <Tag className="!m-0" color="green">
                          in stock
                        </Tag>
                      )
                  }
                ]
              : []),
            {
              title: '',
              width: 72,
              fixed: 'right' as const,
              render: (_: unknown, r: CartLine) =>
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
        </div>
      </Card>

      <div className="shrink-0 border border-slate-200 rounded-lg bg-white px-3 py-2 shadow-sm">
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
                      if (Number(value || 0) > netTotal) {
                        return Promise.reject(new Error('Exceeds net'))
                      }
                      return Promise.resolve()
                    }
                  }
                ]}
              >
                <InputNumber
                  min={0}
                  max={netTotal > 0 ? netTotal : undefined}
                  style={{ width: 110 }}
                />
              </Form.Item>
            )}
            <Form.Item name="balance" label="Due" className="!mb-0" initialValue={0}>
              <InputNumber disabled style={{ width: 110 }} />
            </Form.Item>
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
              {discountAmount > 0 && <span className="mr-3">Disc −{formatRs(discountAmount)}</span>}
              <span className="font-semibold text-slate-900">Net {formatRs(netTotal)}</span>
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
                  }}
                >
                  Clear
                </Button>
              )}
              {isEdit && (
                <Button
                  size="small"
                  onClick={() => navigate(App_Routes.PURCHASE_DETAIL.replace(':id', id!))}
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
                {isEdit ? 'Update' : 'Save purchase'}
              </Button>
            </Space>
          </div>
        </div>
      </div>

      <SupplierQuickModal
        open={supplierQuickOpen}
        editing={supplierQuickEditing}
        onCancel={() => {
          setSupplierQuickOpen(false)
          setSupplierQuickEditing(null)
        }}
        onSaved={handleSupplierQuickSaved}
      />
      <ProductQuickModal
        open={productQuickOpen}
        onCancel={() => setProductQuickOpen(false)}
        onSaved={handleProductQuickSaved}
      />
      <ColorQuickModal
        open={colorQuickOpen}
        onCancel={() => setColorQuickOpen(false)}
        onSaved={handleColorQuickSaved}
      />
    </div>
  )
}

export default AddPurchase
