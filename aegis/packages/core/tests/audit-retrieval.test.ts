import { describe, expect, it } from "vitest";
import { Bm25Index, lexicalOverlap, policyPhrasesIn, stem, tokenize } from "../src/audit/retrieval.js";
import { chunkText, estimateTokens, normaliseWhitespace } from "../src/audit/documents.js";
import { classify, excerptOf, recommendationFor } from "../src/audit/assessments.js";
import { importControlsCsv } from "../src/audit/frameworks.js";

describe("tokeniser and stemmer", () => {
  it("lowercases, strips punctuation, drops stopwords and stems", () => {
    expect(tokenize("The Policies ARE reviewed annually, approved by the CISO!")).toEqual(["policy", "review", "annual", "approv", "ciso"]);
    expect(stem("response")).toBe(stem("responses"));
    expect(stem("incidents")).toBe("incident");
    expect(stem("management")).toBe(stem("manage"));
    expect(stem("managing")).toBe(stem("manage"));
    expect(stem("monitoring")).toBe("monitor");
    expect(stem("bias")).toBe("bias");
  });
  it("drops purely numeric tokens such as account or reference numbers", () => {
    expect(tokenize("Account 1234567890 and IBAN 98765 reviewed")).toEqual(["account", "iban", "review"]);
  });
  it("is deterministic", () => {
    const a = tokenize("Access control shall be reviewed quarterly by asset owners");
    expect(tokenize("Access control shall be reviewed quarterly by asset owners")).toEqual(a);
  });
});

describe("chunking", () => {
  const words = Array.from({ length: 2000 }, (_, i) => `w${i}`).join(" ");
  it("splits into overlapping word windows of roughly 800 tokens", () => {
    const chunks = chunkText(words);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0]!.idx).toBe(0);
    expect(chunks[0]!.tokens).toBeGreaterThanOrEqual(780);
    expect(chunks[0]!.tokens).toBeLessThanOrEqual(820);
    const firstWordsOfSecond = chunks[1]!.text.split(" ").slice(0, 5);
    expect(chunks[0]!.text.split(" ")).toEqual(expect.arrayContaining(firstWordsOfSecond));
    const all = new Set(chunks.flatMap((c) => c.text.split(" ")));
    expect(all.size).toBe(2000);
    expect(chunks.every((c) => c.page === null)).toBe(true);
  });
  it("records the page a chunk starts on when form feeds separate pages", () => {
    const chunks = chunkText("alpha beta\fgamma delta\fepsilon", { chunkTokens: 3, overlapTokens: 0 });
    expect(chunks.map((c) => c.page)).toEqual([1, 2, 3]);
  });
  it("returns no chunks for empty text and estimates tokens as words * 1.3", () => {
    expect(chunkText("   ")).toEqual([]);
    expect(estimateTokens("one two three four")).toBe(5);
    expect(normaliseWhitespace("a  b\r\n\r\n\r\n\r\nc\t d")).toBe("a b\n\nc d");
  });
});

describe("BM25 index", () => {
  const corpus = [
    { id: "access", text: "Access control. Access rights are granted on a least privilege basis and reviewed quarterly by asset owners. Multi-factor authentication is mandatory." },
    { id: "incident", text: "Incident response procedure. Security incidents are detected, assessed, contained and recovered. The Incident Commander is responsible for containment and the post-incident review." },
    { id: "backup", text: "Backups of information and systems are taken daily and restores are tested twice a year according to the backup standard." },
  ];
  const index = new Bm25Index(corpus);
  it("ranks the chunk about the query topic first with scores in 0..1", () => {
    const hits = index.search("incident response procedure containment", 3);
    expect(hits[0]!.chunkId).toBe("incident");
    expect(hits[0]!.normalisedScore).toBeGreaterThan(0.5);
    expect(hits[0]!.normalisedScore).toBeLessThanOrEqual(1);
    expect(hits.every((h) => h.score > 0)).toBe(true);
    expect(index.search("access rights least privilege", 1)[0]!.chunkId).toBe("access");
  });
  it("returns nothing for stopword-only queries or unknown terms", () => {
    expect(index.search("the and of", 5)).toEqual([]);
    expect(index.search("zebra giraffe", 5)).toEqual([]);
  });
  it("is deterministic across runs", () => {
    expect(index.search("backup restore tested", 3)).toEqual(new Bm25Index(corpus).search("backup restore tested", 3));
  });
  it("computes keyword overlap as the fraction of keywords present", () => {
    expect(lexicalOverlap(["least privilege", "multi-factor authentication", "cabling"], corpus[0]!.text)).toBeCloseTo(2 / 3, 3);
    expect(lexicalOverlap([], "anything")).toBe(0);
    expect(policyPhrasesIn("Access shall be reviewed annually and approved by the CISO")).toEqual(["shall", "reviewed annually", "approved by"]);
  });
});

