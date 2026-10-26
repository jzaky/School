# Capacity: a 1,500-student school, tested at full size

What we measured with a synthetic school the size of Al Durrah International School, Sharjah (1,554 students KG1 to Grade 12, about 2,500 guardians, 150 to 200 staff), what we fixed as a result, and the servers we recommend. Measured 26 October 2026 on the scale worktree branch.

Short version: at full data size every page answers in 0.13 to 0.4 seconds when the server is not busy. The database is not the limit. One Node process serves about 7 to 9 full page loads a second; above that, people wait in a queue. A 1,500-student school needs two web processes for its busiest moment (report card release), and the single biggest improvement still open is the size of every page (each one carries the whole message catalog).

## How it was tested

- **Data**: `scripts/seed-scale.ts` creates a separate school, "Scale Test School, Sharjah" (slug scale-test), in a local database. It is never part of the demo seed and refuses a non-local database unless SCALE_ALLOW_REMOTE=yes. Fixed random seed (20261026), bilingual fictional names, dates relative to today. Every test account's password is in the script (test data only).
- **Page timing**: `scripts/page-timing.ts` signs in as each role through the normal sign-in, warms each page once, then loads it 7 times in a row and reports p50, p95 and the size of the response. Sequential, so it measures the cost of one page at full size.
- **Load**: `scripts/load-test.ts` signs in real accounts of the synthetic school and runs three scenarios at 10, 25, 50 and 100 people in flight. Each level uses different people. It uses Node's built-in fetch and a small pool, no load-testing framework.
- **Machine**: one 4 vCPU Intel Xeon 2.1 GHz, 16 GB, Node 22, PostgreSQL 16 on the same machine. The server ran as one `next start` process (the production image runs the same build as `node server.js`). The load generator ran on the same machine, and another agent's builds were running at the same time (load average 5 to 8), so the numbers are on the pessimistic side.
- **Finding slow queries**: pg_stat_statements is not enabled on the shared development Postgres (it needs a server restart), so we used the opt-in `SLOW_QUERY_MS` log in src/lib/prisma.ts (statement text only, never parameters), per-page sequential and index scan counts from pg_stat_user_tables, and EXPLAIN ANALYZE run as app_user under row level security.

Reproduce (local or staging only, never production):

```
npx tsx scripts/seed-scale.ts                     # about 6.5 minutes
npm run build && npx next start -p 3149
npx tsx scripts/page-timing.ts --base http://localhost:3149 --runs 7 --out timing.json
npx tsx scripts/load-test.ts --base http://localhost:3149 --open-registers --out load.json
E2E_SCALE=1 E2E_BASE_URL=http://localhost:3149 npx playwright test tests/e2e/scale.spec.ts
```

A school admin can sign in only 10 times in 15 minutes; set SCALE_ADMIN_EMAIL to another administrator of the synthetic school when repeating timing runs. Teachers can save a register only before the school's close time (15:30 Dubai by default); `--open-registers` keeps the synthetic school's registers open for the run and puts the time back afterwards.

## Data volume

What the seed created (one past school year of 189 days plus 44 days of this year):

| Records | Rows |
| --- | --- |
| Students, guardians, guardian links | 1,554, 2,483, 3,134 |
| Memberships (staff, parents, students with accounts) | 3,657 |
| Classes and enrollments (two years) | 1,260 and 28,980 |
| Timetable lessons a week (this year) | 2,044 |
| Registers | 102,905 |
| Daily attendance marks | 316,718 |
| Lesson attendance marks | 1,964,283 |
| Assessments and grades | 10,443 and 232,842 |
| Requests and their messages | 3,108 and 6,139 |
| Notifications | 90,520 |
| Audit events | 251,653 |
| Invoices and payments (1,230 family accounts) | 1,522 and 1,381 |
| Admissions applications | 653 |
| Course choices | 15,812 |

- On a clean load the database grew by 1,112 MB (477 MB to 1,589 MB) for these 1.2 school years. That is about **1 GB per school year** for a 1,500-student school, indexes included.
- Lesson-by-lesson attendance is two thirds of it (about 0.65 GB a year: 950 MB for 2 million rows, of which 248 MB is the unique index on register and student). Daily attendance, grades and audit events are about 0.1 GB a year each.
- Seeding took 376 seconds (393 with clean-up of a previous run). The fee billing run for the whole school (1,084 invoices) took 70 seconds as a background job, and recording 1,381 payments took 68 seconds.

