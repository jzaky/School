// OneRoster and Clever fixture feeds for roster tests, plus mock server routes that serve them page by page.
// The OneRoster routes check the OAuth 1.0a HMAC-SHA256 signature the way a roster server does.
import type http from "node:http";
import { createHmac } from "node:crypto";
import { pct } from "@/server/rostering/client";
import type { MockIdp } from "./mock-idp";

type Row = Record<string, unknown>;
export type Feed = { orgs: Row[]; academicSessions: Row[]; courses: Row[]; users: Row[]; classes: Row[]; enrollments: Row[]; demographics: Row[] };

const ref = (sourcedId: string, type: string) => ({ sourcedId, type, href: `/${type}s/${sourcedId}` });
const MOD = "2026-09-01T08:00:00.000Z";

/** A small school: two schools in the district (only one is ours), staff, students across KG and grades, parents. */
export function smallFeed(): Feed {
  const school = "org-ald";
  const other = "org-other";
  const users: Row[] = [
    { sourcedId: "t-1", status: "active", dateLastModified: MOD, enabledUser: true, role: "teacher", givenName: "Hana", familyName: "Karimi", email: "hana.karimi@aldurrah.test", identifier: "EMP-101", orgs: [ref(school, "org")], agents: [], grades: [] },
    { sourcedId: "t-2", status: "active", dateLastModified: MOD, enabledUser: true, role: "teacher", givenName: "Yousef", familyName: "Darwish", email: "yousef.darwish@aldurrah.test", identifier: "EMP-102", orgs: [ref(school, "org")], agents: [], grades: [] },
    { sourcedId: "a-1", status: "active", dateLastModified: MOD, enabledUser: true, role: "administrator", givenName: "Mona", familyName: "Saleh", email: "mona.saleh@aldurrah.test", identifier: "EMP-900", orgs: [ref(school, "org")], agents: [], grades: [] },
    { sourcedId: "s-1", status: "active", dateLastModified: MOD, enabledUser: true, role: "student", givenName: "Omar", familyName: "Haddad", email: "omar.h@students.aldurrah.test", identifier: "S-1001", orgs: [ref(school, "org")], agents: [ref("p-1", "user")], grades: ["09"] },
    { sourcedId: "s-2", status: "active", dateLastModified: MOD, enabledUser: true, role: "student", givenName: "Lina", familyName: "Haddad", email: null, identifier: "S-1002", orgs: [ref(school, "org")], agents: [ref("p-1", "user"), ref("p-2", "user")], grades: ["KG"] },
    { sourcedId: "s-3", status: "active", dateLastModified: MOD, enabledUser: true, role: "student", givenName: "Zaid", familyName: "Nasser", email: null, identifier: "S-1003", orgs: [ref(school, "org")], agents: [], grades: ["PK"] },
    { sourcedId: "s-4", status: "active", dateLastModified: MOD, enabledUser: true, role: "student", givenName: "Maya", familyName: "Aziz", email: null, identifier: "S-1004", orgs: [ref(school, "org")], agents: [ref("p-3", "user")], grades: ["10"] },
    { sourcedId: "s-5", status: "active", dateLastModified: MOD, enabledUser: true, role: "student", givenName: "Tala", familyName: "Odeh", email: null, identifier: "S-1005", orgs: [ref(school, "org")], agents: [], grades: ["TK"] },
    { sourcedId: "s-x", status: "active", dateLastModified: MOD, enabledUser: true, role: "student", givenName: "Not", familyName: "Ours", email: null, identifier: "X-1", orgs: [ref(other, "org")], agents: [], grades: ["09"] },
    { sourcedId: "p-1", status: "active", dateLastModified: MOD, enabledUser: true, role: "parent", givenName: "Nour", familyName: "Haddad", email: "nour.haddad@family.test", identifier: null, orgs: [ref(school, "org")], agents: [ref("s-1", "user"), ref("s-2", "user")], grades: [] },
    { sourcedId: "p-2", status: "active", dateLastModified: MOD, enabledUser: true, role: "guardian", givenName: "Sami", familyName: "Haddad", email: "sami.haddad@family.test", identifier: null, orgs: [ref(school, "org")], agents: [], grades: [] },
    { sourcedId: "p-3", status: "active", dateLastModified: MOD, enabledUser: true, role: "parent", givenName: "Rami", familyName: "Aziz", email: "rami.aziz@family.test", identifier: null, orgs: [ref(school, "org")], agents: [ref("s-4", "user")], grades: [] },
  ];
  const classes: Row[] = [
    { sourcedId: "c-math9", status: "active", dateLastModified: MOD, title: "Mathematics 9A", classCode: "9A-MATH", classType: "scheduled", grades: ["09"], subjects: ["Mathematics"], course: ref("co-math9", "course"), school: ref(school, "org"), terms: [ref("term-1", "academicSession")], location: "B-204" },
    { sourcedId: "c-hr9", status: "active", dateLastModified: MOD, title: "Homeroom 9A", classCode: "9A-HR", classType: "homeroom", grades: ["09"], subjects: [], school: ref(school, "org"), terms: [ref("term-1", "academicSession")], location: "B-101" },
    { sourcedId: "c-kg", status: "active", dateLastModified: MOD, title: "KG2 Blue", classCode: "KG2-B", classType: "homeroom", grades: ["KG"], subjects: [], school: ref(school, "org"), terms: [ref("term-1", "academicSession")], location: "K-3" },
    { sourcedId: "c-old", status: "active", dateLastModified: MOD, title: "Old Science", classCode: "OLD-SCI", classType: "scheduled", grades: ["09"], subjects: ["Science"], school: ref(school, "org"), terms: [ref("term-old", "academicSession")], location: null },
  ];
  const enrollments: Row[] = [
    { sourcedId: "e-1", status: "active", dateLastModified: MOD, user: ref("s-1", "user"), class: ref("c-math9", "class"), school: ref(school, "org"), role: "student", primary: false },
    { sourcedId: "e-2", status: "active", dateLastModified: MOD, user: ref("s-1", "user"), class: ref("c-hr9", "class"), school: ref(school, "org"), role: "student", primary: false },
    { sourcedId: "e-3", status: "active", dateLastModified: MOD, user: ref("t-1", "user"), class: ref("c-math9", "class"), school: ref(school, "org"), role: "teacher", primary: true },
    { sourcedId: "e-4", status: "active", dateLastModified: MOD, user: ref("t-2", "user"), class: ref("c-hr9", "class"), school: ref(school, "org"), role: "teacher", primary: true },
    { sourcedId: "e-5", status: "active", dateLastModified: MOD, user: ref("s-2", "user"), class: ref("c-kg", "class"), school: ref(school, "org"), role: "student", primary: false },
    { sourcedId: "e-6", status: "active", dateLastModified: MOD, user: ref("s-4", "user"), class: ref("c-math9", "class"), school: ref(school, "org"), role: "student", primary: false },
  ];
  return {
    orgs: [
      { sourcedId: school, status: "active", dateLastModified: MOD, name: "Al Durrah International School", type: "school", identifier: "ALD" },
      { sourcedId: other, status: "active", dateLastModified: MOD, name: "Another School", type: "school", identifier: "OTH" },
    ],
    academicSessions: [
      { sourcedId: "term-1", status: "active", dateLastModified: MOD, title: "Term 1", type: "term", startDate: "2026-08-24", endDate: "2026-12-10" },
      { sourcedId: "term-old", status: "active", dateLastModified: MOD, title: "Old term", type: "term", startDate: "2023-08-24", endDate: "2023-12-10" },
    ],
    courses: [{ sourcedId: "co-math9", status: "active", dateLastModified: MOD, title: "Mathematics 9", courseCode: "MATH", subjects: ["Mathematics"] }],
    users,
    classes,
    enrollments,
    demographics: [{ sourcedId: "s-1", status: "active", dateLastModified: MOD, birthDate: "2011-04-02", sex: "male" }],
  };
}

