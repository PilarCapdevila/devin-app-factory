-- CreateTable
CREATE TABLE "ApprovalConfirmation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "confirmedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT NOT NULL,
    CONSTRAINT "ApprovalConfirmation_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ApprovalRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ApprovalConfirmation_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalConfirmation_requestId_approverId_key" ON "ApprovalConfirmation"("requestId", "approverId");

-- Backfill: requests confirmed before this table existed had exactly one confirmation, by the recorded decider
INSERT INTO "ApprovalConfirmation" ("id", "requestId", "approverId", "confirmedAt", "note")
SELECT 'backfill_' || "id", "id", "decidedById", COALESCE("decidedAt", CURRENT_TIMESTAMP), COALESCE("decisionNote", '')
FROM "ApprovalRequest"
WHERE "status" = 'CONFIRMED' AND "decidedById" IS NOT NULL;
