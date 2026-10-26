# Sign-in options

How people sign in to Horizon, what each school can switch on, the rules that keep accounts safe, and what each
identity provider needs before it works in production. ClassLink has its own guide: docs/guides/classlink.md.
Server variables and redirect URIs: docs/deploy.md, "Sign-in providers: redirect URIs".

## 1. The options

Each school chooses its options on **Administration > Sign-in** (permission `signin.manage`: school administrators
and the Head of IT). An option appears on the school's sign-in page, `/login/<school address>`, only when the
school switches it on **and** the server has its credentials. The page shows each option as **Ready**, **Needs
server setup** (with the missing variable names), **Needs your ID** or **Needs provider details**.

| Option | Who it suits | What the school enters | What the server needs |
| --- | --- | --- | --- |
| Email and password | Everyone; always on for school administrators | Nothing | Nothing |
| Email sign-in link | Parents who forget passwords | Nothing | `RESEND_API_KEY` |
| Google | Schools on Google Workspace; parents with Google accounts | Nothing | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` |
| Microsoft | Schools on Microsoft 365 | Microsoft tenant ID (recommended) | `AUTH_MICROSOFT_ENTRA_ID_ID`, `AUTH_MICROSOFT_ENTRA_ID_SECRET` |
| ClassLink | Schools on ClassLink LaunchPad | ClassLink tenant ID | `CLASSLINK_CLIENT_ID`, `CLASSLINK_CLIENT_SECRET` |
| Clever | Schools on Clever | Clever district ID | `CLEVER_CLIENT_ID`, `CLEVER_CLIENT_SECRET` |
| UAE PASS | Parents and staff in the UAE | Whether to match by Emirates ID | `UAEPASS_CLIENT_ID`, `UAEPASS_CLIENT_SECRET`, `UAEPASS_ENV` |
| School identity provider | Schools with Okta, AD FS, Keycloak or any OpenID Connect provider | Button name, issuer URL, client ID and secret, claim names | `FIELD_ENCRYPTION_KEY` (the secret is stored encrypted) |

The general sign-in page, `/login`, keeps password sign-in and offers "Use your school's sign-in page" (the
school's address in Horizon, for example `horizon`); on a device that used a school's page before, it shows a
shortcut to that page. A school's page shows its name and logo, works in English and Arabic, and fits a phone screen.

**Forgot your password?** is on every page with a password field. See section 4.

## 2. Rules (Administration > Sign-in > Options and rules)

- **Staff must use single sign-on.** Staff can no longer use a password or an email link. School administrators
  keep their password so the school can never be locked out. Families are not affected. It can only be switched
  on when a working single sign-on option is on.
- **Allowed email domains.** Staff and students may use single sign-on only with addresses on these domains.
  Parents are not limited.
- **Match a first sign-in by**: roster ID then verified email (default), verified email only, or roster ID only.
  The roster ID comes from ClassLink, Clever or the school's own directory.
- **Self-join domains for staff.** Unknown people with a verified address on these domains may join as staff
  through single sign-on, and by default wait on Join requests until an administrator approves them and chooses
  their roles. Nobody else gets an account without an invitation.

## 3. How a single sign-on is checked

Every single sign-on (ClassLink, Clever, UAE PASS, a school's own provider, and Google and Microsoft through
Auth.js) goes through the same steps:

1. **Start.** Horizon creates a random state, a nonce and (where the provider supports it) a PKCE verifier, and
   keeps them in a short-lived, encrypted, HttpOnly cookie tied to the school and the page to return to.
2. **Callback.** The state must match the cookie (compared in constant time); the code is exchanged on the back
   channel; an ID token must have a valid signature from the provider's published keys (RS, PS or ES algorithms
   only), the right issuer and audience, the nonce, and must not be expired. A sign-in started from LaunchPad or
   the Clever portal (no state of ours) is restarted from Horizon, so it gets one.
3. **Who is it?** In the school the sign-in started from (or, for ClassLink and Clever, the school that owns the
   tenant or district):
   - an existing link for this provider account signs the person in;
   - otherwise the person is found by roster ID or **verified** email, and the account is linked;
   - a rostered student or parent without an account yet, from the school's own directory, gets one;
   - anyone else is refused, unless self-join applies.
4. **Session.** Horizon issues a one-time ticket, Auth.js redeems it and starts a new session. A single sign-on
   session stays in the school it signed in to.

Which addresses count as verified:

| Provider | Verified when |
| --- | --- |
| Google | Google says `email_verified` |
| Microsoft | The school's own tenant, a personal Microsoft account, Microsoft's verified-domain claim, or a single-tenant setup |
| ClassLink | The account belongs to the school's ClassLink tenant (for that school only) |
| Clever | The account belongs to the school's Clever district (for that school only) |
| UAE PASS | The account is verified (SOP2 or SOP3); unverified SOP1 accounts are refused |
| School identity provider | The provider says `email_verified`, or the school confirms "This directory issues our school addresses" |

Account-linking protections:

- Links are per school: a link in one school opens nothing in another.
- A person already linked to one account of a provider cannot be taken over by a second account of that provider
  with the same email (refused with "already linked to a different account").
- If the roster ID points at one person and the email at another, the sign-in stops ("matches two different
  people").
- Suspended members, switched-off options and other tenants or districts are refused.
- Administrators see recent links on **Administration > Sign-in > Activity** and can remove one; the next single
  sign-on links again by the rules above.

Every sign-in, refusal (with a reason code), new link, removed link, email link and password reset is an audit
event. Audit entries and server logs never contain an email address, a name or an identity number. Password
sign-in is limited to 10 attempts per address and 50 per network address in 15 minutes.

## 4. Email links and password reset

**Email sign-in link** (when the school switches it on): the person enters their address; if it belongs to a
member of a school offering email links, Horizon sends a link that works once and expires after 15 minutes.
Asking again replaces the previous link. The answer on screen is the same whether or not the address exists, and
takes the same time. Limits: 5 requests per address an hour, 20 per network address in 15 minutes. Staff who
must use single sign-on get no link.

**Forgot your password?**

1. The person enters their address on `/forgot-password` (from the sign-in page). The answer on screen is always
   the same.
2. If the address has an account, Horizon emails a reset link in the person's language, through the school's
   email provider. The link works once and expires after 45 minutes; only a hash of it is stored. Limits: 3
   requests per address an hour, 10 per network address in 15 minutes.
3. Staff whose school requires single sign-on get an email telling them to use the school's single sign-on
   instead, never a reset link. The screen says nothing different, so nobody learns whether an account exists.
4. On `/reset-password` the new password must meet the usual rules (at least 10 characters, a letter and a digit,
   not a common password, not the email name). A refused password keeps the link usable.
5. On success every other session of that account ends, the person is signed in, a confirmation email is sent and
   an audit event is written.

## 5. Getting each provider ready for production

Nothing below can be done from Horizon's code: each provider issues the credentials. Until then the options show
**Needs server setup**, and the automated tests use a local mock provider (`scripts/mock-idp.ts`,
`tests/fixtures/mock-idp.ts`).

### Google

1. In Google Cloud console, create (or choose) a project and configure the OAuth consent screen (app name,
   support email, Horizon's domain). Horizon asks only for `openid`, `email` and `profile`.
2. Create an OAuth client ID of type **Web application** with the redirect URI
   `AUTH_URL/api/auth/callback/google` and the JavaScript origin `AUTH_URL`.
3. Set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`, and publish the consent screen (out of testing) so every
   account can sign in.

