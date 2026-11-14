-- CreateEnum
CREATE TYPE "VoteCastBy" AS ENUM ('SELF', 'MANAGER');

-- CreateTable
CREATE TABLE "RegistrationParty" (
    "id" TEXT NOT NULL,
    "managerName" TEXT NOT NULL,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "notes" TEXT,
    "managerToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistrationParty_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationParty_managerToken_key" ON "RegistrationParty"("managerToken");

-- CreateIndex
CREATE INDEX "RegistrationParty_createdAt_idx" ON "RegistrationParty"("createdAt");

-- AlterTable Attendee
ALTER TABLE "Attendee" ADD COLUMN "registrationPartyId" TEXT;

-- AlterTable AudienceVote
ALTER TABLE "AudienceVote" ADD COLUMN "castBy" "VoteCastBy" NOT NULL DEFAULT 'SELF';
ALTER TABLE "AudienceVote" ADD COLUMN "castByPartyId" TEXT;

-- CreateIndex
CREATE INDEX "Attendee_registrationPartyId_idx" ON "Attendee"("registrationPartyId");

-- CreateIndex
CREATE INDEX "AudienceVote_castByPartyId_idx" ON "AudienceVote"("castByPartyId");

-- Backfill: each existing attendee becomes a solo registration party
INSERT INTO "RegistrationParty" ("id", "managerName", "contactPhone", "contactEmail", "notes", "managerToken", "createdAt", "updatedAt")
SELECT
  'party_' || a."id",
  a."fullName",
  a."phone",
  a."email",
  a."notes",
  -- Opaque manager token distinct from ticket (never equal to ticketToken)
  'mgr_' || a."id" || '_' || left(a."ticketToken", 48),
  a."registeredAt",
  CURRENT_TIMESTAMP
FROM "Attendee" a
WHERE a."registrationPartyId" IS NULL;

UPDATE "Attendee" a
SET "registrationPartyId" = 'party_' || a."id"
WHERE a."registrationPartyId" IS NULL;

-- Require party membership going forward
ALTER TABLE "Attendee" ALTER COLUMN "registrationPartyId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Attendee" ADD CONSTRAINT "Attendee_registrationPartyId_fkey" FOREIGN KEY ("registrationPartyId") REFERENCES "RegistrationParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AudienceVote" ADD CONSTRAINT "AudienceVote_castByPartyId_fkey" FOREIGN KEY ("castByPartyId") REFERENCES "RegistrationParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