/** A full-size school: about 1,500 students, 2,500 parents, 200 staff, 300 classes and 10,000 enrollments. */
export function largeFeed(scale = 1): Feed {
  const school = "org-big";
  const users: Row[] = [];
  const classes: Row[] = [];
  const enrollments: Row[] = [];
  const nStaff = Math.round(200 * scale);
  const nStudents = Math.round(1500 * scale);
  const nClasses = Math.round(300 * scale);
  for (let i = 0; i < nStaff; i++) users.push({ sourcedId: `bt-${i}`, status: "active", role: "teacher", givenName: `Teacher${i}`, familyName: "Staff", email: `teacher${i}@big.test`, identifier: `E-${i}`, orgs: [ref(school, "org")], agents: [], grades: [] });
  for (let i = 0; i < nStudents; i++) {
    const p1 = `bp-${i}`;
    const p2 = `bp-${i}-b`;
    const grade = String((i % 12) + 1).padStart(2, "0");
    users.push({ sourcedId: `bs-${i}`, status: "active", role: "student", givenName: `Student${i}`, familyName: "Big", identifier: `B-${10000 + i}`, orgs: [ref(school, "org")], agents: [ref(p1, "user"), ...(i % 3 ? [ref(p2, "user")] : [])], grades: [grade] });
    users.push({ sourcedId: p1, status: "active", role: "parent", givenName: `Parent${i}`, familyName: "Big", email: `parent${i}@family-big.test`, orgs: [ref(school, "org")], agents: [ref(`bs-${i}`, "user")], grades: [] });
    if (i % 3) users.push({ sourcedId: p2, status: "active", role: "guardian", givenName: `Guardian${i}`, familyName: "Big", email: `guardian${i}@family-big.test`, orgs: [ref(school, "org")], agents: [ref(`bs-${i}`, "user")], grades: [] });
  }
  for (let c = 0; c < nClasses; c++) {
    const grade = String((c % 12) + 1).padStart(2, "0");
    classes.push({ sourcedId: `bc-${c}`, status: "active", title: `Class ${c}`, classCode: `C${c}`, classType: c % 10 === 0 ? "homeroom" : "scheduled", grades: [grade], subjects: ["Mathematics"], school: ref(school, "org"), terms: [], location: `R-${c}` });
    enrollments.push({ sourcedId: `be-t-${c}`, status: "active", user: ref(`bt-${c % nStaff}`, "user"), class: ref(`bc-${c}`, "class"), role: "teacher", primary: true });
  }
  let e = 0;
  for (let i = 0; i < nStudents; i++) {
    const grade = (i % 12) + 1;
    const same = Array.from({ length: nClasses }, (_, c) => c).filter((c) => (c % 12) + 1 === grade);
    for (let k = 0; k < Math.min(6, same.length); k++) enrollments.push({ sourcedId: `be-${e++}`, status: "active", user: ref(`bs-${i}`, "user"), class: ref(`bc-${same[(i + k) % same.length]}`, "class"), role: "student", primary: false });
  }
  return { orgs: [{ sourcedId: school, status: "active", name: "Big School", type: "school" }], academicSessions: [], courses: [], users, classes, enrollments, demographics: [] };
}

