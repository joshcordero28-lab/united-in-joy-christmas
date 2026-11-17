-- Human-readable booking references and per-attendee ticket numbers.
-- Non-destructive: backfills existing RegistrationParty / Attendee rows.
-- Does NOT change ticketToken, managerToken, check-in, or voting data.

ALTER TABLE "RegistrationParty" ADD COLUMN "bookingRef" TEXT;
ALTER TABLE "Attendee" ADD COLUMN "ticketNumber" TEXT;

-- Assign sequential booking refs in creation order (stable, no orphaning).
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, id ASC) AS n
  FROM "RegistrationParty"
)
UPDATE "RegistrationParty" p
SET "bookingRef" = 'UIJ2026-' || LPAD(numbered.n::text, 5, '0')
FROM numbered
WHERE p.id = numbered.id
  AND p."bookingRef" IS NULL;

-- Ticket numbers: bookingRef + order within the same party (registeredAt, id).
WITH numbered AS (
  SELECT
    a.id,
    p."bookingRef",
    ROW_NUMBER() OVER (
      PARTITION BY a."registrationPartyId"
      ORDER BY a."registeredAt" ASC, a.id ASC
    ) AS n
  FROM "Attendee" a
  INNER JOIN "RegistrationParty" p ON p.id = a."registrationPartyId"
)
UPDATE "Attendee" a
SET "ticketNumber" = numbered."bookingRef" || '-' || LPAD(numbered.n::text, 2, '0')
FROM numbered
WHERE a.id = numbered.id
  AND a."ticketNumber" IS NULL;

-- Fail closed if anything was missed (should not happen).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "RegistrationParty" WHERE "bookingRef" IS NULL) THEN
    RAISE EXCEPTION 'bookingRef backfill incomplete';
  END IF;
  IF EXISTS (SELECT 1 FROM "Attendee" WHERE "ticketNumber" IS NULL) THEN
    RAISE EXCEPTION 'ticketNumber backfill incomplete';
  END IF;
END $$;

ALTER TABLE "RegistrationParty" ALTER COLUMN "bookingRef" SET NOT NULL;
ALTER TABLE "Attendee" ALTER COLUMN "ticketNumber" SET NOT NULL;

CREATE UNIQUE INDEX "RegistrationParty_bookingRef_key" ON "RegistrationParty"("bookingRef");
CREATE UNIQUE INDEX "Attendee_ticketNumber_key" ON "Attendee"("ticketNumber");
