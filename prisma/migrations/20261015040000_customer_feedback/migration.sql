CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "submissionKey" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "eventId" TEXT,
    "rating" INTEGER NOT NULL,
    "serviceRating" INTEGER,
    "speedRating" INTEGER,
    "category" TEXT NOT NULL DEFAULT 'SUGGESTION',
    "message" VARCHAR(2000) NOT NULL,
    "customerName" VARCHAR(120),
    "contact" VARCHAR(200),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Feedback_rating_range" CHECK ("rating" BETWEEN 1 AND 5),
    CONSTRAINT "Feedback_service_range" CHECK ("serviceRating" IS NULL OR "serviceRating" BETWEEN 1 AND 5),
    CONSTRAINT "Feedback_speed_range" CHECK ("speedRating" IS NULL OR "speedRating" BETWEEN 1 AND 5),
    CONSTRAINT "Feedback_category_valid" CHECK ("category" IN ('SUGGESTION', 'COMPLIMENT', 'ISSUE'))
);
CREATE UNIQUE INDEX "Feedback_submissionKey_key" ON "Feedback"("submissionKey");
CREATE INDEX "Feedback_eventId_createdAt_idx" ON "Feedback"("eventId", "createdAt");
CREATE INDEX "Feedback_createdAt_idx" ON "Feedback"("createdAt");
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
INSERT INTO "Permission" ("key") VALUES ('feedback.view') ON CONFLICT DO NOTHING;
