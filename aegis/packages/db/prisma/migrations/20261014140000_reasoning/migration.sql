-- Reasoning governance (Phase 5).
ALTER TABLE "tools" ADD COLUMN "reasoning_policy" JSONB NOT NULL DEFAULT '{}';
