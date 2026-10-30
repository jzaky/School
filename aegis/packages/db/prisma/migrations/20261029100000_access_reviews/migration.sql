-- Agent access reviews (docs/ACCESS_REVIEWS.md): a periodic review where a person keeps or removes each
-- tool grant and resource permission an AI agent holds. Row-level security is applied by rls.sql to every
-- table with a NOT NULL org_id.

-- CreateTable
CREATE TABLE "access_reviews" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "due_at" TIMESTAMP(3) NOT NULL,
    "interval_days" INTEGER,
    "unused_days" INTEGER NOT NULL DEFAULT 90,
    "created_by" UUID,
    "completed_by" UUID,
    "completed_at" TIMESTAMP(3),
    "summary" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_review_items" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "target_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "uses" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMP(3),
    "decision" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "access_review_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "access_reviews_org_id_status_idx" ON "access_reviews"("org_id", "status");

-- CreateIndex
CREATE INDEX "access_review_items_org_id_review_id_idx" ON "access_review_items"("org_id", "review_id");

-- AddForeignKey
ALTER TABLE "access_review_items" ADD CONSTRAINT "access_review_items_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "access_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