function verifyOauth1(req: http.IncomingMessage, url: URL, key: string, secret: string): boolean {
  const h = req.headers.authorization ?? "";
  if (!h.startsWith("OAuth ")) return false;
  const params = Object.fromEntries([...h.slice(6).matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], decodeURIComponent(m[2])]));
  if (params.oauth_consumer_key !== key || params.oauth_signature_method !== "HMAC-SHA256") return false;
  const { oauth_signature: sig, ...rest } = params;
  const all: Array<[string, string]> = [...url.searchParams.entries(), ...Object.entries(rest)];
  const normalized = all
    .map(([k, v]) => [pct(k), pct(v)] as const)
    .sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : 1) : ak < bk ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const base = ["GET", pct(`${url.protocol}//${url.host}${url.pathname}`), pct(normalized)].join("&");
  return createHmac("sha256", `${pct(secret)}&`).update(base).digest("base64") === sig;
}

export type FeedServer = { feed: Feed; key: string; secret: string; calls: string[]; baseUrl: string; failOnce?: string | null };

/** Serves a feed as OneRoster 1.1 REST under /oneroster/ims/oneroster/v1p1, with OAuth 1.0a checks and paging. */
export function serveOneRoster(idp: MockIdp, feed: Feed): FeedServer {
  const srv: FeedServer = { feed, key: "or-key", secret: "or-secret", calls: [], baseUrl: `${idp.base}/oneroster/ims/oneroster/v1p1`, failOnce: null };
  for (const entity of ["orgs", "academicSessions", "courses", "users", "classes", "enrollments", "demographics"] as const) {
    idp.routes.set(`/oneroster/ims/oneroster/v1p1/${entity}`, (req, url) => {
      srv.calls.push(`${entity}?${url.searchParams.toString()}`);
      if (!verifyOauth1(req, url, srv.key, srv.secret)) return { status: 401, body: { imsx_codeMajor: "failure" } };
      if (srv.failOnce === entity) {
        srv.failOnce = null;
        return { status: 503, body: {} };
      }
      const limit = Number(url.searchParams.get("limit") ?? 100);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      let rows = srv.feed[entity];
      const filter = url.searchParams.get("filter");
      const since = filter ? /dateLastModified>'([^']+)'/.exec(filter)?.[1] : null;
      if (since) rows = rows.filter((r) => String(r.dateLastModified ?? "") > since);
      return { status: 200, body: { [entity]: rows.slice(offset, offset + limit) }, headers: { "X-Total-Count": String(rows.length) } };
    });
  }
  return srv;
}

