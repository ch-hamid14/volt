import { IRequest } from '../../../common'
import { parseAuditFromBody, parseAuditFromQuery, assertAssignedBranchWrite } from '../../services/shared/audit.helpers'

export { parseAuditFromBody, parseAuditFromQuery, assertAssignedBranchWrite }

export function auditFromRequest(req: IRequest) {
  return parseAuditFromBody(req.body as Record<string, unknown>)
}

export function auditFromMutatingRequest(req: IRequest) {
  return assertAssignedBranchWrite(auditFromRequest(req))
}

export function auditFromListQuery(req: IRequest) {
  return parseAuditFromQuery(req.query as Record<string, unknown>)
}
