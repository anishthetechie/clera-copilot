# Clera Copilot

https://clera-copilot.vercel.app/

> An agentic candidate-sourcing demo built in one hour for the Clera founding engineer intern role.

You paste a job description (or just describe who you want in plain English). An LLM agent:

1. **Plans** — decomposes the request into structured criteria (roles, seniority, skills, locations, exclusions, free-text intent).
2. **Searches** — queries a Typesense candidate index with weighted BM25 across skills / headline / summary / pastCompanies / locations.
3. **Reranks** — calls Claude again with the shortlist and the plan, returning per-candidate fit scores, positive reasons, and concerns.
4. **Drafts outreach** — generates a short, specific recruiter email grounded in concrete profile facts.
5. **Tracks pipeline** — `NEW → CONTACTED → REPLIED → INTERVIEWING → PASSED` status persisted in Postgres.

Stack — exactly the one in the JD: **React (Next.js App Router) · TypeScript · Supabase (Postgres) · Prisma · Typesense · Tailwind · Anthropic Claude**.


## Quick start

```bash
cp .env.example .env.local        # fill in keys
npm install
npm run db:push                   # apply Prisma schema to Supabase
npm run db:seed                   # seed Postgres + Typesense (40 candidates)
npm run dev                       # http://localhost:3000
```

## Architecture

```
app/page.tsx              – single-page UI: query → criteria chips → ranked cards → outreach draft
app/api/search/route.ts   – the agent loop endpoint
app/api/outreach/route.ts – outreach drafting endpoint
app/api/candidates/[id]/status/route.ts – PATCH pipeline state
lib/agent.ts              – extractCriteria · searchCandidates · rerankWithLLM · generateOutreach
lib/typesense.ts          – Typesense client + collection schema
lib/prisma.ts             – Prisma singleton
prisma/schema.prisma      – Candidate + OutreachDraft + PipelineStatus
prisma/seed.ts            – seeds Postgres + Typesense in one command
prisma/seed-data.ts       – 40 synthetic candidates spanning the search space
```

## What I'd add next (with more than an hour)

- Vector embeddings on `summary` for true hybrid search (Typesense supports `vector_query` natively).
- Real GitHub sourcing: ingest from the GitHub search API, dedupe to the index nightly.
- Outreach reply tracking via an inbound webhook (Resend / Postmark) so the status auto-advances.
- Eval harness: a labeled set of `(query, expected top-K)` pairs to track ranking quality across model and prompt changes.
- Per-recruiter saved searches with diff alerts when new candidates match.

Built by [Anish Lotake](https://github.com/anishthetechie).