/** Serves a Clever district (v3.0 data API) with a district token and "next" link paging. */
export function serveClever(idp: MockIdp, token: string, data: { schools: Row[]; terms: Row[]; users: Row[]; sections: Row[] }, pageSize = 2) {
  const page = (rows: Row[], path: string, url: URL) => {
    const after = url.searchParams.get("starting_after");
    const start = after ? rows.findIndex((r) => r.id === after) + 1 : 0;
    const slice = rows.slice(start, start + pageSize);
    const role = url.searchParams.get("role");
    const more = start + pageSize < rows.length;
    return { data: slice.map((d) => ({ data: d, uri: `${path}/${d.id}` })), links: more ? [{ rel: "next", uri: `${path}?${role ? `role=${role}&` : ""}limit=${pageSize}&starting_after=${slice[slice.length - 1].id}` }] : [] };
  };
  const auth = (req: http.IncomingMessage) => req.headers.authorization === `Bearer ${token}`;
  for (const [path, rows] of [["/clever-api/v3.0/schools", data.schools], ["/clever-api/v3.0/terms", data.terms], ["/clever-api/v3.0/sections", data.sections]] as const) {
    idp.routes.set(path, (req, url) => (auth(req) ? { status: 200, body: page(rows, path.replace("/clever-api", ""), url) } : { status: 401, body: {} }));
  }
  idp.routes.set("/clever-api/v3.0/users", (req, url) => {
    if (!auth(req)) return { status: 401, body: {} };
    const role = url.searchParams.get("role") ?? "";
    const rows = data.users.filter((u) => Object.keys((u.roles ?? {}) as object)[0] === role);
    return { status: 200, body: page(rows, "/v3.0/users", url) };
  });
}
