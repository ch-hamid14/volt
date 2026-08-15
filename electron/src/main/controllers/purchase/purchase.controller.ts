import { IRequest } from '../../../common'
import { purchaseService } from '../../services'
import { auditFromListQuery, auditFromMutatingRequest } from '../shared/audit'

class PurchaseController {
  async list(_: Electron.IpcMainInvokeEvent, req: IRequest) {
    return purchaseService.list(
      req.query?.companyId as string,
      req.query?.branchId as string,
      auditFromListQuery(req),
      {
        supplierId: req.query?.supplierId as string,
        search: req.query?.search as string,
        fromDate: req.query?.fromDate as string,
        toDate: req.query?.toDate as string,
        sortField: req.query?.sortField as string,
        sortOrder: req.query?.sortOrder as string
      }
    )
  }

  async create(_: Electron.IpcMainInvokeEvent, req: IRequest) {
    return purchaseService.create(
      req.body?.companyId as string,
      req.body?.branchId as string,
      auditFromMutatingRequest(req),
      req.body?.payload as any
    )
  }

  async get(_: Electron.IpcMainInvokeEvent, req: IRequest) {
    return purchaseService.get(req.params?.id as string)
  }

  async update(_: Electron.IpcMainInvokeEvent, req: IRequest) {
    return purchaseService.update(
      req.params?.id as string,
      req.body?.companyId as string,
      req.body?.branchId as string,
      auditFromMutatingRequest(req),
      req.body?.payload as any
    )
  }

  async listDue(_: Electron.IpcMainInvokeEvent, req: IRequest) {
    return purchaseService.listDue(
      req.query?.companyId as string,
      req.query?.branchId as string,
      auditFromListQuery(req)
    )
  }

  async recordPayment(_: Electron.IpcMainInvokeEvent, req: IRequest) {
    return purchaseService.recordPayment(
      req.body?.companyId as string,
      auditFromMutatingRequest(req),
      req.body?.payload as any
    )
  }

  async updatePayment(_: Electron.IpcMainInvokeEvent, req: IRequest) {
    const payload = (req.body?.payload || {}) as {
      paymentId?: string
      amount: number
      method?: string
      paymentDate?: string
    }
    return purchaseService.updatePayment(req.body?.companyId as string, auditFromMutatingRequest(req), {
      ...payload,
      paymentId: (req.params?.id as string) || payload.paymentId || ''
    })
  }
}

export const purchaseController = new PurchaseController()
