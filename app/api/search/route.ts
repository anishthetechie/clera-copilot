import { NextResponse } from "next/server";
import {
  extractCriteria,
  rerankWithLLM,
  searchCandidates,
} from "@/lib/agent";
import type { SearchResponse } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const started = Date.now();
  try {
    const { query } = (await req.json()) as { query?: string };
    if (!query || !query.trim()) {
      return NextResponse.json(
        { error: "Missing 'query' in request body." },
        { status: 400 }
      );
    }

    const criteria = await extractCriteria(query);
    const { docs, totalScanned } = await searchCandidates(criteria);
    const ranked = await rerankWithLLM(criteria, docs);

    const body: SearchResponse = {
      criteria,
      candidates: ranked,
      totalCandidatesScanned: totalScanned,
      tookMs: Date.now() - started,
    };
    return NextResponse.json(body);
  } catch (err) {
    console.error("/api/search failed", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
