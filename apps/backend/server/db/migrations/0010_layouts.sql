CREATE TABLE "layout" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "page" ADD COLUMN "layout_id" uuid;--> statement-breakpoint
ALTER TABLE "layout" ADD CONSTRAINT "layout_workspace_id_page_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "layout_workspace" ON "layout" USING btree ("workspace_id","synced_at");--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_layout_id_layout_id_fk" FOREIGN KEY ("layout_id") REFERENCES "public"."layout"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE TRIGGER "layout_synced_at" BEFORE INSERT OR UPDATE ON "layout" FOR EACH ROW EXECUTE FUNCTION "stamp_synced_at"();--> statement-breakpoint
CREATE FUNCTION "bury_layout"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "sync_tombstone" ("model", "id", "workspace_id", "synced_at")
  VALUES ('layouts', OLD.id, OLD.workspace_id, clock_timestamp())
  ON CONFLICT ("model", "id") DO UPDATE SET "synced_at" = excluded.synced_at;
  RETURN OLD;
END $$;--> statement-breakpoint
CREATE TRIGGER "layout_tombstone" AFTER DELETE ON "layout" FOR EACH ROW EXECUTE FUNCTION "bury_layout"();
