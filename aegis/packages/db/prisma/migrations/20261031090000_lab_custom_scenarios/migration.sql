-- Custom Attack Simulation Lab scenarios (docs/ATTACK_SIMULATION_LAB.md). Scenario content is kept in append-only
-- versions (rls.sql adds the append-only trigger); row-level security is applied by rls.sql to every table with a
-- NOT NULL org_id, and the foreign key gets the same-organization guard.

-- CreateTable
CREATE TABLE "lab_scenarios" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "current_version" INTEGER NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lab_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_scenario_versions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "scenario_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_scenario_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lab_scenarios_org_id_key_key" ON "lab_scenarios"("org_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "lab_scenario_versions_scenario_id_version_key" ON "lab_scenario_versions"("scenario_id", "version");

-- CreateIndex
CREATE INDEX "lab_scenario_versions_org_id_scenario_id_idx" ON "lab_scenario_versions"("org_id", "scenario_id");

-- AddForeignKey
ALTER TABLE "lab_scenario_versions" ADD CONSTRAINT "lab_scenario_versions_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "lab_scenarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
