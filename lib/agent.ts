// The agentic loop: query → criteria extraction → Typesense BM25 → Claude rerank.
import { getAnthropic, MODEL } from "./anthropic";
import {
  CANDIDATES_COLLECTION,
  getTypesenseClient,
} from "./typesense";
import type {
  CandidateDoc,
  RankedCandidate,
  SearchCriteria,
  Seniority,
} from "./types";

const EXTRACTION_SYSTEM = `You are the planning step of an agentic recruiter.
Given a recruiter's natural-language query or a pasted job description, extract a structured search plan.
Return ONLY valid JSON matching this TypeScript type:
{
  "roles": string[],              // role titles to target, e.g. ["full-stack engineer", "founding engineer"]
  "seniority": ("junior"|"mid"|"senior"|"staff"|"principal")[],
  "skills": string[],             // required or strongly desired skills
  "excludeSkills": string[],      // disqualifiers
  "locations": string[],          // cities/regions/timezones, e.g. ["San Francisco", "Remote", "LatAm"]
  "companyTypes": string[],       // e.g. ["YC", "early-stage", "recruiting", "FAANG"]
  "minYears": number | null,
  "maxYears": number | null,
  "freeText": string              // 1-2 sentence semantic summary for full-text search
}
Be aggressive but realistic. If the user says "founding engineer", seniority is ["mid","senior","staff"].
If the user mentions "scrappy" or "hacker-house", note that in freeText.
Output JSON only — no prose, no code fences.`;

const RERANK_SYSTEM = `You are the ranking step of an agentic recruiter.
Given a search plan and a shortlist of candidates from a keyword index, rerank them and explain.
For each candidate, output an object with:
  - "id": string  (the candidate's id)
  - "score": integer 0-100  (overall fit)
  - "reasons": string[]  (1-3 short, specific positive reasons — cite concrete profile facts)
  - "concerns": string[] (0-2 short concerns or gaps)
Return ONLY a JSON array, ordered best-to-worst, NO prose, NO code fences.
Be honest: candidates who are a poor fit should score below 40 and surface concerns.
Reward signals like: matching skills, matching seniority, willingness to be in the right location, recruiting-domain experience, founding-engineer mindset, active GitHub, YC/early-stage background.`;

function safeJsonExtract<T>(text: string): T {
  // Strip code fences if Claude added them despite instructions.
  let s = text.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  return JSON.parse(s) as T;
}

export async function extractCriteria(query: string): Promise<SearchCriteria> {
  const anthropic = getAnthropic();
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: EXTRACTION_SYSTEM,
    messages: [{ role: "user", content: query }],
  });

  const text = res.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");

  const parsed = safeJsonExtract<Partial<SearchCriteria>>(text);
  return {
    roles: parsed.roles ?? [],
    seniority: (parsed.seniority ?? []) as Seniority[],
    skills: parsed.skills ?? [],
    excludeSkills: parsed.excludeSkills ?? [],
    locations: parsed.locations ?? [],
    companyTypes: parsed.companyTypes ?? [],
    minYears: parsed.minYears ?? null,
    maxYears: parsed.maxYears ?? null,
    freeText: parsed.freeText ?? query,
  };
}

function buildTypesenseQuery(criteria: SearchCriteria) {
  // BM25 across weighted fields. We deliberately keep filters loose
  // (skills + free-text in the query, soft year band as filter only when set)
  // and let the LLM rerank pass do the precision work.
  const filters: string[] = [];
  if (criteria.minYears !== null) {
    filters.push(`yearsExperience:>=${criteria.minYears}`);
  }
  if (criteria.maxYears !== null) {
    filters.push(`yearsExperience:<=${criteria.maxYears}`);
  }

  const queryParts = [
    ...(criteria.skills ?? []),
    ...(criteria.roles ?? []),
    ...(criteria.locations ?? []),
    criteria.freeText ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    q: queryParts || "*",
    query_by: "skills,headline,summary,currentRole,pastCompanies,locations",
    query_by_weights: "5,3,3,2,2,2",
    filter_by: filters.join(" && "),
    // Cap the rerank set to stay under Vercel's serverless duration ceiling.
    // 12 is the sweet spot: enough candidates for the LLM rerank to be meaningful,
    // few enough that the two-call agent loop stays well under 60s.
    per_page: 12,
    drop_tokens_threshold: 10,
    typo_tokens_threshold: 5,
    num_typos: 2,
    prioritize_token_position: true,
  };
}

export async function searchCandidates(
  criteria: SearchCriteria
): Promise<{ docs: CandidateDoc[]; totalScanned: number }> {
  const ts = getTypesenseClient();
  const result = await ts
    .collections(CANDIDATES_COLLECTION)
    .documents()
    .search(buildTypesenseQuery(criteria));

  const hits = result.hits ?? [];
  const docs: CandidateDoc[] = hits.map((h) => h.document as CandidateDoc);
  return { docs, totalScanned: result.found ?? docs.length };
}