describe("classification", () => {
  const hit = (s: number) => ({ chunkId: "c", score: s * 10, normalisedScore: s, termCoverage: s });
  it("applies the documented thresholds", () => {
    expect(classify({ best: hit(0.7), hits: [], overlap: 0.6, policyPhrases: ["shall"], automated: null }).status).toBe("covered");
    expect(classify({ best: hit(0.35), hits: [], overlap: 0.4, policyPhrases: [], automated: { type: "monitoring", present: true, reference: "aegis:x", detail: "" } }).status).toBe("covered");
    expect(classify({ best: hit(0.45), hits: [], overlap: 0.3, policyPhrases: ["must"], automated: null }).status).toBe("partial");
    expect(classify({ best: hit(0.25), hits: [], overlap: 0.1, policyPhrases: [], automated: null }).status).toBe("ambiguous");
    expect(classify({ best: hit(0.1), hits: [], overlap: 0, policyPhrases: [], automated: null }).status).toBe("missing");
    expect(classify({ best: null, hits: [], overlap: 0, policyPhrases: [], automated: null }).status).toBe("missing");
  });
  it("treats AEGIS records without document support as conflicting signals", () => {
    const c = classify({ best: hit(0.1), hits: [], overlap: 0, policyPhrases: [], automated: { type: "approval_workflow", present: true, reference: "aegis:approval_requests:count=3", detail: "" } });
    expect(c.status).toBe("ambiguous");
    expect(c.confidence).toBeCloseTo(0.25, 3);
  });
  it("produces a confidence of min(1, 0.5 score + 0.3 overlap + 0.2 automated)", () => {
    expect(classify({ best: hit(1), hits: [], overlap: 1, policyPhrases: [], automated: { type: "monitoring", present: true, reference: "r", detail: "" } }).confidence).toBe(1);
    expect(classify({ best: hit(0.5), hits: [], overlap: 0.5, policyPhrases: [], automated: null }).confidence).toBeCloseTo(0.4, 3);
  });
  it("templates recommendations and bounds excerpts", () => {
    expect(recommendationFor("missing", { title: "Logging", summary: "Logs are kept." }, null)).toContain("Document and implement \"Logging\"");
    expect(excerptOf("x".repeat(1000)).length).toBeLessThanOrEqual(400);
    expect(excerptOf("short")).toBe("short");
  });
});

describe("CSV control import", () => {
  it("parses quoted fields and keyword lists", () => {
    const rows = importControlsCsv('code,title,summary,category,keywords\nC-1,"Logging, central","Logs are kept, protected",Tech,"logs;audit trail|retention"\nC-2,Backups,,Ops,\n');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ code: "C-1", title: "Logging, central", category: "Tech", keywords: ["logs", "audit trail", "retention"] });
    expect(rows[1]!.keywords).toEqual([]);
  });
  it("rejects missing headers and duplicate codes", () => {
    expect(() => importControlsCsv("name,foo\nx,y")).toThrow(/code and title/);
    expect(() => importControlsCsv("code,title\nA,One\nA,Two")).toThrow(/duplicate/);
  });
});
