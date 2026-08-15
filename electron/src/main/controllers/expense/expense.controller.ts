import { IRequest } from '../../../common'
import { expenseService } from '../../services'
import type { CreateExpensePayload } from '../../services/expense/expense.service'
import { auditFromListQuery, auditFromMutatingRequest, auditFromRequest } from '../shared/audit'

class ExpenseController {
  async list(_: Electron.IpcMainInvokeEvent, req: IRequest) {
    return expenseService.list(
      req.query?.companyId as string,
      req.query?.branchId as string,
      req.query?.from as string,
      req.query?.to as string,
      auditFromListQuery(req)
    )
  }

  async create(_: Electron.IpcMainInvokeEvent, req: IRequest) {
    return expenseService.create(
      req.body?.companyId as string,
      req.body?.branchId as string,
      auditFromMutatingRequest(req),
      req.body?.payload as CreateExpensePayload
    )
  }

  async remove(_: Electron.IpcMainInvokeEvent, req: IRequest) {
    return expenseService.remove(
      req.params?.id as string,
      req.body?.companyId as string,
      auditFromMutatingRequest(req)
    )
  }

  async categories(_: Electron.IpcMainInvokeEvent, req: IRequest) {
    return expenseService.categories(req.query?.companyId as string)
  }

  async createCategory(_: Electron.IpcMainInvokeEvent, req: IRequest) {
    return expenseService.createCategory(
      req.body?.companyId as string,
      req.body?.name as string,
      auditFromRequest(req)
    )
  }

  async updateCategory(_: Electron.IpcMainInvokeEvent, req: IRequest) {
    return expenseService.updateCategory(
      req.params?.id as string,
      req.body?.companyId as string,
      req.body?.name as string
    )
  }

  async removeCategory(_: Electron.IpcMainInvokeEvent, req: IRequest) {
    return expenseService.removeCategory(
      req.params?.id as string,
      req.body?.companyId as string,
      auditFromRequest(req)
    )
  }
}

export const expenseController = new ExpenseController()
