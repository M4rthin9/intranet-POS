CREATE TYPE "PosPaymentMode" AS ENUM ('WALLET', 'INSTANT');
ALTER TABLE "Event" ADD COLUMN "paymentMode" "PosPaymentMode" NOT NULL DEFAULT 'WALLET';

CREATE TABLE "_PosCategories" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_PosCategories_AB_pkey" PRIMARY KEY ("A", "B")
);
CREATE INDEX "_PosCategories_B_index" ON "_PosCategories"("B");
ALTER TABLE "_PosCategories" ADD CONSTRAINT "_PosCategories_A_fkey" FOREIGN KEY ("A") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_PosCategories" ADD CONSTRAINT "_PosCategories_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
