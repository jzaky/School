import { describe, expect, it } from "vitest";
import { matchCareers, reasoning, scoreAssessment, suggestCategory } from "@/server/career/scoring";
import { DIMENSIONS } from "@/server/career/dimensions";
import { APTITUDE_QUESTIONS } from "../../prisma/seed/data/aptitude";
import { CAREERS } from "../../prisma/seed/data/careers";

const questions = APTITUDE_QUESTIONS.map((q, i) => ({ id: `q${i}`, dimension: q.dimension, reverse: Boolean(q.reverse) }));
const careers = CAREERS.map((c) => ({ id: c.key, key: c.key, weights: c.weights, subjects: c.subjects }));

function answersFor(strong: string[]) {
  return Object.fromEntries(
    questions.map((q) => {
      const likes = strong.includes(q.dimension);
      const v = likes ? 5 : 2;
      return [q.id, q.reverse ? 6 - v : v];
    }),
  );
}

describe("aptitude scoring", () => {
  it("scores every dimension 0 to 100 and handles reverse items", () => {
    const s = scoreAssessment(questions, answersFor(["analytical"]));
    expect(Object.keys(s).sort()).toEqual([...DIMENSIONS].sort());
    expect(s.analytical).toBe(100);
    expect(s.social).toBe(25);
  });

  it("is deterministic", () => {
    const a = answersFor(["creative", "social"]);
    expect(matchCareers(scoreAssessment(questions, a), careers, [])).toEqual(matchCareers(scoreAssessment(questions, a), careers, []));
  });

  it("shows AI Engineer among the six match cards for an analytical, investigative, technical student", () => {
    const scores = scoreAssessment(questions, answersFor(["analytical", "investigative", "technical", "organized"]));
    const top = matchCareers(scores, careers, ["MATH", "PHYS"]).slice(0, 6).map((m) => m.key);
    expect(top).toContain("ai_engineer");
  });

  it("points a creative, social student somewhere else", () => {
    const scores = scoreAssessment(questions, answersFor(["creative", "social", "verbal"]));
    const top = matchCareers(scores, careers, ["ART", "ENG"]).slice(0, 5).map((m) => m.key);
    expect(top).not.toContain("ai_engineer");
  });

  it("match scores stay in a readable range and reasoning is bilingual", () => {
    const scores = scoreAssessment(questions, answersFor(["analytical", "technical"]));
    const m = matchCareers(scores, careers, ["MATH"]);
    for (const x of m) {
      expect(x.matchScore).toBeGreaterThanOrEqual(35);
      expect(x.matchScore).toBeLessThanOrEqual(97);
    }
    const r = reasoning(m[0], { en: "AI Engineer", ar: "مهندس ذكاء اصطناعي" });
    expect(r.en).toMatch(/strengths/);
    expect(r.ar).toMatch(/نقاط قوتك/);
  });

  it("suggests reach, target and safety universities", () => {
    expect(suggestCategory(8)).toBe("REACH");
    expect(suggestCategory(40)).toBe("TARGET");
    expect(suggestCategory(75)).toBe("SAFETY");
  });
});
