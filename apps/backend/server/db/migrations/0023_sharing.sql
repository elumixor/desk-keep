CREATE TYPE "public"."share_role" AS ENUM('view', 'comment', 'edit', 'full');--> statement-breakpoint
CREATE TABLE "page_share" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" "share_role" NOT NULL,
	"invited_by" uuid,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_revocation" (
	"person_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_revocation_person_id_page_id_pk" PRIMARY KEY("person_id","page_id")
);
--> statement-breakpoint
DROP INDEX "person_email";--> statement-breakpoint
ALTER TABLE "membership" ADD COLUMN "invited_by" uuid;--> statement-breakpoint
ALTER TABLE "membership" ADD COLUMN "invited_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "membership" ADD COLUMN "synced_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "joined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "page_share" ADD CONSTRAINT "page_share_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_share" ADD CONSTRAINT "page_share_workspace_id_page_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_share" ADD CONSTRAINT "page_share_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_share" ADD CONSTRAINT "page_share_invited_by_person_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_revocation" ADD CONSTRAINT "sync_revocation_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "page_share_page_person" ON "page_share" USING btree ("page_id","person_id");--> statement-breakpoint
CREATE INDEX "page_share_person" ON "page_share" USING btree ("person_id","workspace_id");--> statement-breakpoint
CREATE INDEX "page_share_workspace" ON "page_share" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "sync_revocation_person" ON "sync_revocation" USING btree ("person_id","synced_at");--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_invited_by_person_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "person_email" ON "person" USING btree ("email");--> statement-breakpoint
-- Existing memberships are no new grant to any device (before the trigger, which would stamp them now).
UPDATE "membership" SET "invited_at" = p."created_at", "synced_at" = 'epoch' FROM "person" p WHERE p."id" = "membership"."person_id";--> statement-breakpoint
-- Whoever has signed in or used a key has joined; the rest are pending invites.
UPDATE "person" SET "joined_at" = "created_at" WHERE "user_id" IS NOT NULL OR "id" IN (SELECT "person_id" FROM "token");--> statement-breakpoint
CREATE TRIGGER "page_share_synced_at" BEFORE INSERT OR UPDATE ON "page_share" FOR EACH ROW EXECUTE FUNCTION "stamp_synced_at"();--> statement-breakpoint
CREATE TRIGGER "membership_synced_at" BEFORE INSERT OR UPDATE ON "membership" FOR EACH ROW EXECUTE FUNCTION "stamp_synced_at"();--> statement-breakpoint
CREATE TRIGGER "sync_revocation_synced_at" BEFORE INSERT OR UPDATE ON "sync_revocation" FOR EACH ROW EXECUTE FUNCTION "stamp_synced_at"();
