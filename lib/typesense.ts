import Typesense from "typesense";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export function getTypesenseClient() {
  const host = required("TYPESENSE_HOST");
  const port = parseInt(process.env.TYPESENSE_PORT ?? "443", 10);
  const protocol = process.env.TYPESENSE_PROTOCOL ?? "https";

  return new Typesense.Client({
    nodes: [{ host, port, protocol }],
    apiKey: required("TYPESENSE_ADMIN_API_KEY"),
    connectionTimeoutSeconds: 10,
  });
}

export const CANDIDATES_COLLECTION = "candidates";

export const candidatesSchema = {
  name: CANDIDATES_COLLECTION,
  fields: [
    { name: "id", type: "string" as const },
    { name: "name", type: "string" as const },
    { name: "headline", type: "string" as const },
    { name: "summary", type: "string" as const },
    { name: "skills", type: "string[]" as const, facet: true },
    { name: "seniority", type: "string" as const, facet: true },
    { name: "locations", type: "string[]" as const, facet: true },
    { name: "currentCompany", type: "string" as const, facet: true },
    { name: "currentRole", type: "string" as const },
    { name: "pastCompanies", type: "string[]" as const, facet: true },
    { name: "yearsExperience", type: "int32" as const, facet: true },
  ],
  default_sorting_field: "yearsExperience",
};
