import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { PipelineStatus } from "@prisma/client";

export const runtime = "nodejs";

const VALID: PipelineStatus[] = [
  "NEW",
  "CONTACTED",
  "REPLIED",
  "INTERVIEWING",
  "PASSED",
];

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { status } = (await req.json()) as { status?: PipelineStatus };
    if (!status || !VALID.includes(status)) {
      return NextResponse.json(
        { error: `status must be one of ${VALID.join(", ")}` },
        { status: 400 }
      );
    }
    const updated = await prisma.candidate.update({
      where: { id },
      data: { status },
      select: { id: true, status: true },
    });
    return NextResponse.json(updated);
  } catch (err) {
    console.error("PATCH /api/candidates/[id]/status failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
