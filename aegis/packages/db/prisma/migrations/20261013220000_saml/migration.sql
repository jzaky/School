-- SAML 2.0 single sign-on next to OIDC.
ALTER TABLE "sso_connections"
  ADD COLUMN "protocol" TEXT NOT NULL DEFAULT 'oidc',
  ADD COLUMN "saml_entry_point" TEXT,
  ADD COLUMN "saml_idp_cert" TEXT;
