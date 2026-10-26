# ClassLink: single sign-on and rostering

This guide is for the school's ClassLink administrator, the school's IT team and Horizon's own team. It covers
what Horizon does with ClassLink, what each side sets up, how records are matched and kept in step, and what to
do when something goes wrong.

ClassLink gives Horizon two things:

- **Sign-in through ClassLink LaunchPad.** Staff and students click the Horizon tile in LaunchPad (or "Sign in
  with ClassLink" on the school's Horizon sign-in page) and arrive signed in. Horizon uses ClassLink's OpenID
  Connect sign-in.
- **Rosters through ClassLink Roster Server.** Staff, students, parents, classes and enrollments come from the
  school's information system through Roster Server in the OneRoster format. Horizon reads them, shows a preview
  of every change, and applies it when the school says so (or every night, once the school is happy).

Horizon only reads from ClassLink. It never writes back to ClassLink, Roster Server or the school's information
system.

---

## 1. What the school's ClassLink administrator does

These steps happen in the school's (or district's) ClassLink consoles. Menu names can differ slightly between
console versions; your ClassLink account manager can point you to the exact screen.

### 1.1 Add Horizon to LaunchPad (single sign-on)

1. In the **ClassLink Management Console**, open the application library and add **Horizon**. Until Horizon is
   listed in the library, ask ClassLink support to add it for your tenant (Horizon's partner team arranges this,
   see section 3).
2. Choose who sees the Horizon tile: usually every staff member and the student groups that use Horizon. Parents
   sign in on the school's Horizon sign-in page instead (password, email link or UAE PASS), unless they also have
   ClassLink accounts.
3. Find your **ClassLink tenant ID** (shown in the Management Console under your district or tenant settings) and
   send it to the person setting up Horizon. Horizon refuses ClassLink sign-ins from any other tenant, so this ID
   is what ties your LaunchPad to your Horizon school.
4. Nothing else is needed for sign-in: Horizon's redirect address is registered once by Horizon's team with
   ClassLink, and every school uses the same Horizon application.

People already signed in to LaunchPad (for example at `launchpad.classlink.com/<your school code>`) are signed in
to Horizon with one click.

### 1.2 Share rosters through Roster Server

1. In **ClassLink Roster Server**, find Horizon's request to access your roster data (Horizon's team sends it
   once the school has signed up; you can also ask ClassLink support to connect Horizon).
2. Choose what to share:
   - **Schools**: only the schools that use Horizon (a district feed can hold several).
   - **People**: students, teachers, administrators and staff, and parents or guardians if you want parents to be
     linked to their children automatically.
   - **Classes and enrollments**: yes, for timetables, registers and gradebooks.
   - **Demographics** (date of birth, sex): share only if your data protection agreement with Horizon allows it.
     Horizon does not need them; they are off by default on Horizon's side too.
3. Approve the request. Once it is approved, Roster Server has a **server address, client ID and client secret**
   for Horizon's access to your tenant (OneRoster 1.1). Depending on how the connection was set up, they are shown
   to you or to Horizon's team in its partner console. Whoever has them enters them in Horizon (section 2.2), or
   sends them to the person setting up Horizon through a secure channel (not plain email). They are stored
   encrypted in Horizon and never shown again.

### 1.3 Check grade codes

OneRoster sends grade codes such as `PK`, `KG`, `01` to `12`. Horizon's default is:

| Feed code | Horizon grade |
| --- | --- |
| `PK` | KG1 |
| `KG` | KG2 |
| `01` to `12` | Grades 1 to 12 |

If your information system uses other codes for kindergarten (for example `TK` for KG1, or `PK` for a
pre-school class), tell the person setting up Horizon. Codes without a mapping are never guessed: those students
are listed as problems in the preview until the school maps the code.

---

## 2. What the school sets up in Horizon

A school administrator (or the Head of IT) does this in Horizon.

### 2.1 Turn on ClassLink sign-in

1. **Administration > Sign-in > Providers > ClassLink**: enter the ClassLink tenant ID. If another Horizon
   school already uses it, Horizon says so (each tenant belongs to one school).
2. **Administration > Sign-in > Options and rules**: switch on **ClassLink**. Its status shows **Ready** when
   the server has Horizon's ClassLink credentials and your tenant ID is saved.
