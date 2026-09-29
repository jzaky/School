// Requirements checker: compares a programme's listed requirements with a student's curriculum,
// subjects, results and test scores. Pure and deterministic; unit tested in tests/unit/pathways-checker.test.ts.
// It never decides admission. It only says which listed requirements look met, not met or unknown.
import { OVERALL, type CheckItem, type CheckResult, type CheckStatus, type ProgramForCheck, type ResultRow, type StudentForCheck, type TestRow } from "./types";

const A_LEVEL_SCALE = ["U", "E", "D", "C", "B", "A", "A*"];

/** Rank of an A-level grade (higher is better), or null when it is not a grade. */
export function aLevelRank(grade: string | null | undefined): number | null {
  if (!grade) return null;
  const g = grade.trim().toUpperCase();
  const i = A_LEVEL_SCALE.indexOf(g);
  return i < 0 ? null : i;
}

/** "A*A*A" -> ["A*","A*","A"]. Unknown letters are ignored. */
export function parseGradeProfile(profile: string | null | undefined): string[] {
  if (!profile) return [];
  const out: string[] = [];
  const s = profile.toUpperCase().replace(/\s+/g, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (!"ABCDEU".includes(c)) continue;
    if (s[i + 1] === "*") {
      out.push(`${c}*`);
      i++;
    } else out.push(c);
  }
  return out;
}

