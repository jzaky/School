# Deployment manifests

`AEGIS_DEPLOYMENT_MANIFEST` holds a manifest as inline JSON or a path to one of these files. It is the
operator's declaration of where each part of the installation runs. The console's Deployment page
(`/org/deployment`) checks it for completeness and shows every declared fact as "declared".

These examples name no real provider and carry no attestation, so none of them produces a residency
claim. An operator who has confirmed the facts with each provider fills in `attestedBy` and
`attestedAt` for each component. Schema: `packages/core/src/deployment/manifest.ts`.

| File | Model |
|---|---|
| `saas.example.json` | Multi-tenant SaaS |
| `uae-single-tenant.example.json` | Single-tenant managed, all components declared in the UAE |
| `customer-private.example.json` | Customer-controlled private cloud |
| `on-premises.example.json` | On-premises |
