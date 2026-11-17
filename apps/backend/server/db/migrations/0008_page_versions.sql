CREATE TYPE "public"."author_kind" AS ENUM('person', 'agent');--> statement-breakpoint
CREATE TABLE "page_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"author_id" uuid,
	"author_kind" "author_kind",
	"title" text NOT NULL,
	"icon" text,
	"body" jsonb,
	"properties" jsonb NOT NULL,
	"schema" jsonb NOT NULL,
	"changes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "page_version" ADD CONSTRAINT "page_version_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_version_page" ON "page_version" USING btree ("page_id","created_at");