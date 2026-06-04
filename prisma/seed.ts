// Seeds Postgres (via Prisma) AND Typesense in one shot.
// Run: npm run db:seed
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  CANDIDATES_COLLECTION,
  candidatesSchema,
  getTypesenseClient,
} from "../lib/typesense";
import { SEED_CANDIDATES } from "./seed-data";

const prisma = new PrismaClient();

async function main() {
  console.log("→ Wiping existing candidates");
  await prisma.outreachDraft.deleteMany();
  await prisma.candidate.deleteMany();

  console.log(`→ Inserting ${SEED_CANDIDATES.length} candidates into Postgres`);
  const created: Awaited<ReturnType<typeof prisma.candidate.create>>[] = [];
  for (const c of SEED_CANDIDATES) {
    const row = await prisma.candidate.create({
      data: {
        name: c.name,
        headline: c.headline,
        summary: c.summary,
        skills: c.skills,
        seniority: c.seniority,
        yearsExperience: c.yearsExperience,
        locations: c.locations,
        currentCompany: c.currentCompany,
        currentRole: c.currentRole,
        pastCompanies: c.pastCompanies,
        githubUrl: c.githubUrl,
        linkedinUrl: c.linkedinUrl,
      },
    });
    created.push(row);
  }
  console.log(`✓ Postgres seeded (${created.length})`);

  const typesense = getTypesenseClient();

  console.log("→ Recreating Typesense collection");
  try {
    await typesense.collections(CANDIDATES_COLLECTION).delete();
  } catch {
    /* collection didn't exist; fine */
  }
  await typesense.collections().create(candidatesSchema);

  console.log("→ Indexing candidates into Typesense");
  const docs = created.map((c) => ({
    id: c.id,
    name: c.name,
    headline: c.headline,
    summary: c.summary,
    skills: c.skills,
    seniority: c.seniority,
    locations: c.locations,
    currentCompany: c.currentCompany,
    currentRole: c.currentRole,
    pastCompanies: c.pastCompanies,
    yearsExperience: c.yearsExperience,
  }));
  await typesense
    .collections(CANDIDATES_COLLECTION)
    .documents()
    .import(docs, { action: "upsert" });

  console.log(`✓ Typesense indexed (${docs.length})`);
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
