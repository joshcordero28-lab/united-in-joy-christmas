-- Non-destructive: add visibility + results-published flags (defaults keep voting hidden).
DO $$ BEGIN
  CREATE TYPE "VotingVisibility" AS ENUM ('HIDDEN', 'REVEALED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "EventConfig" ADD COLUMN IF NOT EXISTS "talentVotingVisibility" "VotingVisibility" NOT NULL DEFAULT 'HIDDEN';
ALTER TABLE "EventConfig" ADD COLUMN IF NOT EXISTS "talentResultsPublished" BOOLEAN NOT NULL DEFAULT false;

-- If prior migration left talentVotingState=REVEALED, treat as: visible + closed + results published.
UPDATE "EventConfig"
SET
  "talentVotingVisibility" = 'REVEALED',
  "talentResultsPublished" = true,
  "talentVotingState" = 'CLOSED'
WHERE "talentVotingState" = 'REVEALED';
