-- CreateTable
CREATE TABLE "software_items" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "ecosystem" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT '',
    "requested_by" UUID,
    "status" TEXT NOT NULL DEFAULT 'under_review',
    "recommended" TEXT NOT NULL DEFAULT 'under_review',
    "risk_score" INTEGER NOT NULL DEFAULT 0,
    "risk_factors" JSONB NOT NULL DEFAULT '[]',
    "policy_version_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT NOT NULL DEFAULT '',
    "reassessment_needed" BOOLEAN NOT NULL DEFAULT false,
    "last_assessed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "software_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "software_components" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '',
    "ecosystem" TEXT NOT NULL DEFAULT '',
    "purl" TEXT,
    "licenses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resolved_host" TEXT,
    "has_integrity" BOOLEAN,
    "has_install_script" BOOLEAN,
    "direct" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "software_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "software_findings" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "component" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "fixed_in" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "software_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "software_evidence" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "format" TEXT NOT NULL,
    "tool" TEXT NOT NULL DEFAULT '',
    "summary" JSONB NOT NULL DEFAULT '{}',
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "software_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "software_items_org_id_status_idx" ON "software_items"("org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "software_items_org_id_ecosystem_name_version_key" ON "software_items"("org_id", "ecosystem", "name", "version");

-- CreateIndex
CREATE INDEX "software_components_org_id_idx" ON "software_components"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "software_components_item_id_name_version_key" ON "software_components"("item_id", "name", "version");

-- CreateIndex
CREATE INDEX "software_findings_org_id_kind_severity_idx" ON "software_findings"("org_id", "kind", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "software_findings_item_id_kind_ref_component_key" ON "software_findings"("item_id", "kind", "ref", "component");

-- CreateIndex
CREATE INDEX "software_evidence_org_id_item_id_idx" ON "software_evidence"("org_id", "item_id");

-- AddForeignKey
ALTER TABLE "software_components" ADD CONSTRAINT "software_components_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "software_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "software_findings" ADD CONSTRAINT "software_findings_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "software_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

