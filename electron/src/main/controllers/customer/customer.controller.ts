import { IRequest } from '../../../common'
import { customerService } from '../../services'
import { auditFromMutatingRequest } from '../shared/audit'

class CustomerController {
  async list(_: Electron.IpcMainInvokeEvent, req: IRequest) {
    return customerService.list(
      req.query?.companyId as string,
      req.query?.search as string,
      req.query?.sortField as string,
      req.query?.sortOrder as string,
      req.query?.dueFilter as string
    )
  }

  async create(_: Electron.IpcMainInvokeEvent, req: IRequest) {
    return customerService.create(
      req.body?.companyId as string,
      auditFromMutatingRequest(req),
      req.body?.data as {
        name: string
        phone?: string
        cnic?: string
        address?: string
        openingBalance?: number
      }
    )
  }

  async update(_: Electron.IpcMainInvokeEvent, req: IRequest) {
    return customerService.update(
      req.params?.id as string,
      req.body?.companyId as string,
      auditFromMutatingRequest(req),
      req.body?.data as { name?: string; phone?: string; cnic?: string; address?: string }
    )
  }

  async remove(_: Electron.IpcMainInvokeEvent, req: IRequest) {
    await customerService.remove(
      req.params?.id as string,
      req.body?.companyId as string,
      auditFromMutatingRequest(req)
    )
    return { success: true }
  }

  async ledger(_: Electron.IpcMainInvokeEvent, req: IRequest) {
    return customerService.ledger(req.params?.id as string)
  }
}

export const customerController = new CustomerController()
