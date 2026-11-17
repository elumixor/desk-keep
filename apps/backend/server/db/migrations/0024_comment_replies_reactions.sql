CREATE TABLE "comment_reaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"people_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "reply_to" uuid;--> statement-breakpoint
ALTER TABLE "comment_reaction" ADD CONSTRAINT "comment_reaction_comment_id_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reaction" ADD CONSTRAINT "comment_reaction_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reaction" ADD CONSTRAINT "comment_reaction_workspace_id_page_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comment_reaction_unique" ON "comment_reaction" USING btree ("comment_id","people_id","emoji");--> statement-breakpoint
CREATE INDEX "comment_reaction_workspace" ON "comment_reaction" USING btree ("workspace_id","synced_at");--> statement-breakpoint
CREATE INDEX "comment_reaction_comment" ON "comment_reaction" USING btree ("comment_id");--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_reply_to_comment_id_fk" FOREIGN KEY ("reply_to") REFERENCES "public"."comment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_reply_to" ON "comment" USING btree ("reply_to");--> statement-breakpoint
CREATE TRIGGER "comment_reaction_synced_at" BEFORE INSERT OR UPDATE ON "comment_reaction" FOR EACH ROW EXECUTE FUNCTION "stamp_synced_at"();--> statement-breakpoint
CREATE FUNCTION "bury_comment_reaction"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "sync_tombstone" ("model", "id", "workspace_id", "synced_at")
  VALUES ('reactions', OLD.id, OLD.workspace_id, clock_timestamp())
  ON CONFLICT ("model", "id") DO UPDATE SET "synced_at" = excluded.synced_at;
  RETURN OLD;
END $$;--> statement-breakpoint
CREATE TRIGGER "comment_reaction_tombstone" AFTER DELETE ON "comment_reaction" FOR EACH ROW EXECUTE FUNCTION "bury_comment_reaction"();
