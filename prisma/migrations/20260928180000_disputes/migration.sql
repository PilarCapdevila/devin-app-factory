-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseReference" TEXT NOT NULL,
    "paymentReference" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "paymentDate" DATETIME NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "customerStatement" TEXT NOT NULL,
    "cardholderName" TEXT NOT NULL,
    "cardLast4" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "respondBy" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "proposal" TEXT,
    "evidenceSummary" TEXT,
    "assignedToId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Dispute_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Dispute_caseReference_key" ON "Dispute"("caseReference");

-- CreateIndex
CREATE INDEX "Dispute_assignedToId_idx" ON "Dispute"("assignedToId");

-- CreateIndex
CREATE INDEX "Dispute_status_idx" ON "Dispute"("status");

-- CreateIndex
CREATE INDEX "Dispute_respondBy_idx" ON "Dispute"("respondBy");
