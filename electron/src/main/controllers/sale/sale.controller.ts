import { IRequest } from '../../../common'
import { saleService } from '../../services'
import type { CreateSalePayload, RecordPaymentPayload, UpdatePaymentPayload, UpdateSalePayload } from '../../services/sale/sale.service'
import { auditFromListQuery, auditFromMutatingRequest } from '../shared/audit'

class SaleController {
  async list(_: Electron.IpcMainInvokeEvent, req: IRequest) {
    return saleService.list(
      req.query?.companyId as string,
      req.query?.branchId as string,
      auditFromListQuery(req),
      {
        customerId: req.query?.customerId as string,
        fromDate: req.query?.fromDate as string,
        toDate: req.query?.toDate as string,
        billNo: req.query?.billNo as string,
        search: req.query?.search as string,
        sortField: req.query?.sortField as string,
        sortOrder: req.query?.sortOrder as string
      }
    )
  }

  async create(_: Electron.IpcMainInvokeEvent, req: IRequest) {
    return saleService.create(
      req.body?.companyId as string,
      req.body?.branchId as string,
      auditFromMutatingRequest(req),
      req.body?.payload as CreateSalePayload
    )
  }

  async get(_: Electron.IpcMainInvokeEvent, req: IRequest) {
    return saleService.get(req.params?.id as string)
  }

  async listDue(_: Electron.IpcMainInvokeEvent, req: IRequest) {
    return saleService.listDue(
      req.query?.companyId as string,
      req.query?.branchId as string,
      auditFromListQuery(req)
    )
  }

  async recordPayment(_: Electron.IpcMainInvokeEvent, req: IRequest) {
    return saleService.recordPayment(
      req.body?.companyId as string,
      auditFromMutatingRequest(req),
      req.body?.payload as RecordPaymentPayload
    )
  }

  async updatePayment(_: Electron.IpcMainInvokeEvent, req: IRequest) {
    const payload = (req.body?.payload || {}) as UpdatePaymentPayload
    return saleService.updatePayment(req.body?.companyId as string, auditFromMutatingRequest(req), {
      ...payload,
      paymentId: (req.params?.id as string) || payload.paymentId
    })
  }

  async update(_: Electron.IpcMainInvokeEvent, req: IRequest) {
    return saleService.update(
      req.params?.id as string,
      req.body?.companyId as string,
      req.body?.branchId as string,
      auditFromMutatingRequest(req),
      req.body?.payload as UpdateSalePayload
    )
  }
}

export const saleController = new SaleController()
