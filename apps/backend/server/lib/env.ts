import { z } from "zod";

/** Everything the API is configured with, read once at start-up. A missing key stops the process here, by name. */
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_PUBLISHABLE_KEY: z.string().min(1),
  /** People, where people live, and Keep's service key there. */
  PEOPLE_URL: z.url(),
  PEOPLE_API_KEY: z.string().startsWith("people_"),
  /** Where notifications go instead of `PEOPLE_URL`: a local Keep on production People sends none of its own there. */
  PEOPLE_NOTIFY_URL: z.url().optional(),
  /** Pai's People person: where the agent migration (`retireAgents`) and `scripts/pai-key.ts` find its Keep account. */
  PAI_PEOPLE_ID: z.uuid().optional(),
  /** Encrypts extension tokens at rest; the Clerk secret is used when it is not set. */
  EXTENSION_SECRET: z.string().min(16).optional(),
  /** Vercel's AI Gateway, which writes the editor's completions (`lib/completion.ts`); without it the route answers 503 and the editor stays quiet. */
  AI_GATEWAY_API_KEY: z.string().min(1).optional(),
  COMPLETION_MODEL: z.string().optional(),
  /** Balance (the calendar) and Keep's MCP key there (`balance_mcp_…`): what a Balance block's pill shows. */
  BALANCE_URL: z.url().optional(),
  BALANCE_MCP_KEY: z.string().min(1).optional(),
  /** Where the app is, for the links notifications carry; the local frontend when unset in dev. */
  KEEP_URL: z.url().optional(),
  NODE_ENV: z.string().optional(),
  DK_STAGE: z.string().optional(),
  DK_HOST: z.string().optional(),
});

class EnvError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Environment is not configured:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.name = "EnvError";
  }
}

function load(source: NodeJS.ProcessEnv) {
  // A key left blank in `.env` (`KEY=`) loads as "": treat it as unset, so optional keys stay optional.
  const result = schema.safeParse(Object.fromEntries(Object.entries(source).filter(([, value]) => value !== "")));
  if (result.success) return result.data;
  const error = new EnvError(result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  // `nitro dev` swallows a plugin that fails to load and answers every request with a bare 500.
  console.error(error.message);
  throw error;
}

export const env = load(process.env);

export const isProduction = env.NODE_ENV === "production" || env.DK_STAGE === "production";

/** Where the app opens: what a notification's link points at. */
export const appUrl = (
  env.KEEP_URL ??
  (env.DK_HOST ? `https://${env.DK_HOST}` : env.DK_STAGE ? "https://keep.example.com" : "http://localhost:5240")
).replace(/\/$/, "");
