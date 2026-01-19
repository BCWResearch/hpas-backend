import { PartnerUserRole } from "@prisma/client";

export function checkRole(
  userRole: PartnerUserRole,
  accessibleRoles: PartnerUserRole[],
): boolean {
  return accessibleRoles.includes(userRole);
}