## Page timings

Time to the last byte for one person, at full size. "Before" is the code before this work (lists capped at 200 people, no new indexes); "after paging" adds server-side paging and search; "after fixes" adds the indexes, query changes and the PDF font cache. Runs were 7 loads each on a shared, busy machine; differences under about 30 ms are noise.

| Role | Page | Before: p50 / p95 | After paging: p50 / p95 | After fixes: p50 / p95 | Page size |
| --- | --- | --- | --- | --- | --- |
| admin | Students list | 472 / 734 ms | 234 / 302 ms | 233 / 250 ms | 749 KB |
| admin | Students list, page 20 | 381 / 390 ms | 217 / 247 ms | 218 / 250 ms | 750 KB |
| admin | Students search | 290 / 351 ms | 197 / 208 ms | 195 / 262 ms | 750 KB |
| admin | People: students | 372 / 485 ms | 230 / 233 ms | 231 / 273 ms | 795 KB |
| admin | People: families | 448 / 617 ms | 302 / 467 ms | 303 / 573 ms | 1039 KB |
| admin | People: staff | 361 / 482 ms | 306 / 331 ms | 238 / 266 ms | 1117 KB |
| admin | Admissions board | 240 / 337 ms | 372 / 398 ms | 266 / 334 ms | 1471 KB |
| admin | Finance overview | 155 / 175 ms | 174 / 190 ms | 162 / 181 ms | 702 KB |
| admin | Attendance reports | 594 / 691 ms | 666 / 750 ms | 311 / 390 ms | 732 KB |
| admin | Government census return | 501 / 573 ms | 548 / 700 ms | 397 / 518 ms | 1145 KB |
| admin | Government attendance return | 518 / 561 ms | 538 / 641 ms | 349 / 379 ms | 714 KB |
| teacher | Today's registers | 141 / 153 ms | 152 / 153 ms | 153 / 176 ms | 668 KB |
| teacher | Take register (homeroom) | 131 / 142 ms | 140 / 180 ms | 131 / 164 ms | 751 KB |
| teacher | Take register (lesson) | 129 / 142 ms | 146 / 148 ms | 139 / 170 ms | 751 KB |
| teacher | Gradebook | 118 / 128 ms | 157 / 182 ms | 147 / 172 ms | 718 KB |
| parent | Parent home | 128 / 136 ms | 169 / 189 ms | 156 / 172 ms | 652 KB |
| parent | Child page (KG1) | 121 / 137 ms | 157 / 178 ms | 135 / 156 ms | 654 KB |
| parent | Child page (Grade 9) | 134 / 144 ms | 175 / 198 ms | 182 / 218 ms | 665 KB |
| parent | Fees statement | 138 / 150 ms | 150 / 161 ms | 178 / 219 ms | 646 KB |
| parent | Report card PDF | 663 / 687 ms | 362 / 398 ms | 194 / 642 ms | 37 KB |
| student | Student home | 172 / 191 ms | 141 / 158 ms | 156 / 220 ms | 646 KB |
| student | Subjects | 275 / 352 ms | 210 / 213 ms | 178 / 204 ms | 649 KB |
| student | Pathways | 237 / 313 ms | 172 / 183 ms | 163 / 179 ms | 672 KB |
| principal | Principal home (dashboard) | 271 / 288 ms | 180 / 212 ms | 192 / 212 ms | 683 KB |
| principal | Analytics | 276 / 326 ms | 203 / 222 ms | 236 / 347 ms | 708 KB |
| dsl | Cases | 127 / 130 ms | 120 / 127 ms | 150 / 171 ms | 618 KB |
| dsl | DSL home | 137 / 151 ms | 142 / 160 ms | 171 / 193 ms | 646 KB |

The report card PDF "after fixes" figure is from a separate 15-load run on the same build (the full run measured 446 / 677 ms while another build was running). On its own, rendering one report card went from 150 to 430 ms to 45 to 120 ms with identical output (36,056 bytes).

Page sizes are uncompressed HTML. About 530 KB of every English page (756 KB in Arabic) is the message catalog; see "Still open".

## Load results

Throughput is full page loads (or PDFs, or register saves) per second across everyone. p50, p95 and p99 are per request.

**Report card release** (each parent opens home, the child page and the report card PDF; 250 different parents per level):

