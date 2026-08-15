export enum Roles {
  SUPER_ADMIN = 'super_admin',
  COMPANY_OWNER = 'company_owner',
  BRANCH_ADMIN = 'branch_admin',
  STAFF = 'staff',
  SYSTEM_ADMIN = 'system_admin',
  ANY = 'any'
}

export enum Permissions {
  SALES = 'sales',
  INVENTORY = 'inventory',
  REPORTS = 'reports',
  CUSTOMERS = 'customers',
  FINANCE = 'finance',
  ADMINISTRATION = 'administration',
  SYSTEM = 'system'
}

export function canSwitchBranch(role?: string | null): boolean {
  return role === Roles.COMPANY_OWNER || role === Roles.SUPER_ADMIN
}

export const VIEW_ONLY_BRANCH_HINT =
  'Switch back to your assigned branch to make changes'
