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
    per_page: 25,
    // Recall over precision at the BM25 stage — let the LLM rerank handle precision.
    // Without this, multi-skill queries collapse to ~1 result because every token must hit.
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

export async function generateOutreach(opts: {
  candidate: CandidateDoc;
  query: string;
  recruiterName?: string;
  companyName?: string;
  companyPitch?: string;
}): Promise<{ subject: string; body: string }> {
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
    max_tokens: 800,
    system: `You draft short, specific recruiter outreach.
Constraints:
- 90-140 words in the body.
- Reference 1-2 concrete details from the candidate's profile (do not invent facts).
- Tie the role to the candidate's stated interests / domain.
- No emojis. No "I hope this finds you well". No buzzwords like "passionate" or "rockstar".
- End with a low-friction CTA (a single question).
Return ONLY JSON: { "subject": string, "body": string }. No prose, no fences.`,
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
          },
        }),
      },
    ],
  });

  const text = res.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
  return safeJsonExtract<{ subject: string; body: string }>(text);
}