| In flight | Throughput | p50 | p95 | p99 | Errors |
| --- | --- | --- | --- | --- | --- |
| 10 | 7.2 req/s | 1.4 s | 2.6 s | 2.9 s | 0% |
| 25 | 7.2 req/s | 3.2 s | 6.5 s | 7.8 s | 0% |
| 50 | 8.4 req/s | 6.2 s | 10.1 s | 10.9 s | 0% |
| 100 | 8.6 req/s | 11.7 s | 19.1 s | 21.2 s | 0% |

Before the transaction fix below, 50 and 100 in flight failed 0.7% and 0.9% of requests (500 errors).

**Morning register** (110 teachers, every teacher with a homeroom or a first lesson today: open today's registers, open one register, save all its marks; the same teachers at every level, so from the second level on most saves find the marks unchanged):

| In flight | Throughput | p50 | p95 | p99 | Errors |
| --- | --- | --- | --- | --- | --- |
| 10 | 6.6 req/s | 1.4 s | 2.3 s | 2.6 s | 0% |
| 25 | 7.5 req/s | 3.5 s | 4.2 s | 5.1 s | 0% |
| 50 | 8.9 req/s | 5.5 s | 7.0 s | 8.4 s | 0% |
| 100 | 9.0 req/s | 9.5 s | 17.3 s | 18.8 s | 0% |

**Fee due date** (each parent opens the fees statement and downloads the latest invoice PDF; 250 different parents per level):

| In flight | Throughput | p50 | p95 | p99 | Errors |
| --- | --- | --- | --- | --- | --- |
| 10 | 7.8 req/s | 1.2 s | 2.2 s | 2.5 s | 0% |
| 25 | 8.9 req/s | 2.8 s | 4.9 s | 5.4 s | 0% |
| 50 | 9.2 req/s | 5.2 s | 9.7 s | 10.2 s | 0% |
| 100 | 8.9 req/s | 10.5 s | 18.8 s | 22.2 s | 0% |

**Sign-in**: 7.5 to 9.7 sign-ins a second with 20 at once (p95 2.6 s). Password checks use bcryptjs (cost 10), which runs in JavaScript on the same thread as page rendering.

What this means:
- Throughput is flat from 10 to 100 people in flight: one Node process is saturated at about 7 to 9 requests a second (each full page costs it 110 to 140 ms of CPU), and more people only wait longer. Postgres was never the busy process (spot checks showed a backend at about 20% of one core while the Node server sat above 100%); the server process reached 1.5 GB of memory at 100 in flight.
- Morning register: 120 teachers opening a register and saving 5 or 6 times within 10 minutes is about 1,000 requests, under 2 a second on average. One process handles that with sub-second responses.
- Report card release: if 1,000 of 2,500 guardians open the notification within 15 minutes, that is 3,000 requests (3.3 a second on average, several times that in the first minutes). One process would make parents wait several seconds at the peak; two processes keep it near one second. Releasing grade by grade or school section by section also flattens the peak.
- Fee due date: the same shape as report cards but spread over days.

## Bottlenecks found and fixed

1. **Silent caps on lists**: the students list showed the first 200 with a subtitle claiming all; people and setup pages loaded up to 1,000 guardians; pickers loaded 400 to 3,000 students. Now: server-side paging (50 per page, "Showing 1 to 50 of 1,554", previous and next), real counts, and server-searched pickers (first 20 matches with a "type more" hint). Students list 472 to 233 ms.
2. **Missing indexes** (migration 20261026230000_scale_indexes): Enrollment had no index starting with classId, so every class roster read walked the whole (studentId, classId) index; reading this year's homerooms went from 330 ms to 2 ms. Also GuardianLink(studentId), Request and Submission by student, MembershipRole(roleId) (people, families and admissions pages scanned the table), AuditEvent(orgId, action, createdAt) (the census scanned 250,000 audit rows for readmissions).
3. **Long id lists**: attendance reports and government returns sent all 1,554 student ids to find homerooms, and the census sent every joiner's id to the audit table. Now one indexed read each. Attendance reports 666 to 311 ms, census 548 to 397 ms, attendance return 538 to 349 ms.
4. **PDF fonts parsed for every document**: font parsing was 53% of the CPU of a report card. Fonts are now parsed once per process (src/server/documents/pdf.ts, newPdf) for all 11 PDF types.
5. **Failures under load**: user-scoped database transactions (session and school lookup) used Prisma's defaults of 2 seconds to start and 5 to finish, so at 50 or more people in flight some page loads failed with "Unable to start a transaction in the given time". They now use the same limits as school-scoped transactions (5 and 15 seconds); the reruns at 50 and 100 had no errors.
6. **Kindergarten correctness at size**: My children showed "Grade -1" and 100% attendance for a child who had not started; both fixed (see docs/guides/kindergarten-and-large-schools.md).

## Still open (in order of value)

1. **Every page carries the whole message catalog.** The app layout passes all messages to the browser: 530 KB of JSON in English, 756 KB in Arabic (164 KB and 197 KB gzipped) in every full page load. It is most of each page's 620 to 750 KB and a large share of the CPU per request. Passing only the namespaces client components use would cut page size several times and raise throughput; it needs a careful pass because a client component whose namespace is missing shows raw keys.
2. **Nine count queries on every page.** The app shell runs nine badge counts in parallel, each in its own transaction (to set the school for row level security). Combining them into one transaction, or caching them per person for 30 seconds, saves nine database round trips per page.
3. **Password checks in JavaScript.** bcryptjs costs about 100 ms of CPU per sign-in on the page-rendering thread. A native bcrypt or argon2 binding is several times faster; parents who stay signed in on the installed app avoid it entirely.
4. **One process per container.** Node renders on one core. Use several replicas (or containers with 2 vCPU each, which gives Prisma's query engine and garbage collection room) rather than one large container.
5. **Lesson attendance growth.** 0.65 GB a year per 1,500 students. Fine for years at one school; for many schools, partition AttendanceLessonMark by school year or archive years past the retention period.
6. **pg_stat_statements in production.** Enable it on Railway's Postgres to keep finding slow queries with real traffic.

## Recommended sizing

The figures assume the open items above are not done yet. Railway's per-replica limits depend on the plan; the numbers below are what each replica needs.

**One school of 1,500 students (Railway)**
- Web: 2 replicas, each 2 vCPU and 2 GB memory (about 15 to 18 page loads a second together). Set `connection_limit=10` on DATABASE_URL so each replica's pool is explicit.
- Worker: 1 replica, 1 vCPU and 1 GB (billing runs, notifications, reminders).
- Postgres: 2 vCPU, 4 GB memory, 20 GB volume (1 GB a year of data plus room for indexes and vacuum), daily backups.
- Redis: 256 MB.

**Five schools of this size (Railway)**
- Web: 4 to 6 replicas of 2 vCPU and 2 GB (stagger report card releases between schools, or add replicas for release days).
- Worker: 2 replicas of 1 vCPU and 1 GB.
- Postgres: 4 vCPU, 8 to 16 GB memory, 100 GB volume (5 GB a year, plus several years kept), max_connections at least replicas times 10 plus the worker; consider PgBouncer in transaction mode.
- Redis: 512 MB.

**The same on AWS**
- One school: ECS Fargate, 2 tasks of 1 vCPU and 2 GB behind an Application Load Balancer, a worker task of 0.5 vCPU and 1 GB; RDS PostgreSQL db.t4g.medium (2 vCPU, 4 GB) with 20 GB gp3 and automated backups; ElastiCache cache.t4g.micro.
- Five schools: 4 to 6 web tasks of 1 vCPU and 2 GB with target tracking on CPU, 2 worker tasks; RDS db.m7g.large or db.r7g.large (2 vCPU, 8 or 16 GB) with 100 GB gp3, Performance Insights and pg_stat_statements on; ElastiCache cache.t4g.small.

## What was and was not tested

Tested:
- One full-size school in a database that also holds the demo schools, with a year and two months of history.
- Every main page per role, sequentially, at full size; three peak scenarios with up to 100 people in flight and 1,000 different parents; real sign-in, real register saves through the server action, real PDFs.
- KG1 and KG2 shown correctly in English and Arabic on a 390px phone for a parent and an administrator, and paging through all 1,554 students (tests/e2e/scale.spec.ts, run with E2E_SCALE=1).

Not tested:
- Railway or AWS hardware, the network between families in the UAE and the hosting region, or a CDN for static files. Our client fetched HTML only; browsers also load scripts and styles (cached after the first visit) and run the page on the phone.
- More than one web process: the sizing for two or more replicas is extrapolated from one process.
- The worker under real fan-out (notifications, email, push and WhatsApp were seeded as rows, not sent), provider rate limits, Redis under load.
- Five full-size schools in one database, backups and restore times, and pg_stat_statements on real traffic.
