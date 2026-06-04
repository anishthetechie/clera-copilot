"use client";

import { useState } from "react";
import type { RankedCandidate, SearchResponse } from "@/lib/types";

const EXAMPLES = [
  "Senior full-stack engineer, React + TS + Supabase + Prisma + Typesense. SF or LatAm. Bonus: recruiting domain or YC alum.",
  "Founding engineer mindset, scrappy, willing to work 7 days/week and live in hacker-houses. Strong TS. Active GitHub.",
  "Mid-level engineer in LatAm, used Prisma + Supabase in production, willing to relocate to SF.",
];

type OutreachVariant = {
  angle: "craft" | "mission" | "culture";
  angleLabel: string;
  subject: string;
  body: string;
  critique: { score: number; strength: string; weakness: string };
};

type OutreachState = {
  candidateId: string;
  loading: boolean;
  variants?: OutreachVariant[];
  error?: string;
};

export default function Page() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [outreach, setOutreach] = useState<OutreachState | null>(null);
  const [statuses, setStatuses] = useState<Record<string, string>>({});

  async function runSearch(q?: string) {
    const final = (q ?? query).trim();
    if (!final) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setOutreach(null);
    try {
      const r = await fetch("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: final }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      const data = (await r.json()) as SearchResponse;
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  async function draftOutreach(c: RankedCandidate) {
    if (!result) return;
    setOutreach({ candidateId: c.candidate.id, loading: true });
    try {
      const r = await fetch("/api/outreach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidateId: c.candidate.id, query }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      const data = (await r.json()) as { variants: OutreachVariant[] };
      setOutreach({
        candidateId: c.candidate.id,
        loading: false,
        variants: data.variants,
      });
    } catch (e) {
      setOutreach({
        candidateId: c.candidate.id,
        loading: false,
        error: e instanceof Error ? e.message : "Draft failed",
      });
    }
  }

  async function setStatus(candidateId: string, status: string) {
    setStatuses((s) => ({ ...s, [candidateId]: status }));
    try {
      await fetch(`/api/candidates/${candidateId}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
    } catch {
      /* visual already updated; non-blocking */
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10">
      <header className="mb-10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-md bg-gradient-to-br from-[var(--accent)] to-[var(--accent-hi)]" />
          <div>
            <div className="text-lg font-semibold">
              Reasoning &amp; Outreach Layer{" "}
              <span className="text-[var(--muted)]">— a feature for Clera</span>
            </div>
            <div className="text-xs text-[var(--muted)]">
              Per-candidate fit reasoning + 3 angled outreach variants, drafted &amp; self-graded.
              Search below is the test harness — drop the panel into Clera&apos;s existing candidate view.
            </div>
          </div>
        </div>
        <a
          href="https://github.com/anishthetechie/clera-copilot"
          className="mono text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
          target="_blank"
          rel="noreferrer"
        >
          github ↗
        </a>
      </header>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <label className="mono text-xs uppercase tracking-wider text-[var(--muted)]">
          Describe who you're hiring, or paste a JD
        </label>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. Founding engineer mindset, React + TS, Supabase + Prisma + Typesense in production, open to SF or LatAm hacker-houses…"
          rows={5}
          className="mt-2 w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--surface-elev)] p-3 text-sm leading-relaxed outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => {
                  setQuery(ex);
                  runSearch(ex);
                }}
                className="rounded-full border border-[var(--border)] bg-[var(--surface-elev)] px-3 py-1 text-xs text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--foreground)]"
              >
                {ex.slice(0, 60)}
                {ex.length > 60 ? "…" : ""}
              </button>
            ))}
          </div>
          <button
            onClick={() => runSearch()}
            disabled={loading || !query.trim()}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white shadow disabled:opacity-50"
          >
            {loading ? "Thinking…" : "Run agent"}
          </button>
        </div>
      </section>

      {error && (
        <div className="mt-6 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {loading && (
        <div className="mt-8 space-y-3">
          <div className="mono text-xs text-[var(--muted)]">
            → extracting criteria · → searching Typesense · → reranking with Claude
          </div>
          <div className="h-24 animate-pulse rounded-lg bg-[var(--surface)]" />
          <div className="h-24 animate-pulse rounded-lg bg-[var(--surface)]" />
          <div className="h-24 animate-pulse rounded-lg bg-[var(--surface)]" />
        </div>
      )}

      {result && !loading && (
        <>
          <section className="mt-8">
            <div className="mono mb-3 text-xs uppercase tracking-wider text-[var(--muted)]">
              Agent plan ({result.tookMs}ms · scanned {result.totalCandidatesScanned})
            </div>
            <CriteriaChips criteria={result.criteria} />
          </section>

          <section className="mt-6 space-y-3">
            <div className="mono text-xs uppercase tracking-wider text-[var(--muted)]">
              Ranked candidates
            </div>
            {result.candidates.length === 0 && (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">
                No matches. Try widening the criteria.
              </div>
            )}
            {result.candidates.map((c) => (
              <CandidateCard
                key={c.candidate.id}
                c={c}
                outreach={outreach?.candidateId === c.candidate.id ? outreach : null}
                onDraftOutreach={() => draftOutreach(c)}
                status={statuses[c.candidate.id] ?? "NEW"}
                onStatus={(s) => setStatus(c.candidate.id, s)}
              />
            ))}
          </section>
        </>
      )}

      <footer className="mt-16 border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]">
        A feature prototype, not a competing product — the value is the{" "}
        <span className="text-[var(--foreground)]/80">post-search reasoning + outreach panel</span>{" "}
        that would plug into Clera&apos;s candidate detail view.{" "}
        <span className="mono">Claude · Next.js · Supabase · Prisma · Typesense</span>
      </footer>
    </main>
  );
}

function CriteriaChips({ criteria }: { criteria: SearchResponse["criteria"] }) {
  const groups: { label: string; items: string[] }[] = [
    { label: "roles", items: criteria.roles },
    { label: "seniority", items: criteria.seniority },
    { label: "skills", items: criteria.skills },
    { label: "exclude", items: criteria.excludeSkills },
    { label: "locations", items: criteria.locations },
    { label: "company", items: criteria.companyTypes },
  ];
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="space-y-2">
        {groups
          .filter((g) => g.items.length > 0)
          .map((g) => (
            <div key={g.label} className="flex flex-wrap items-baseline gap-2">
              <span className="mono w-20 text-xs uppercase text-[var(--muted)]">
                {g.label}
              </span>
              {g.items.map((it) => (
                <span
                  key={`${g.label}-${it}`}
                  className={`rounded-md border px-2 py-0.5 text-xs ${
                    g.label === "exclude"
                      ? "border-red-500/30 bg-red-500/10 text-red-200"
                      : "border-[var(--border)] bg-[var(--surface-elev)]"
                  }`}
                >
                  {it}
                </span>
              ))}
            </div>
          ))}
        {(criteria.minYears !== null || criteria.maxYears !== null) && (
          <div className="flex items-baseline gap-2">
            <span className="mono w-20 text-xs uppercase text-[var(--muted)]">
              years
            </span>
            <span className="rounded-md border border-[var(--border)] bg-[var(--surface-elev)] px-2 py-0.5 text-xs">
              {criteria.minYears ?? 0}–{criteria.maxYears ?? "∞"}
            </span>
          </div>
        )}
        {criteria.freeText && (
          <div className="pt-1 text-xs italic text-[var(--muted)]">
            “{criteria.freeText}”
          </div>
        )}
      </div>
    </div>
  );
}

function VariantCard({ v }: { v: OutreachVariant }) {
  const angleTint =
    v.angle === "craft"
      ? "border-sky-500/30 bg-sky-500/5"
      : v.angle === "mission"
        ? "border-violet-500/30 bg-violet-500/5"
        : "border-emerald-500/30 bg-emerald-500/5";
  const scoreTint =
    v.critique.score >= 80
      ? "text-emerald-300"
      : v.critique.score >= 60
        ? "text-amber-200"
        : "text-zinc-400";
  return (
    <div className={`rounded-lg border ${angleTint} p-3`}>
      <div className="flex items-center justify-between gap-2">
        <div className="mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
          {v.angleLabel}
        </div>
        <div className={`mono text-xs font-medium ${scoreTint}`}>
          {v.critique.score}/100
        </div>
      </div>
      <div className="mt-2 text-xs font-medium leading-snug">{v.subject}</div>
      <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--foreground)]/90">
        {v.body}
      </pre>
      <div className="mono mt-3 text-[10px] uppercase tracking-wider text-emerald-300">
        + strength
      </div>
      <div className="text-xs text-[var(--foreground)]/80">{v.critique.strength}</div>
      <div className="mono mt-2 text-[10px] uppercase tracking-wider text-amber-300">
        ! weakness
      </div>
      <div className="text-xs text-[var(--foreground)]/80">{v.critique.weakness}</div>
      <button
        onClick={() =>
          navigator.clipboard.writeText(`Subject: ${v.subject}\n\n${v.body}`)
        }
        className="mono mt-3 rounded border border-[var(--border)] px-2 py-1 text-[10px] uppercase tracking-wider text-[var(--muted)] hover:text-[var(--foreground)]"
      >
        copy
      </button>
    </div>
  );
}

const STATUS_OPTIONS = ["NEW", "CONTACTED", "REPLIED", "INTERVIEWING", "PASSED"];

function CandidateCard({
  c,
  outreach,
  onDraftOutreach,
  status,
  onStatus,
}: {
  c: RankedCandidate;
  outreach: OutreachState | null;
  onDraftOutreach: () => void;
  status: string;
  onStatus: (s: string) => void;
}) {
  const scoreColor =
    c.score >= 80
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
      : c.score >= 60
        ? "bg-amber-500/15 text-amber-200 border-amber-500/30"
        : "bg-zinc-500/15 text-zinc-300 border-zinc-500/30";

  return (
    <article className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h3 className="text-base font-semibold">{c.candidate.name}</h3>
            <span className={`mono rounded-md border px-2 py-0.5 text-xs ${scoreColor}`}>
              {c.score} fit
            </span>
          </div>
          <p className="mt-0.5 text-sm text-[var(--muted)]">
            {c.candidate.headline} ·{" "}
            <span className="mono">
              {c.candidate.yearsExperience}y · {c.candidate.seniority}
            </span>{" "}
            · {c.candidate.locations.join(" / ")}
          </p>
        </div>
        <select
          value={status}
          onChange={(e) => onStatus(e.target.value)}
          className="mono rounded-md border border-[var(--border)] bg-[var(--surface-elev)] px-2 py-1 text-xs"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </header>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <div className="mono mb-1 text-[10px] uppercase tracking-wider text-emerald-300">
            why they fit
          </div>
          <ul className="space-y-1 text-sm">
            {c.reasons.map((r, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-emerald-400">+</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mono mb-1 text-[10px] uppercase tracking-wider text-amber-300">
            concerns
          </div>
          {c.concerns.length === 0 ? (
            <div className="text-sm text-[var(--muted)]">None flagged.</div>
          ) : (
            <ul className="space-y-1 text-sm">
              {c.concerns.map((r, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-amber-400">!</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {c.candidate.skills.slice(0, 10).map((s) => (
          <span
            key={s}
            className="mono rounded border border-[var(--border)] bg-[var(--surface-elev)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]"
          >
            {s}
          </span>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={onDraftOutreach}
          disabled={outreach?.loading}
          className="rounded-md border border-[var(--accent)] bg-[var(--accent)]/15 px-3 py-1.5 text-xs font-medium text-[var(--accent-hi)] hover:bg-[var(--accent)]/25 disabled:opacity-50"
        >
          {outreach?.loading ? "Drafting…" : "Draft outreach ↗"}
        </button>
        {c.candidate.githubUrl && (
          <a
            href={c.candidate.githubUrl}
            target="_blank"
            rel="noreferrer"
            className="mono text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            github ↗
          </a>
        )}
        {c.candidate.linkedinUrl && (
          <a
            href={c.candidate.linkedinUrl}
            target="_blank"
            rel="noreferrer"
            className="mono text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            linkedin ↗
          </a>
        )}
      </div>

      {outreach && !outreach.loading && (outreach.variants || outreach.error) && (
        <div className="mt-4 space-y-2">
          {outreach.error ? (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
              {outreach.error}
            </div>
          ) : (
            <>
              <div className="mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
                Outreach variants — 3 angles · self-graded
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                {outreach.variants!.map((v) => (
                  <VariantCard key={v.angle} v={v} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </article>
  );
}
