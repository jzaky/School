-- Attack Simulation Lab (Phase 6). Row-level security and the append-only trigger are applied by prisma/rls.sql.
ALTER TABLE "agents" ADD COLUMN "is_lab" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "attack_simulation_runs" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "target_agent_id" UUID NOT NULL,
    "lab_agent_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'running',
    "scenario_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "summary" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "started_by" UUID,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "attack_simulation_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "attack_simulation_runs_org_id_started_at_idx" ON "attack_simulation_runs"("org_id", "started_at");

CREATE TABLE "attack_simulation_results" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "scenario_key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "expected" TEXT NOT NULL,
    "observed" TEXT NOT NULL,
    "references" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "action_request_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "detail" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "attack_simulation_results_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "attack_simulation_results_org_id_run_id_idx" ON "attack_simulation_results"("org_id", "run_id");
ALTER TABLE "attack_simulation_results" ADD CONSTRAINT "attack_simulation_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "attack_simulation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
