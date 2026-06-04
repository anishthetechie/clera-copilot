import { NextResponse } from "next/server";
import { generateOutreach } from "@/lib/agent";
import { prisma } from "@/lib/prisma";
import type { CandidateDoc } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { candidateId, query } = (await req.json()) as {
      candidateId?: string;
      query?: string;
    };
    if (!candidateId || !query) {
      return NextResponse.json(
        { error: "candidateId and query required" },
        { status: 400 }
      );
    }

    const candidate = await prisma.candidate.findUnique({
      where: { id: candidateId },
    });
    if (!candidate) {
      return NextResponse.json(
        { error: "Candidate not found" },
        { status: 404 }
      );
    }

    const doc: CandidateDoc = {
      id: candidate.id,
      name: candidate.name,
      headline: candidate.headline,
      summary: candidate.summary,
      skills: candidate.skills,
      seniority: candidate.seniority,
      locations: candidate.locations,
      currentCompany: candidate.currentCompany,
      currentRole: candidate.currentRole,
      pastCompanies: candidate.pastCompanies,
      yearsExperience: candidate.yearsExperience,
      githubUrl: candidate.githubUrl ?? undefined,
      linkedinUrl: candidate.linkedinUrl ?? undefined,
    };

    const { subject, body } = await generateOutreach({ candidate: doc, query });

    const saved = await prisma.outreachDraft.create({
      data: { candidateId, query, subject, body },
    });

    return NextResponse.json({ id: saved.id, subject, body });
  } catch (err) {
    console.error("/api/outreach failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
