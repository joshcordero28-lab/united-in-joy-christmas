import { TicketStatus, type Prisma } from "@prisma/client";
import { prisma } from "./db";

/** Active seats that count toward capacity (excludes revoked / soft-removed). */
export const ACTIVE_ATTENDEE_STATUSES: TicketStatus[] = [
  TicketStatus.ISSUED,
  TicketStatus.PENDING,
];

export type CapacitySnapshot = {
  count: number;
  capacity: number;
  remaining: number;
  full: boolean;
};

type DbClient = Prisma.TransactionClient | typeof prisma;

const CACHE_TTL_MS = 5_000;

let cached: { at: number; value: CapacitySnapshot } | null = null;

export function invalidateCapacityCache() {
  cached = null;
}

export async function countActiveAttendees(db: DbClient = prisma): Promise<number> {
  return db.attendee.count({
    where: { status: { in: ACTIVE_ATTENDEE_STATUSES } },
  });
}

export async function getEventCapacity(db: DbClient = prisma): Promise<number> {
  const cfg = await db.eventConfig.findUnique({
    where: { id: "default" },
    select: { capacity: true },
  });
  return cfg?.capacity ?? 120;
}

export async function getCapacitySnapshot(options?: {
  bypassCache?: boolean;
}): Promise<CapacitySnapshot> {
  const now = Date.now();
  if (!options?.bypassCache && cached && now - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }

  const [count, capacity] = await Promise.all([
    countActiveAttendees(),
    getEventCapacity(),
  ]);
  const remaining = Math.max(0, capacity - count);
  const value: CapacitySnapshot = {
    count,
    capacity,
    remaining,
    full: remaining === 0,
  };
  cached = { at: now, value };
  return value;
}

/**
 * Race-safe capacity gate: caller must already hold a row lock on EventConfig
 * (e.g. `SELECT … FOR UPDATE`) inside the same transaction.
 */
export async function assertRegistrationFitsCapacity(
  tx: Prisma.TransactionClient,
  seatsNeeded: number,
): Promise<void> {
  const capacity = await getEventCapacity(tx);
  const issuedCount = await countActiveAttendees(tx);
  if (issuedCount + seatsNeeded > capacity) {
    throw Object.assign(
      new Error(
        `Not enough capacity for ${seatsNeeded} attendee(s). ${Math.max(0, capacity - issuedCount)} spot(s) left.`,
      ),
      { status: 403 },
    );
  }
}
