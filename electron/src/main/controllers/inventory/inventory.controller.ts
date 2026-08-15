import { IRequest } from '../../../common'
import { inventoryService } from '../../services'
import { auditFromMutatingRequest } from '../shared/audit'

class InventoryController {
  async list(_: Electron.IpcMainInvokeEvent, req: IRequest) {
    const q = req.query || {}
    return inventoryService.listItems(q.companyId as string, q.branchId as string, {
      status: q.status as string,
      search: q.search as string,
      productId: q.productId as string,
      categoryId: q.categoryId as string,
      colorId: q.colorId as string,
      supplierId: q.supplierId as string,
      fromDate: q.fromDate as string,
      toDate: q.toDate as string,
      page: q.page ? Number(q.page) : undefined,
      pageSize: q.pageSize ? Number(q.pageSize) : undefined
    })
  }

  async search(_: Electron.IpcMainInvokeEvent, req: IRequest) {
    return inventoryService.searchAvailable(
      req.query?.companyId as string,
      req.query?.branchId as string,
      req.query?.query as string
    )
  }

  async detail(_: Electron.IpcMainInvokeEvent, req: IRequest) {
    return inventoryService.getItemDetail(req.params?.id as string)
  }

  async transfer(_: Electron.IpcMainInvokeEvent, req: IRequest) {
    return inventoryService.transfer(
      req.body?.companyId as string,
      auditFromMutatingRequest(req),
      req.body?.payload as { fromBranchId: string; toBranchId: string; productItemIds: string[] }
    )
  }

  async adjust(_: Electron.IpcMainInvokeEvent, req: IRequest) {
    return inventoryService.adjust(
      req.body?.companyId as string,
      auditFromMutatingRequest(req),
      req.body?.payload as { branchId: string; productItemIds: string[]; status: string; notes?: string }
    )
  }
}

export const inventoryController = new InventoryController()
