import { IRequest } from '../../../common'
import { dashboardService } from '../../services'

class DashboardController {
  async metrics(_: Electron.IpcMainInvokeEvent, req: IRequest) {
    const q = req.query || {}
    return dashboardService.getAnalytics((q.companyId as string) || '', (q.branchId as string) || undefined, {
      from: q.from as string,
      to: q.to as string,
      supplierId: q.supplierId as string,
      productId: q.productId as string,
      partId: q.partId as string
    })
  }
}

export const dashboardController = new DashboardController()
