-- Non-destructive: archive King/Queen votes by renaming Vote → LegacyKingQueenVote (no row drops).
ALTER TABLE "Vote" RENAME TO "LegacyKingQueenVote";
ALTER TABLE "LegacyKingQueenVote" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Drop old unique/index names if needed and recreate on renamed table (Postgres keeps indexes on rename).
-- EventConfig: add talent voting state (legacy king/queen columns retained).
ALTER TABLE "EventConfig" ADD COLUMN IF NOT EXISTS "talentVotingState" TEXT NOT NULL DEFAULT 'CLOSED';

-- Create GroupStatus enum
DO $$ BEGIN
  CREATE TYPE "GroupStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Talent groups
CREATE TABLE IF NOT EXISTS "TalentGroup" (
  "id" TEXT NOT NULL,
  "groupName" TEXT NOT NULL,
  "performanceTitle" TEXT NOT NULL,
  "talentType" TEXT NOT NULL,
  "leaderAttendeeId" TEXT NOT NULL,
  "status" "GroupStatus" NOT NULL DEFAULT 'PENDING',
  "performanceOrder" INTEGER,
  "rejectionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TalentGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TalentGroupMember" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "attendeeId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TalentGroupMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AudienceVote" (
  "id" TEXT NOT NULL,
  "voterId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AudienceVote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TalentGroup_status_idx" ON "TalentGroup"("status");
CREATE INDEX IF NOT EXISTS "TalentGroup_performanceOrder_idx" ON "TalentGroup"("performanceOrder");
CREATE INDEX IF NOT EXISTS "TalentGroupMember_groupId_idx" ON "TalentGroupMember"("groupId");
CREATE UNIQUE INDEX IF NOT EXISTS "TalentGroupMember_groupId_attendeeId_key" ON "TalentGroupMember"("groupId", "attendeeId");
CREATE UNIQUE INDEX IF NOT EXISTS "TalentGroupMember_attendeeId_key" ON "TalentGroupMember"("attendeeId");
CREATE UNIQUE INDEX IF NOT EXISTS "AudienceVote_voterId_key" ON "AudienceVote"("voterId");
CREATE INDEX IF NOT EXISTS "AudienceVote_groupId_idx" ON "AudienceVote"("groupId");
CREATE INDEX IF NOT EXISTS "LegacyKingQueenVote_category_idx" ON "LegacyKingQueenVote"("category");
CREATE INDEX IF NOT EXISTS "LegacyKingQueenVote_voterId_idx" ON "LegacyKingQueenVote"("voterId");

-- FKs
DO $$ BEGIN
  ALTER TABLE "TalentGroup" ADD CONSTRAINT "TalentGroup_leaderAttendeeId_fkey"
    FOREIGN KEY ("leaderAttendeeId") REFERENCES "Attendee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TalentGroupMember" ADD CONSTRAINT "TalentGroupMember_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "TalentGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TalentGroupMember" ADD CONSTRAINT "TalentGroupMember_attendeeId_fkey"
    FOREIGN KEY ("attendeeId") REFERENCES "Attendee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AudienceVote" ADD CONSTRAINT "AudienceVote_voterId_fkey"
    FOREIGN KEY ("voterId") REFERENCES "Attendee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AudienceVote" ADD CONSTRAINT "AudienceVote_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "TalentGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Fix EventConfig column type to VotingState enum if stored as text
DO $$ BEGIN
  ALTER TABLE "EventConfig" ALTER COLUMN "talentVotingState" DROP DEFAULT;
  ALTER TABLE "EventConfig" ALTER COLUMN "talentVotingState" TYPE "VotingState" USING ("talentVotingState"::"VotingState");
  ALTER TABLE "EventConfig" ALTER COLUMN "talentVotingState" SET DEFAULT 'CLOSED'::"VotingState";
EXCEPTION WHEN others THEN
  -- already correct type
  NULL;
END $$;
