-- AlterTable
ALTER TABLE "TalentGroupMember" ADD COLUMN "verifiedViaTicket" BOOLEAN NOT NULL DEFAULT true;

-- Existing memberships predate explicit QR re-verification UI — flag for organizer review (do not delete).
UPDATE "TalentGroupMember" SET "verifiedViaTicket" = false;
