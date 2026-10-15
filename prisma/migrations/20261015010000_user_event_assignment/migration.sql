ALTER TABLE "User" ADD COLUMN "assignedEventId" TEXT;
CREATE INDEX "User_assignedEventId_idx" ON "User"("assignedEventId");
ALTER TABLE "User" ADD CONSTRAINT "User_assignedEventId_fkey" FOREIGN KEY ("assignedEventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Retain only established assignments; never choose an unrelated event.
UPDATE "User" u SET "assignedEventId" = s."eventId"
FROM "Shift" s WHERE s."userId" = u.id AND s."closedAt" IS NULL AND u."roleName" <> 'SUPER_ADMIN';
UPDATE "User" u SET "assignedEventId" = e.id
FROM "SystemSetting" s JOIN "Event" e ON e.id = s.value->>'eventId'
WHERE s.key = 'operating-context:' || u.id AND u."assignedEventId" IS NULL AND u."roleName" <> 'SUPER_ADMIN';