export function toNumber(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number.parseFloat(v.replace(/[%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

type Value = { value: string; provisional: boolean; unconfirmed: boolean };
const valueOf = (r: ResultRow): Value | null => {
  const v = (r.achieved ?? "").trim() || (r.predicted ?? "").trim();
  if (!v) return null;
  return { value: v, provisional: !(r.achieved ?? "").trim(), unconfirmed: !r.confirmed };
};

/** Compare a grade against a minimum. A-level letters for BRITISH, numbers for everything else. */
function meets(curriculum: string, have: string, min: string): boolean | null {
  if (curriculum === "BRITISH") {
    const h = aLevelRank(have);
    const m = aLevelRank(min);
    if (h !== null && m !== null) return h >= m;
  }
  const h = toNumber(have);
  const m = toNumber(min);
  if (h === null || m === null) return null;
  return h >= m;
}

function bestTest(tests: TestRow[], kind: string): TestRow | null {
  let best: TestRow | null = null;
  for (const t of tests) if (t.kind === kind && (!best || t.score > best.score)) best = t;
  return best;
}

export function checkRequirements(program: ProgramForCheck, student: StudentForCheck): CheckResult {
  const cur = student.curriculum;
  const reqs = program.requirements ?? {};
  const items: CheckItem[] = [];
  const taking = new Set(student.subjects);
  const offered = student.offered ? new Set(student.offered) : null;
  const isOffered = (code: string) => (offered ? offered.has(code) : null);
  const classesToTake: CheckResult["classesToTake"] = [];
  const overallRow = student.results.find((r) => r.subjectCode === OVERALL) ?? null;
  const overall = overallRow ? valueOf(overallRow) : null;

  const push = (item: CheckItem) => items.push(item);
  const flags = (v: Value | null) => (v ? { provisional: v.provisional, unconfirmed: v.unconfirmed } : {});
  const numericItem = (id: string, kind: CheckItem["kind"], required: number, v: Value | null, code?: string) => {
    const have = v ? toNumber(v.value) : null;
    const status: CheckStatus = have === null ? "unknown" : have >= required ? "met" : "not_met";
    push({ id, kind, code, status, required, have, ...flags(v) });
  };
  const resultFor = (code: string, levels: string[] | null) => {
    const rows = student.results.filter((r) => r.subjectCode === code && (!levels || levels.includes(r.level ?? "")));
    const withValue = rows.map((r) => valueOf(r)).filter((v): v is Value => v !== null);
    if (!withValue.length) return null;
    // Prefer the best value when there is more than one row.
    return withValue.sort((a, b) => (meets(cur, a.value, b.value) ? -1 : 1))[0];
  };

  // 1. Overall grades, points, GPA or average, and stream.
  let subjectMins: Array<{ code: string; min: string | null; levels: string[] | null }> = [];
  if (cur === "BRITISH" && reqs.BRITISH) {
    const r = reqs.BRITISH;
    const tokens = parseGradeProfile(r.grades);
    if (tokens.length) {
      const grades = student.results
        .filter((x) => x.subjectCode !== OVERALL && (x.level === "A_LEVEL" || x.level === null))
        .map((x) => valueOf(x))
        .filter((v): v is Value => v !== null && aLevelRank(v.value) !== null)
        .sort((a, b) => aLevelRank(b.value)! - aLevelRank(a.value)!);
      if (grades.length < tokens.length) {
        push({ id: "overall", kind: "overall", status: "unknown", required: tokens.join(""), have: grades.length ? grades.map((g) => g.value).join("") : null });
      } else {
        const top = grades.slice(0, tokens.length);
        const ok = top.every((g, i) => aLevelRank(g.value)! >= aLevelRank(tokens[i])!);
        push({ id: "overall", kind: "overall", status: ok ? "met" : "not_met", required: tokens.join(""), have: top.map((g) => g.value).join(""), provisional: top.some((g) => g.provisional), unconfirmed: top.some((g) => g.unconfirmed) });
      }
    }
    subjectMins = (r.subjects ?? []).map((s) => ({ code: s.code, min: s.min ?? null, levels: ["A_LEVEL"] }));
  } else if (cur === "IB" && reqs.IB) {
    const r = reqs.IB;
    if (r.points) {
      let v = overall;
      if (!v) {
        const six = student.results.filter((x) => x.level === "HL" || x.level === "SL").map((x) => valueOf(x)).filter((x): x is Value => x !== null);
        if (six.length >= 6) {
          const total = six.slice(0, 6).reduce((s, x) => s + (toNumber(x.value) ?? 0), 0);
          v = { value: String(total), provisional: six.some((x) => x.provisional), unconfirmed: six.some((x) => x.unconfirmed) };
        }
      }
      numericItem("overall", "overall", r.points, v);
    }
    subjectMins = [...(r.hl ?? []).map((s) => ({ code: s.code, min: s.min ?? null, levels: ["HL"] })), ...(r.sl ?? []).map((s) => ({ code: s.code, min: s.min ?? null, levels: ["HL", "SL"] }))];
  } else if (cur === "AMERICAN" && reqs.AMERICAN) {
    const r = reqs.AMERICAN;
    if (r.gpa) numericItem("overall", "overall", r.gpa, overall);
    subjectMins = (r.ap ?? []).map((s) => ({ code: s.code, min: s.min ?? null, levels: ["AP"] }));
  } else if (cur === "UAE_MOE" && reqs.UAE_MOE) {
    const r = reqs.UAE_MOE;
    if (r.streams?.length) {
      const stream = overallRow?.level ?? null;
      push({ id: "stream", kind: "stream", status: stream ? (r.streams.includes(stream) ? "met" : "not_met") : "unknown", required: r.streams.join(","), have: stream });
    }
    if (r.average) numericItem("overall", "overall", r.average, overall);
  } else if (cur === "JORDAN_TAWJIHI" && reqs.JORDAN_TAWJIHI) {
    const r = reqs.JORDAN_TAWJIHI;
    const stream = overallRow?.level ?? null;
    if (r.streams?.length) {
      push({ id: "stream", kind: "stream", status: stream ? (r.streams.includes(stream) ? "met" : "not_met") : "unknown", required: r.streams.join(","), have: stream });
    }
    const avg = (stream && r.byStream?.[stream]) || r.average;
    if (avg) numericItem("overall", "overall", avg, overall);
  }

  // 2. Required subjects. The Tawjihi and UAE MoE streams already fix the subjects, so the stream check covers them there.
  const streamBased = cur === "UAE_MOE" || cur === "JORDAN_TAWJIHI";
  if (!streamBased) {
    const seen = new Set(subjectMins.map((s) => s.code));
    for (const code of program.requiredSubjects) if (!seen.has(code)) subjectMins.push({ code, min: null, levels: null });
    for (const s of subjectMins) {
      const v = resultFor(s.code, s.levels);
      const isTaking = taking.has(s.code);
      if (v && s.min) {
        const ok = meets(cur, v.value, s.min);
        push({ id: `subject:${s.code}`, kind: "subject", code: s.code, status: ok === null ? "unknown" : ok ? "met" : "not_met", required: s.min, have: v.value, taking: isTaking, offered: isOffered(s.code), ...flags(v) });
      } else if (v || (isTaking && !s.min)) {
        push({ id: `subject:${s.code}`, kind: "subject", code: s.code, status: "met", required: s.min, have: v?.value ?? null, taking: isTaking, offered: isOffered(s.code), ...flags(v) });
      } else if (isTaking) {
        // Taking it, no grade recorded yet.
        push({ id: `subject:${s.code}`, kind: "subject", code: s.code, status: "unknown", required: s.min, have: null, taking: true, offered: isOffered(s.code) });
      } else {
        push({ id: `subject:${s.code}`, kind: "subject", code: s.code, status: "not_met", required: s.min, have: null, taking: false, offered: isOffered(s.code) });
        classesToTake.push({ code: s.code, required: true, offered: isOffered(s.code) });
      }
    }
    for (const code of program.recommendedSubjects) {
      if (seen.has(code) || program.requiredSubjects.includes(code)) continue;
      const has = taking.has(code) || resultFor(code, null) !== null;
      push({ id: `recommended:${code}`, kind: "recommended", code, status: has ? "met" : "not_met", optional: true, taking: taking.has(code), offered: isOffered(code) });
      if (!has) classesToTake.push({ code, required: false, offered: isOffered(code) });
    }
  }

  // 3. Tests: SAT/ACT for the American route, EmSAT for UAE MoE, admissions tests for everyone.
  if (cur === "AMERICAN" && reqs.AMERICAN && reqs.AMERICAN.testPolicy !== "BLIND") {
    const r = reqs.AMERICAN;
    const policy = r.testPolicy ?? "OPTIONAL";
    const sat = bestTest(student.tests, "SAT");
    const act = bestTest(student.tests, "ACT");
    const optional = policy === "OPTIONAL";
    let status: CheckStatus;
    let required: number | null = null;
    let have: number | null = null;
    let code = "SAT";
    if (r.sat || r.act) {
      const satOk = sat && r.sat ? sat.score >= r.sat : false;
      const actOk = act && r.act ? act.score >= r.act : false;
      if (satOk || actOk) status = "met";
      else if (sat || act) status = "not_met";
      else status = optional ? "unknown" : "not_met";
      code = sat || !act ? "SAT" : "ACT";
      required = code === "SAT" ? (r.sat ?? null) : (r.act ?? null);
      have = code === "SAT" ? (sat?.score ?? null) : (act?.score ?? null);
    } else {
      status = sat || act ? "met" : optional ? "unknown" : "not_met";
      code = sat || !act ? "SAT" : "ACT";
      have = (sat ?? act)?.score ?? null;
    }
    const used = code === "SAT" ? sat : act;
    push({ id: "test:SAT_ACT", kind: "test", code, status, required, have, optional, policy, alternatives: ["SAT", "ACT"], unconfirmed: used ? !used.confirmed : undefined });
  }
  if (cur === "UAE_MOE" && reqs.UAE_MOE?.emsat) {
    for (const e of reqs.UAE_MOE.emsat) {
      const t = bestTest(student.tests, e.kind);
      const status: CheckStatus = !t ? "not_met" : e.min ? (t.score >= e.min ? "met" : "not_met") : "met";
      push({ id: `test:${e.kind}`, kind: "test", code: e.kind, status, required: e.min ?? null, have: t?.score ?? null, unconfirmed: t ? !t.confirmed : undefined });
    }
  }
  for (const kind of reqs.admissionsTests ?? []) {
    const t = bestTest(student.tests, kind);
    push({ id: `admissions:${kind}`, kind: "admissionsTest", code: kind, status: t ? "met" : "not_met", required: null, have: t?.score ?? null, unconfirmed: t ? !t.confirmed : undefined });
  }

  // 4. English. Any one accepted test is enough.
  const en = program.englishReq;
  if (en) {
    const alts: Array<{ kind: string; min: number }> = [];
    if (en.ielts) alts.push({ kind: "IELTS", min: en.ielts });
    if (en.toefl) alts.push({ kind: "TOEFL", min: en.toefl });
    if (en.emsatEnglish) alts.push({ kind: "EMSAT_ENGLISH", min: en.emsatEnglish });
    if (alts.length) {
      const scored = alts.map((a) => ({ ...a, t: bestTest(student.tests, a.kind) }));
      const ok = scored.find((s) => s.t && s.t.score >= s.min);
      const tried = scored.find((s) => s.t);
      const pick = ok ?? tried ?? scored[0];
      push({
        id: "english",
        kind: "english",
        code: pick.kind,
        status: ok ? "met" : tried ? "not_met" : "unknown",
        required: pick.min,
        have: pick.t?.score ?? null,
        alternatives: alts.map((a) => a.kind),
        unconfirmed: pick.t ? !pick.t.confirmed : undefined,
      });
    }
  }

  const counted = items.filter((i) => !i.optional);
  const scoreGaps = items
    .filter((i) => i.status === "not_met" && typeof i.required === "number" && typeof i.have === "number")
    .map((i) => ({ code: i.kind === "overall" ? OVERALL : (i.code ?? i.id), required: i.required as number, have: i.have as number }));
  return {
    curriculum: cur,
    listed: cur !== "OTHER" && !!reqs[cur as keyof typeof reqs],
    items,
    summary: {
      met: counted.filter((i) => i.status === "met").length,
      notMet: counted.filter((i) => i.status === "not_met").length,
      unknown: counted.filter((i) => i.status === "unknown").length,
    },
    classesToTake,
    scoreGaps,
  };
}
