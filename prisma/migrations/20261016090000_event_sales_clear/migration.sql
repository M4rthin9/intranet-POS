-- CreateTable
CREATE TABLE "EventSalesClear" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "backupId" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventSalesClear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClearedOrder" (
    "orderId" TEXT NOT NULL,
    "clearId" TEXT NOT NULL,

    CONSTRAINT "ClearedOrder_pkey" PRIMARY KEY ("orderId")
);

-- CreateTable
CREATE TABLE "ClearedPayment" (
    "paymentId" TEXT NOT NULL,
    "clearId" TEXT NOT NULL,

    CONSTRAINT "ClearedPayment_pkey" PRIMARY KEY ("paymentId")
);

-- CreateIndex
CREATE INDEX "EventSalesClear_eventId_createdAt_idx" ON "EventSalesClear"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "ClearedOrder_clearId_idx" ON "ClearedOrder"("clearId");

-- CreateIndex
CREATE INDEX "ClearedPayment_clearId_idx" ON "ClearedPayment"("clearId");

-- AddForeignKey
ALTER TABLE "EventSalesClear" ADD CONSTRAINT "EventSalesClear_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClearedOrder" ADD CONSTRAINT "ClearedOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClearedOrder" ADD CONSTRAINT "ClearedOrder_clearId_fkey" FOREIGN KEY ("clearId") REFERENCES "EventSalesClear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClearedPayment" ADD CONSTRAINT "ClearedPayment_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClearedPayment" ADD CONSTRAINT "ClearedPayment_clearId_fkey" FOREIGN KEY ("clearId") REFERENCES "EventSalesClear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reset history and archive membership must remain permanent.
CREATE TRIGGER "EventSalesClear_append_only" BEFORE UPDATE OR DELETE ON "EventSalesClear" FOR EACH ROW EXECUTE FUNCTION ccida_deny_mutation();
CREATE TRIGGER "ClearedOrder_append_only" BEFORE UPDATE OR DELETE ON "ClearedOrder" FOR EACH ROW EXECUTE FUNCTION ccida_deny_mutation();
CREATE TRIGGER "ClearedPayment_append_only" BEFORE UPDATE OR DELETE ON "ClearedPayment" FOR EACH ROW EXECUTE FUNCTION ccida_deny_mutation();