export async function rerankWithLLM(
  criteria: SearchCriteria,
  docs: CandidateDoc[]
): Promise<RankedCandidate[]> {
  if (docs.length === 0) return [];

  const anthropic = getAnthropic();
  const payload = {
    criteria,
    candidates: docs.map((d) => ({
      id: d.id,
      name: d.name,
      headline: d.headline,
      summary: d.summary,
      skills: d.skills,
      seniority: d.seniority,
      yearsExperience: d.yearsExperience,
      locations: d.locations,
      currentCompany: d.currentCompany,
      currentRole: d.currentRole,
      pastCompanies: d.pastCompanies,
    })),
  };

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: RERANK_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Search plan + shortlist:\n${JSON.stringify(payload)}`,
      },
    ],
  });

  const text = res.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");

  type RankRow = {
    id: string;
    score: number;
    reasons: string[];
    concerns?: string[];
  };
  const ranked = safeJsonExtract<RankRow[]>(text);

  const byId = new Map(docs.map((d) => [d.id, d]));
  const out: RankedCandidate[] = [];
  for (const r of ranked) {
    const cand = byId.get(r.id);
    if (!cand) continue;
    out.push({
      candidate: cand,
      score: Math.max(0, Math.min(100, Math.round(r.score))),
      reasons: r.reasons ?? [],
      concerns: r.concerns ?? [],
    });
  }
  return out;
}

export type OutreachAngle = "craft" | "mission" | "culture";

export interface OutreachVariant {
  angle: OutreachAngle;
  angleLabel: string;
  subject: string;
  body: string;
  critique: {
    score: number; // 0-100
    strength: string;
    weakness: string;
  };
}

const ANGLE_LABELS: Record<OutreachAngle, string> = {
  craft: "Craft-fit",
  mission: "Mission / domain",
  culture: "Culture / LatAm",
};

const ANGLE_INSTRUCTIONS: Record<OutreachAngle, string> = {
  craft:
    "Lead with the candidate's CRAFT — cite the most specific technical thing they've shipped that maps to this role's stack. Make them feel seen as an engineer.",
  mission:
    "Lead with the MISSION / domain alignment — why this candidate's stated interests or past roles in the recruiting/talent-AI space make Clera the obvious next step. Skip generic 'passion'.",
  culture:
    "Lead with the LIFESTYLE / culture angle — Clera operates out of SF and LatAm hacker-houses; if the candidate is based in or open to LatAm, lean in (cite a specific city if their profile shows one). Treat this as a real fit signal, not a gimmick.",
};

const VARIANT_SYSTEM = `You draft cold recruiter outreach as three angled VARIANTS for the same candidate.
Each variant must:
- Lead with the assigned angle in the first sentence.
- Be 80-130 words in the body.
- Reference 1-2 CONCRETE details from the candidate's profile (do not invent facts).
- End with a low-friction CTA (one clear question, e.g. "open to a 15-min chat next week?").
- Have NO emojis, NO "I hope this finds you well", NO buzzwords ("passionate", "rockstar", "ninja").
- Subjects must be under 60 chars, lowercase, no clickbait.
Additionally, for each variant, output a self-critique:
- score: 0-100 honest grade on personalization + specificity + CTA
- strength: one short sentence — the best line in this variant
- weakness: one short sentence — the weakest part or the thing a skeptical recruiter would push back on
Return ONLY valid JSON of shape:
{ "variants": [ { "angle": "craft"|"mission"|"culture", "subject": string, "body": string, "critique": { "score": number, "strength": string, "weakness": string } } ] }
No prose, no code fences.`;

export async function generateOutreach(opts: {
  candidate: CandidateDoc;
  query: string;
  recruiterName?: string;
  companyName?: string;
  companyPitch?: string;
}): Promise<{ variants: OutreachVariant[] }> {
  const {
    candidate,
    query,
    recruiterName = "Anish",
    companyName = "Clera",
    companyPitch = "an early-stage SF/LatAm startup building a fully agentic system that automates headhunting end-to-end",
  } = opts;

  const anthropic = getAnthropic();
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2400,
    system: VARIANT_SYSTEM,
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          recruiterName,
          companyName,
          companyPitch,
          originalQuery: query,
          candidate: {
            name: candidate.name,
            headline: candidate.headline,
            summary: candidate.summary,
            skills: candidate.skills,
            currentRole: candidate.currentRole,
            currentCompany: candidate.currentCompany,
            pastCompanies: candidate.pastCompanies,
            locations: candidate.locations,
          },
          angles: (Object.keys(ANGLE_INSTRUCTIONS) as OutreachAngle[]).map(
            (a) => ({ angle: a, instruction: ANGLE_INSTRUCTIONS[a] })
          ),
        }),
      },
    ],
  });

  const text = res.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
  const parsed = safeJsonExtract<{ variants: Omit<OutreachVariant, "angleLabel">[] }>(
    text
  );

  // Sort so the order is always craft → mission → culture for stable UI.
  const order: OutreachAngle[] = ["craft", "mission", "culture"];
  const byAngle = new Map(parsed.variants.map((v) => [v.angle, v]));
  const variants: OutreachVariant[] = [];
  for (const a of order) {
    const v = byAngle.get(a);
    if (!v) continue;
    variants.push({
      angle: a,
      angleLabel: ANGLE_LABELS[a],
      subject: v.subject,
      body: v.body,
      critique: {
        score: Math.max(0, Math.min(100, Math.round(v.critique?.score ?? 0))),
        strength: v.critique?.strength ?? "",
        weakness: v.critique?.weakness ?? "",
      },
    });
  }
  return { variants };
}
