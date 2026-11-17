CREATE TABLE "extension" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"manifest_url" text NOT NULL,
	"token" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "extension" ADD CONSTRAINT "extension_workspace_id_page_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extension_workspace" ON "extension" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "page" ADD COLUMN "headings" text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE "page" SET "headings" = (
  SELECT coalesce(string_agg(h.t, E'\n'), '') FROM (
    SELECT (SELECT string_agg(x #>> '{}', '') FROM jsonb_path_query(n, 'strict $.**.text') x) t
    FROM jsonb_path_query("body", 'strict $.** ? (@.type == "heading")') n
  ) h
) WHERE "body" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "page" DROP COLUMN "search";--> statement-breakpoint
ALTER TABLE "page" ADD COLUMN "search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce("title", '')), 'A') || setweight(to_tsvector('simple', coalesce("headings", '')), 'B') || setweight(to_tsvector('simple', coalesce("text", '')), 'C')) STORED;--> statement-breakpoint
CREATE INDEX "page_search" ON "page" USING gin ("search");
