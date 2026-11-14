import { prisma } from "./db";

export async function writeAudit(params: {
  actorId?: string | null;
  actorLabel?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  detail?: string;
}) {
  await prisma.auditLog.create({
    data: {
      actorId: params.actorId ?? null,
      actorLabel: params.actorLabel ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      detail: params.detail,
    },
  });
}
