import { prisma } from "./db";

export async function getEventConfig() {
  return prisma.eventConfig.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });
}
