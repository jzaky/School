-- Shared rate-limit counters (S14). Row-level security for platform tables (S8) is applied by prisma/rls.sql.
CREATE TABLE "rate_limit_buckets" (
    "key" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key","window_start")
);
CREATE INDEX "rate_limit_buckets_window_start_idx" ON "rate_limit_buckets"("window_start");