3. Optional rules on the same page:
   - **Allowed email domains** (for example `aldurrah.ae` and your students' domain): staff and students may
     only use single sign-on with these addresses. Parents are not limited.
   - **Staff must use single sign-on**: staff can no longer use a password or an email link; school
     administrators keep their password so the school can never be locked out.
   - **Match a first sign-in by**: roster ID, then verified email (recommended with Roster Server).
4. Share the school's sign-in page, `https://<horizon address>/login/<school address>`, or simply use the
   LaunchPad tile. The **LaunchPad app link** on the Providers tab is the address the tile opens.

### 2.2 Connect Roster Server

1. **Administration > Rostering > Add connection > ClassLink Roster Server.**
2. Paste the server address (ending in `/ims/oneroster/v1p1`), client ID and client secret. Authentication:
   **OneRoster 1.1 (OAuth 1.0a, HMAC-SHA256)**.
3. Press **Save and test**. Horizon reads the first page of schools; tick your school (or schools).
4. Check **What to import**, the **grade codes** (section 1.3) and **staff roles**:
   - Teachers and aides become Horizon teachers by default.
   - Administrators, principals, counselors and other staff are not imported unless you choose a Horizon role
     for them. Roles that open safeguarding, wellbeing, medical or identity records can never be given by the
     feed; give those by hand on Administration > Roles.
5. Leave **Automatic sync** off for now and save.
6. Press **Preview changes**. Horizon reads the whole feed page by page (a progress bar shows how far it is; you
   can leave the page) and shows:
   - how many staff, students, parents, classes and enrollments would be added, updated, left unchanged,
     removed or skipped;
   - the problems found, each with what to do about it;
   - the first changes, by name.
7. If it looks right, press **Apply these changes**. The same preview is applied, batch by batch.
8. When you trust it, edit the connection and set **Automatic sync** to **Daily** (for example at 03:00). Daily
   syncs read the whole feed, so removals are noticed. **Hourly** asks Roster Server for changes only, with one
   full pull a day at the hour you choose.

### 2.3 OneRoster files instead of the API

If the school exports OneRoster CSV files instead (a zip with `users.csv`, `classes.csv`, `enrollments.csv` and
the others, version 1.1 or 1.2), use **Upload OneRoster CSV files** on the Rostering page. Choose the ClassLink
connection under "Same IDs as this connection" when the files come from the same ClassLink tenant, so records
are recognised either way. Uploads are previewed exactly like the live feed.

---

## 3. What Horizon's team does with ClassLink (partner onboarding)

This is done once for Horizon, not per school.

1. **Partner application.** Apply to the ClassLink partner program through ClassLink's partner pages and ask
   for access to the partner (developer) console and Partner Services. Partner Services is the team that
   connects applications to LaunchPad and Roster Server.
2. **Register Horizon for single sign-on.** In the partner console, create an OpenID Connect application:
   - Redirect URI: `https://<horizon address>/api/sso/classlink/callback`
   - Launch URL for the LaunchPad tile: `https://<horizon address>/api/sso/classlink/start`
   - Scopes: `openid profile email`
   ClassLink issues a client ID and secret. They go into the server settings `CLASSLINK_CLIENT_ID` and
   `CLASSLINK_CLIENT_SECRET` (see docs/deploy.md); they are never stored in the database.
3. **Register Horizon for Roster Server** as a OneRoster consumer, so districts can find it and approve access.
4. **Test district.** Ask Partner Services for a test (sandbox) tenant with sample users and a Roster Server
   feed. Run the checks in section 6 against it.
5. **Certification and listing.** Complete ClassLink's review so Horizon appears in the LaunchPad application
   library and in Roster Server for every district. Horizon also follows the 1EdTech OneRoster 1.1 and 1.2
   rostering consumer behaviour (paging, filters, status `tobedeleted`, CSV bulk and delta files); applying for
   1EdTech certification is a separate, optional step.
6. **Per school.** When a school signs up: send the Roster Server access request (or ask Partner Services to
   connect the district), confirm the tenant ID, and walk the school through section 2.

### Details confirmed and still to confirm with ClassLink

Confirmed from ClassLink's published OpenID Connect discovery document
(`https://launchpad.classlink.com/.well-known/openid-configuration`, checked October 2026):

- Authorization `https://launchpad.classlink.com/oauth2/v2/auth`, token `/oauth2/v2/token`, keys
  `/oauth2/v2/jwks`, ID tokens signed with RS256.
- Claims `classLink_tenant_id`, `classLink_sourcedId`, `classLink_role`, `email`, `given_name`, `family_name`.
- No PKCE methods are advertised, so Horizon does not send PKCE to ClassLink; it uses state and nonce, and checks
  the ID token signature. Horizon turns PKCE on automatically if ClassLink starts advertising it.

To confirm with Partner Services (each is isolated in `src/server/sso/providers.ts` or
`src/server/rostering/client.ts` with a comment):

- The user information address in the discovery document (`nodeapi.classlink.com/v2/my/profileinfo`) and its
  field names. Horizon reads both OpenID claim names and ClassLink's own (`Email`, `TenantId`, `SourcedId`).
- Whether `classLink_sourcedId` always equals the user's OneRoster `sourcedId` in Roster Server for the same
  tenant (Horizon matches first sign-ins by it when it does).
- The Roster Server proxy option (a bearer token instead of OAuth 1.0a signing): supported by the **Bearer
  token** authentication choice, to be tested with a real tenant.
- Where the per-tenant Roster Server credentials appear once a school approves Horizon (the school's console or
  Horizon's partner console), so section 1.2 can name the exact screen.

---

## 4. How people are matched and kept in step

### Sign-in

1. A ClassLink sign-in is accepted only from the school's own tenant.
2. The first time, Horizon finds the person by their roster ID (the OneRoster `sourcedId` Roster Server sent), or
   by their email address. Addresses from the school's own ClassLink tenant count as verified, for that school
   only.
3. The ClassLink account is then linked to that person in that school. Later sign-ins use the link.
4. A person already linked to one ClassLink account cannot be taken over by a different ClassLink account with
   the same email: that sign-in is refused and an administrator can remove the old link on
   **Administration > Sign-in > Activity**.
5. A rostered student or parent who has no Horizon account yet gets one at their first ClassLink sign-in (the
   school's directory vouches for them). Unknown people never get an account, unless the school lists their
   email domain under **Self-join domains for staff**: they then join as staff and, by default, wait on Join
   requests until an administrator approves them and chooses their roles.
6. Single sign-on sessions stay in the school they signed in to; switching to another school needs signing in
   there.

### Rostering

- **The feed wins for what it sends**: English names, grade, staff number, class title, room, homeroom flag,
  class teacher, and the enrollments it created.
- **Horizon keeps what the feed does not send**: Arabic names, Emirates ID and passport numbers, medical notes,
  sections, curriculum, roles after the first import, and enrollments made in Horizon.
- **Matching once**: staff by email, students by student number, parents by email, and enrollments by student and
  class. After that the feed's IDs are used, so a renamed person is updated, not duplicated. On the first sync of
  a school that already imported its people, existing records show as **linked to existing record**, not as new.
- **Sign-in addresses never change through a sync.** A changed staff email is listed as a problem for an
  administrator to check.
- **Duplicates are refused**: two people with the same email or student number in the feed are both listed as
  problems and neither is applied.
- **Removal means deactivation**: a student who leaves the feed becomes inactive, a staff member is suspended
  (school administrators never are), parent links and enrollments the feed created are removed. Records made in
  Horizon are never removed by the feed.
- **Removal limit**: a sync that would remove more than the connection's limit (10% of a kind by default, and
  more than five records) stops with **Stopped for review**. Nothing is removed until someone ticks the
  confirmation and applies.
- **Unchanged records are skipped** (each record's content is fingerprinted), so a nightly sync of a whole school
  only writes what changed. A record whose only change is in something Horizon does not take from the feed (for
  example a student's list of parents, which is handled on the parent's side) counts as unchanged.
- **Already gone in Horizon**: when the feed drops a record whose Horizon record was already deleted (for example
  an enrollment removed by a subject change), it is not listed as a removal; Horizon just forgets the link.

Every sign-in, refusal, link, preview and sync is in the audit log. Audit entries carry codes and counts, never
an email address, a name or an identity number.

---

## 5. Size and reliability

Horizon is built for a full school: about 1,500 students, 2,500 parents, 200 staff, a few hundred classes and
10,000 enrollments.

- The feed is read 1,000 records per request (OneRoster `limit` and `offset`), with the total from
  `X-Total-Count`.
- Records are staged, then applied in batches of 200 people or 500 enrollments, each batch in its own
  transaction.
- After every page and every batch the run saves where it is. If the server restarts mid-run, the worker
  carries on from the last saved batch, and nothing is applied twice.
- Tested with a generated school of that size: the first full sync takes under a minute; a nightly sync with no
  changes about 20 seconds.

---

## 6. Checks before going live

| Check | Where | Expected |
| --- | --- | --- |
| Tenant ID saved and ClassLink switched on | Administration > Sign-in | ClassLink shows **Ready** |
| A teacher signs in from the LaunchPad tile | LaunchPad | Lands on Horizon's home page, signed in |
| A teacher from another tenant tries | School sign-in page | "That account belongs to another organisation's directory" |
| First preview | Administration > Rostering | Counts look like the school's numbers; problems are understood |
| Apply | Run page | Status **Synced** or **Synced with problems** (the problems listed) |
| Second preview straight after | Administration > Rostering | Everything **Unchanged** |
| A test student removed in the information system | Next preview | One student under **Remove** |

---

## 7. Problems and what they mean

| Message | What to do |
| --- | --- |
| The server refused the credentials | Copy the client ID and secret again from Roster Server (no spaces), then **Save and test**. |
| The server's answer is not OneRoster data | The address should end in `/ims/oneroster/v1p1`. |
| Grade code without a mapping | Map the code on the connection (section 1.3), then preview again. |
| Staff role without a Horizon role | Choose a Horizon role for that feed role, or leave those staff out. |
| A staff email changed in the feed | Check with the person; if right, change their address in Administration > People. |
| The same email on two people / the same student number twice | Fix the records in the information system. |
| Stopped for review | Open the run, check the removals, tick the confirmation and apply, or fix the feed. |
| Sign-in: "already linked to a different account" | Remove the old link on Administration > Sign-in > Activity, then sign in again. |
| Sign-in: "another organisation's directory" | The ClassLink account belongs to another tenant, or the tenant ID in Horizon is wrong. |
