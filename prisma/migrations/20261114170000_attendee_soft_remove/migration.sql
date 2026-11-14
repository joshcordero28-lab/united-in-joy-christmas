-- Soft-remove attendees (restorable); void ballots for audit; talent review flags.

-- AlterEnum
ALTER TYPE "TicketStatus" ADD VALUE 'REMOVED';

-- AlterTable EventConfig
ALTER TABLE "EventConfig" ADD COLUMN "talentResultsCorrectionPending" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable Attendee
ALTER TABLE "Attendee" ADD COLUMN "removedAt" TIMESTAMP(3),
ADD COLUMN "removalReason" TEXT,
ADD COLUMN "removedById" TEXT;

-- AlterTable TalentGroup
ALTER TABLE "TalentGroup" ADD COLUMN "needsMemberReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "memberReviewNote" TEXT;

-- AlterTable AudienceVote
ALTER TABLE "AudienceVote" ADD COLUMN "voidedAt" TIMESTAMP(3),
ADD COLUMN "voidedReason" TEXT,
ADD COLUMN "voidedById" TEXT;

-- CreateIndex
CREATE INDEX "AudienceVote_voidedAt_idx" ON "AudienceVote"("voidedAt");
