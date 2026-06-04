# Reasoning & Outreach Layer — a feature prototype for Clera

**Live demo:** https://clera-copilot.vercel.app/

> A drop-in candidate-decision panel that takes whatever candidate Clera's
> agentic recruiter has already surfaced, and produces (a) a structured fit
> memo and (b) three angled outreach variants — each self-graded.
>
> The search & rank UI in this demo is **the test harness**, not the value.
> The value is what happens after a candidate is in front of you.

## What the layer actually does

For any candidate the recruiter is considering, the agent produces:

1. **Fit memo** — concrete reasons this candidate fits, plus honest concerns
   the recruiter can take into the hiring-manager conversation. Grounded in
   profile facts, not invented.
2. **Three outreach variants**, each leading with a different angle:
   - **Craft-fit** — the most specific technical thing they've shipped
   - **Mission / domain** — why Clera (or this hiring company) is the obvious next step
   - **Culture / LatAm** — when the candidate's profile signals openness to LatAm hacker-houses, lean in
3. **Per-variant self-critique** — a 0-100 score plus one strength + one weakness
   per variant. Forces the agent to be honest about its own draft and gives the
   recruiter an A/B-able set instead of one take-it-or-leave-it message.

Why those two things? Real recruiters spend most of their time on *deciding*
about a candidate and *what to write*. Sourcing is largely automated already
(it's Clera's flagship). This is the last-mile.

## Stack — matches the JD exactly

**React (Next.js App Router) · TypeScript · Supabase (Postgres) · Prisma · Typesense · Tailwind · Anthropic Claude**

## Architecture

```
app/page.tsx              – single-page UI: query → criteria → ranked candidates → fit reasoning → 3 variants
app/api/search/route.ts   – the agent loop: extract criteria → Typesense BM25 → Claude rerank
app/api/outreach/route.ts – the value: 3 angled outreach variants + self-critique
app/api/candidates/[id]/status/route.ts – PATCH pipeline state
lib/agent.ts              – extractCriteria · searchCandidates · rerankWithLLM · generateOutreach (variants)
lib/typesense.ts          – Typesense client + collection schema
lib/prisma.ts             – Prisma singleton
prisma/schema.prisma      – Candidate + OutreachDraft + PipelineStatus
prisma/seed.ts            – seeds Postgres + Typesense in one command
prisma/seed-data.ts       – 40 synthetic candidates spanning the search space
```

## Quick start

```bash
cp .env.example .env              # fill in keys
npm install
npm run db:push                   # apply Prisma schema to Supabase
npm run db:seed                   # seed Postgres + Typesense (40 candidates)
npm run dev                       # http://localhost:3000
```

## What I'd build next, integrated into Clera's real product

- **Reply-aware learning loop** — when a variant gets a reply, increment its
  angle's weight for that recruiter; over a quarter the agent learns which
  angles land for whom.
- **Hiring-manager memo export** — the fit-reasoning panel becomes a one-click
  copy-as-markdown for Slack / Notion handoff.
- **Tone calibration** — recruiters paste 3 messages they've sent in the past
  and the agent matches their voice on every variant.
- **Eval harness** — labeled `(candidate, variant, replied)` tuples to track
  variant-quality drift across model + prompt changes.

Built by [Anish Lotake](https://github.com/anishthetechie) — built in ~90
minutes as a working artifact for the Clera founding-engineer-intern application.
