CREATE TYPE "public"."link_kind" AS ENUM('mention', 'property', 'embed');--> statement-breakpoint
CREATE TYPE "public"."page_kind" AS ENUM('page', 'database', 'person');--> statement-breakpoint
CREATE TYPE "public"."system_page" AS ENUM('people');--> statement-breakpoint
CREATE TYPE "public"."view_kind" AS ENUM('table', 'board', 'list', 'timeline');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('owner', 'member', 'guest');--> statement-breakpoint
CREATE TABLE "link" (
	"from_page" uuid NOT NULL,
	"to_urn" text NOT NULL,
	"kind" "link_kind" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"workspace_id" uuid,
	"title" text DEFAULT '' NOT NULL,
	"icon" text,
	"kind" "page_kind" DEFAULT 'page' NOT NULL,
	"system" "system_page",
	"person_id" uuid,
	"body" jsonb,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schema" jsonb,
	"sort" double precision DEFAULT 0 NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce("title", '')), 'A') || setweight(to_tsvector('simple', coalesce("text", '')), 'B')) STORED,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "view" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "view_kind" NOT NULL,
	"filter" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"group_by" text,
	"visible_properties" jsonb,
	"position" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership" (
	"person_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"role" "role" NOT NULL,
	CONSTRAINT "membership_person_id_workspace_id_pk" PRIMARY KEY("person_id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "person" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"email" text,
	"avatar" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hash" text NOT NULL,
	"name" text NOT NULL,
	"person_id" uuid,
	"agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "token_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
ALTER TABLE "link" ADD CONSTRAINT "link_from_page_page_id_fk" FOREIGN KEY ("from_page") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_parent_id_page_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_workspace_id_page_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view" ADD CONSTRAINT "view_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_workspace_id_page_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_workspace_id_page_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_workspace_id_page_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token" ADD CONSTRAINT "token_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token" ADD CONSTRAINT "token_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "link_from" ON "link" USING btree ("from_page");--> statement-breakpoint
CREATE INDEX "link_to" ON "link" USING btree ("to_urn");--> statement-breakpoint
CREATE INDEX "page_parent" ON "page" USING btree ("parent_id","sort");--> statement-breakpoint
CREATE INDEX "page_workspace" ON "page" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "page_search" ON "page" USING gin ("search");--> statement-breakpoint
CREATE INDEX "view_page" ON "view" USING btree ("page_id","position");--> statement-breakpoint
CREATE INDEX "membership_workspace" ON "membership" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_user_id" ON "person" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_email" ON "person" USING btree ("email");