### Microsoft

1. In the Microsoft Entra admin center, **App registrations > New registration**. For many schools choose
   accounts in any organisational directory and personal Microsoft accounts; for one school only, single tenant.
2. Add a **Web** redirect URI `AUTH_URL/api/auth/callback/microsoft-entra-id` and create a client secret.
3. Set `AUTH_MICROSOFT_ENTRA_ID_ID` and `AUTH_MICROSOFT_ENTRA_ID_SECRET`. For a single-tenant app also set
   `AUTH_MICROSOFT_ENTRA_ID_ISSUER` to `https://login.microsoftonline.com/<tenant id>/v2.0`.
4. Each school enters its Directory (tenant) ID on the Providers tab so its accounts count as verified.

### ClassLink

See docs/guides/classlink.md (partner onboarding, the school's LaunchPad and Roster Server steps, and checks).

### Clever

From Clever's developer documentation (dev.clever.com, checked October 2026):

1. Create a Clever developer account and an application. Add the redirect URI `AUTH_URL/api/sso/clever/callback`
   (Clever uses the first redirect URI in the list by default, so put this one first).
2. Set `CLEVER_CLIENT_ID` and `CLEVER_CLIENT_SECRET`.
3. Ask Clever to switch on OpenID Connect for the application if you want ID tokens; Horizon works without them
   (it reads `/v3.0/me`) and checks the token when one is sent.
4. Districts connect the application in their Clever dashboard; each school enters its Clever district ID.
5. Rostering from Clever uses the district's data API token (Secure Sync), entered per school on the Rostering
   page. Confirm with Clever which review or certification applies before real districts can connect.

Clever's portal and Instant Login send people to Horizon without a state; Horizon restarts the sign-in so every
sign-in carries a verified state, as Clever recommends for applications that require one.

### UAE PASS

Service providers are onboarded by the UAE PASS onboarding team. The published process (docs.uaepass.ae, "Onboarding
process for UAE PASS service providers", checked October 2026) has four phases:

1. **Initiation.** Request the integration through the Developer Portal (`https://uaepass.ae/developers`) and
   state whether the entity is government or private. Private entities provide a valid UAE trade licence. The
   onboarding team sends a welcome email; the service provider returns the Authentication questionnaire, a
   workflow diagram of the UAE PASS user journey and UI mock-ups (wireframes). The team approves the use case.
2. **Development.** Build and test against the staging environment (`https://stg-id.uaepass.ae/idshub`) with
   staging UAE PASS test accounts (the documentation explains how to create and upgrade them). The documentation's
   quick start uses a public sandbox client for a proof of concept only; real integrations use a client issued by
   the UAE PASS team. Horizon's staging setting: `UAEPASS_ENV=staging`.
3. **Assessment.** The onboarding team runs an assessment session against its checklist; the service provider
   fixes any issues, shares video recordings of the tested scenarios, and (private entities) signs the service
   provider agreement before go-live is approved.
4. **Go-live.** Submit the Go Live form for Authentication; the team issues production credentials; set
   `UAEPASS_CLIENT_ID`, `UAEPASS_CLIENT_SECRET` and `UAEPASS_ENV=production`, confirm the go-live date, and the
   team runs a production assessment and shares service desk access.

The login button must follow UAE PASS's button guidelines (docs.uaepass.ae, "Design guidelines"). Horizon's
current UAE PASS button is a placeholder in Horizon's style and must be replaced with the official button assets
before the assessment.

How Horizon uses UAE PASS: scope `urn:uae:digitalid:profile:general`, the documented `acr_values`, the
authorization code with HTTP Basic on the token call, and the user information endpoint. Links are made on the
UAE PASS `uuid`, never on email or mobile alone, as the documentation advises. Unverified (SOP1) accounts cannot
link a first sign-in. When the school switches on **Match by Emirates ID**, a first sign-in from a verified account
can find the student whose stored Emirates ID equals the one UAE PASS returned; the number is compared after
decryption and is never stored by the sign-in or logged.

### A school's own identity provider (OpenID Connect)

1. In the provider (Okta, Microsoft AD FS, Keycloak or another), create a web application with the redirect URI
   shown on **Administration > Sign-in > Providers** (`AUTH_URL/api/sso/oidc/callback`), the authorization code
   flow, and the scopes `openid email profile`.
2. In Horizon, enter the button name, the issuer URL (the address before `/.well-known/openid-configuration`), the
   client ID and secret, and which claims hold the email, the roster ID and the name. **Test** reads the discovery
   document, checks the issuer and reports whether PKCE is supported.
3. Turn on "This directory issues our school addresses" only if the provider is the school's own directory.

The issuer must be https and a public address; discovery and token calls refuse private and internal addresses.

## 6. What a demo shows without real credentials

The demo school (Horizon International School Dubai) has password, email link, Google, Microsoft, ClassLink,
UAE PASS and a school identity provider switched on, an example ClassLink tenant ID, two weeks of sign-in activity,
links for the personas, and a built-in OneRoster demo feed on the Rostering page. On a server without provider
credentials those buttons are hidden from the sign-in page and the settings page names the variables to set.
With the local mock provider (`npx tsx scripts/mock-idp.ts 3145` and the settings listed at the top of that file)
the ClassLink, Clever, UAE PASS and school identity provider buttons sign in for real, as tests/e2e/sso.spec.ts
does.
