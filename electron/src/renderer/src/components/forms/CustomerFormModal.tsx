import { useEffect, useState } from 'react'
import { Button, Form, Input, InputNumber, Modal, message } from 'antd'
import { VIEW_ONLY_BRANCH_HINT } from '@/common'
import { customerAPI } from '@/renderer/services'
import { useSession } from '@/renderer/hooks/useSession'

export type CustomerRecord = {
  id: string
  name?: string
  phone?: string
  cnic?: string
  address?: string
  balance?: number
}

type Props = {
  open: boolean
  editing?: CustomerRecord | null
  onCancel: () => void
  onSaved: (customer: CustomerRecord) => void
}

function asCustomer(row: any): CustomerRecord {
  return {
    id: String(row.id),
    name: row.name,
    phone: row.phone,
    cnic: row.cnic,
    address: row.address,
    balance: row.balance != null ? Number(row.balance) : undefined
  }
}

/** Shared add/edit customer modal (Customers page + sale quick actions). */
export function CustomerFormModal({ open, editing, onCancel, onSaved }: Props) {
  const { companyId, audit, canMutate } = useSession()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const isEdit = Boolean(editing?.id)

  useEffect(() => {
    if (!open) return
    if (editing?.id) {
      form.setFieldsValue({
        name: editing.name,
        phone: editing.phone,
        cnic: editing.cnic,
        address: editing.address
      })
    } else {
      form.resetFields()
      form.setFieldsValue({ openingBalance: 0 })
    }
  }, [open, editing, form])

  const handleSubmit = async (values: {
    name: string
    phone?: string
    cnic?: string
    address?: string
    openingBalance?: number
  }) => {
    if (!companyId) return
    if (!canMutate) {
      message.error(VIEW_ONLY_BRANCH_HINT)
      return
    }
    setLoading(true)
    try {
      if (isEdit && editing) {
        const updated = await customerAPI.update(editing.id, companyId, audit(), {
          name: values.name,
          phone: values.phone,
          cnic: values.cnic,
          address: values.address
        })
        message.success('Customer updated')
        onSaved(asCustomer(updated || { ...editing, ...values }))
      } else {
        const created = await customerAPI.create(companyId, audit(), {
          name: values.name,
          phone: values.phone,
          cnic: values.cnic,
          address: values.address,
          openingBalance: values.openingBalance ?? 0
        })
        message.success('Customer created')
        onSaved(asCustomer(created))
      }
      form.resetFields()
    } catch (err: any) {
      message.error(err.message || 'Operation failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      title={isEdit ? 'Edit Customer' : 'Add Customer'}
      open={open}
      onCancel={onCancel}
      footer={null}
      destroyOnClose
      width={440}
    >
      <Form form={form} layout="vertical" onFinish={handleSubmit}>
        <Form.Item name="name" label="Name" rules={[{ required: true, whitespace: true }]}>
          <Input autoFocus />
        </Form.Item>
        <Form.Item name="phone" label="Phone">
          <Input />
        </Form.Item>
        <Form.Item name="cnic" label="CNIC">
          <Input placeholder="Optional" />
        </Form.Item>
        <Form.Item name="address" label="Address">
          <Input.TextArea rows={2} />
        </Form.Item>
        {!isEdit ? (
          <Form.Item
            name="openingBalance"
            label="Opening Balance"
            extra="Amount the customer already owes you (default 0)."
          >
            <InputNumber className="w-full" min={0} style={{ width: '100%' }} />
          </Form.Item>
        ) : null}
        <Button type="primary" htmlType="submit" block loading={loading} disabled={!canMutate}>
          {isEdit ? 'Save' : 'Create'}
        </Button>
      </Form>
    </Modal>
  )
}
