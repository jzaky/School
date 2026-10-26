// Local mock identity providers for end-to-end tests and local demos (never production): OpenID Connect,
// ClassLink, Clever and UAE PASS on one port. Run: npx tsx scripts/mock-idp.ts 3145
// Then start the app with, for example:
//   CLASSLINK_CLIENT_ID=cl-client CLASSLINK_CLIENT_SECRET=cl-secret CLASSLINK_ISSUER=http://127.0.0.1:3145/classlink
//   CLEVER_CLIENT_ID=clever-client CLEVER_CLIENT_SECRET=clever-secret CLEVER_OAUTH_BASE=http://127.0.0.1:3145/clever
//   CLEVER_API_BASE=http://127.0.0.1:3145/clever-api UAEPASS_CLIENT_ID=uaepass-client UAEPASS_CLIENT_SECRET=uaepass-secret
//   UAEPASS_BASE=http://127.0.0.1:3145/uaepass/idshub INTEGRATIONS_ALLOW_PRIVATE_URLS=true
// The signed-in user per provider is set with POST /_mock/users/<oidc|classlink|clever|uaepass> (JSON claims).
import { startMockIdp } from "../tests/fixtures/mock-idp";

const port = Number(process.argv[2] ?? 3145);
startMockIdp(port).then((idp) => console.log(`[mock-idp] listening on ${idp.base}`));
