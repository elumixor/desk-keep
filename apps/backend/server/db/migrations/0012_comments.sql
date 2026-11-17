CREATE TABLE "comment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"author_kind" "author_kind" NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_workspace_id_page_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_workspace" ON "comment" USING btree ("workspace_id","synced_at");--> statement-breakpoint
CREATE INDEX "comment_page" ON "comment" USING btree ("page_id","created_at");--> statement-breakpoint
CREATE TRIGGER "comment_synced_at" BEFORE INSERT OR UPDATE ON "comment" FOR EACH ROW EXECUTE FUNCTION "stamp_synced_at"();--> statement-breakpoint
CREATE FUNCTION "bury_comment"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "sync_tombstone" ("model", "id", "workspace_id", "synced_at")
  VALUES ('comments', OLD.id, OLD.workspace_id, clock_timestamp())
  ON CONFLICT ("model", "id") DO UPDATE SET "synced_at" = excluded.synced_at;
  RETURN OLD;
END $$;--> statement-breakpoint
CREATE TRIGGER "comment_tombstone" AFTER DELETE ON "comment" FOR EACH ROW EXECUTE FUNCTION "bury_comment"();
