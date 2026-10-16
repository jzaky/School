-- CreateTable
CREATE TABLE "saml_assertions" (
    "org_id" UUID NOT NULL,
    "assertion_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saml_assertions_pkey" PRIMARY KEY ("org_id","assertion_id")
);

-- CreateIndex
CREATE INDEX "saml_assertions_expires_at_idx" ON "saml_assertions"("expires_at");
