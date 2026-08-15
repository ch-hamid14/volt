import type { ReactNode } from 'react'
import { Button, Divider, Space } from 'antd'
import { EditOutlined, PlusOutlined } from '@ant-design/icons'

type Props = {
  menu: ReactNode
  addLabel: string
  onAdd: () => void
  editLabel?: string
  onEdit?: () => void
  canEdit?: boolean
  canAdd?: boolean
}

/** Ant Design Select popup footer with Add / optional Edit. */
export function SelectQuickFooter({
  menu,
  addLabel,
  onAdd,
  editLabel = 'Edit',
  onEdit,
  canEdit = false,
  canAdd = true
}: Props) {
  return (
    <>
      {menu}
      <Divider style={{ margin: '8px 0' }} />
      <Space style={{ padding: '0 8px 8px', width: '100%' }} wrap>
        {canAdd ? (
          <Button
            type="link"
            size="small"
            icon={<PlusOutlined />}
            style={{ paddingInline: 0 }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onAdd}
          >
            {addLabel}
          </Button>
        ) : null}
        {canEdit && onEdit ? (
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            style={{ paddingInline: 0 }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onEdit}
          >
            {editLabel}
          </Button>
        ) : null}
      </Space>
    </>
  )
}
