// Shared types for the agent loop.

export type Seniority = "junior" | "mid" | "senior" | "staff" | "principal";

export interface SearchCriteria {
  roles: string[];
  seniority: Seniority[];
  skills: string[];
  excludeSkills: string[];
  locations: string[];
  companyTypes: string[]; // e.g. "yc", "faang", "fintech", "early-stage"
  minYears: number | null;
  maxYears: number | null;
  freeText: string; // natural-language summary used for full-text query
}

export interface CandidateDoc {
  id: string;
  name: string;
  headline: string;
  summary: string;
  skills: string[];
  seniority: string;
  locations: string[];
  currentCompany: string;
  currentRole: string;
  pastCompanies: string[];
  yearsExperience: number;
  githubUrl?: string;
  linkedinUrl?: string;
}

export interface RankedCandidate {
  candidate: CandidateDoc;
  score: number; // 0-100
  reasons: string[];
  concerns: string[];
}

export interface SearchResponse {
  criteria: SearchCriteria;
  candidates: RankedCandidate[];
  totalCandidatesScanned: number;
  tookMs: number;
}
