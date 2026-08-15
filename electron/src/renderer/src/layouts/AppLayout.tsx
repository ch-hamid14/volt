import { useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Alert, Avatar, Button, Dropdown, Layout, Menu, MenuProps, Typography, theme } from 'antd'
import { App_Routes, Menus } from '@/common'
import { AiOutlineLogout } from 'react-icons/ai'
import { GoChevronDown } from 'react-icons/go'
import { RiMenuFoldLine, RiMenuUnfoldLine } from 'react-icons/ri'
import './app-layout.scss'
import { useSession } from '@/renderer/hooks/useSession'
import { useConnectivityGuard } from '@/renderer/hooks/useConnectivityGuard'
import { BranchSwitcher } from '@/renderer/components/BranchSwitcher'
import logoFull from '@/renderer/assets/logo-full-light.png'
import logoMark from '@/renderer/assets/logo-mark.png'

const { Sider, Content, Header } = Layout
const { Text } = Typography

function parentMenuKey(pathname: string): string | undefined {
  for (const menu of Menus) {
    if (menu.children?.some((child) => child.key === pathname)) return menu.key
  }
  return undefined
}

function pageTitle(pathname: string): string {
  if (pathname.match(/^\/inventory\/purchases\/[^/]+\/edit$/)) {
    return 'Edit Purchase'
  }
  if (pathname.startsWith('/inventory/purchases/') && pathname !== App_Routes.PURCHASE_LIST) {
    return 'Purchase Detail'
  }
  if (pathname.match(/^\/sales\/[^/]+\/edit$/)) {
    return 'Edit Sale'
  }
  if (pathname.startsWith('/sales/') && pathname !== App_Routes.SALES_LIST && pathname !== App_Routes.NEW_SALE && pathname !== App_Routes.DUE_SALES) {
    return 'Sale Detail'
  }
  if (pathname.startsWith('/reports/customers/') && pathname !== App_Routes.CUSTOMER_REPORTS) {
    return 'Customer Detail'
  }
  if (pathname.startsWith('/reports/suppliers/') && pathname !== App_Routes.SUPPLIER_REPORTS) {
    return 'Supplier Detail'
  }
  for (const menu of Menus) {
    if (menu.key === pathname) return menu.label
    const child = menu.children?.find((c) => c.key === pathname)
    if (child) return child.label
  }
  return 'Dashboard'
}

const AppLayout = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { token: themeToken } = theme.useToken()
  const { user, branchName } = useSession()
  const { reauthGrace, remainLabel, signInNow } = useConnectivityGuard()
  const [collapsed, setCollapsed] = useState(false)
  const [openKeys, setOpenKeys] = useState<string[]>([])

  useEffect(() => {
    if (!user) navigate(App_Routes.LOGIN)
  }, [user, navigate])

  useEffect(() => {
    const parent = parentMenuKey(location.pathname)
    if (parent) setOpenKeys([parent])
  }, [location.pathname])

  const rootSubmenuKeys = useMemo(
    () => Menus.filter((m) => m.children).map((m) => m.key),
    []
  )

  const handleOpenChange: MenuProps['onOpenChange'] = (keys) => {
    const latestOpenKey = keys.find((key) => !openKeys.includes(key))
    if (latestOpenKey && rootSubmenuKeys.includes(latestOpenKey)) {
      setOpenKeys([latestOpenKey])
    } else {
      setOpenKeys(keys)
    }
  }

  const menuItems: MenuProps['items'] = useMemo(
    () =>
      Menus.filter((m) => m.roles.includes(user!.role)).map((m) => {
        if (m.children) {
          return {
            key: m.key,
            icon: m.icon,
            label: m.label,
            children: m.children
              .filter((c) => c.roles.includes(user!.role))
              .map((c) => ({ key: c.key, label: c.label }))
          }
        }
        return { key: m.key, icon: m.icon, label: m.label }
      }),
    [user]
  )

  const dropdownItems: MenuProps['items'] = [
    { key: App_Routes.LOGOUT, icon: <AiOutlineLogout size={16} />, label: 'Logout', danger: true }
  ]

  if (!user) return null

  const currentTitle = pageTitle(location.pathname)

  return (
    <Layout className="app-layout">
      <Sider
        className="app-sider"
        collapsed={collapsed}
        width={248}
        collapsedWidth={72}
        theme="dark"
      >
        <div className="app-sider-brand">
          {!collapsed ? (
            <div className="app-sider-brand-text">
              <img className="app-sider-logo-full" src={logoFull} alt="VOLT POS" />
              {branchName && <Text className="app-sider-branch">{branchName}</Text>}
            </div>
          ) : (
            <img className="app-sider-mark" src={logoMark} alt="VOLT POS" />
          )}
        </div>

        <Menu
          className="app-menu"
          mode="inline"
          theme="dark"
          selectedKeys={[location.pathname]}
          openKeys={collapsed ? [] : openKeys}
          onOpenChange={handleOpenChange}
          items={menuItems}
          onClick={(info) => navigate(info.key)}
        />

        <div className="app-sider-footer">
          {!collapsed ? (
            <Text className="app-copyright cursor-pointer" onClick={() => window.open('https://madixsoft.com', '_blank')}>Copyright © Madix Soft</Text>
          ) : (
            <Text className="app-copyright app-copyright--collapsed">©</Text>
          )}
        </div>
      </Sider>

      <Layout className="app-main">
        <Header className="app-header" style={{ background: themeToken.colorBgContainer }}>
          <div className="app-header-left">
            <Button
              type="text"
              className="app-collapse-btn"
              icon={collapsed ? <RiMenuUnfoldLine size={18} /> : <RiMenuFoldLine size={18} />}
              onClick={() => setCollapsed(!collapsed)}
            />
            <div className="app-header-titles">
              <Text type="secondary" className="app-header-eyebrow">VOLT POS</Text>
              <Text strong className="app-header-page">{currentTitle}</Text>
            </div>
          </div>

          <div className="app-header-right">
            {reauthGrace && (
              <div className="app-reauth-banner">
                <Alert
                  type="warning"
                  showIcon
                  banner
                  message={
                    <span className="app-reauth-msg">
                      {reauthGrace.reason}
                      {remainLabel ? (
                        <strong className="app-reauth-timer"> {remainLabel}</strong>
                      ) : null}
                    </span>
                  }
                  action={
                    <Button size="small" type="primary" onClick={signInNow}>
                      Sign in now
                    </Button>
                  }
                />
              </div>
            )}
            <BranchSwitcher />
            <Dropdown menu={{ items: dropdownItems, onClick: (i) => navigate(i.key) }}>
              <button type="button" className="app-user-menu">
                <Avatar size={36} className="app-user-avatar">{user.firstName[0]}</Avatar>
                <div className="app-user-meta">
                  <Text strong className="app-user-name">{user.firstName} {user.lastName}</Text>
                  <Text type="secondary" className="app-user-role">{user.role?.replace(/_/g, ' ')}</Text>
                </div>
                <GoChevronDown className="app-user-chevron" />
              </button>
            </Dropdown>
          </div>
        </Header>

        <Content className="app-content">
          <div className="app-page">
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  )
}

export default AppLayout
