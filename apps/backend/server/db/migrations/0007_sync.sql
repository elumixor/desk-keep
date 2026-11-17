CREATE TABLE "sync_mutation" (
	"author_id" uuid NOT NULL,
	"mutation_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_mutation_author_id_mutation_id_pk" PRIMARY KEY("author_id","mutation_id")
);
--> statement-breakpoint
CREATE TABLE "sync_tombstone" (
	"model" text NOT NULL,
	"id" uuid NOT NULL,
	"workspace_id" uuid,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_tombstone_model_id_pk" PRIMARY KEY("model","id")
);
--> statement-breakpoint
DROP INDEX "page_workspace";--> statement-breakpoint
ALTER TABLE "page" ADD COLUMN "synced_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "trait" ADD COLUMN "synced_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "view" ADD COLUMN "synced_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "sync_tombstone_workspace" ON "sync_tombstone" USING btree ("workspace_id","synced_at");--> statement-breakpoint
CREATE INDEX "page_workspace" ON "page" USING btree ("workspace_id","synced_at");--> statement-breakpoint
CREATE FUNCTION "stamp_synced_at"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.synced_at := clock_timestamp();
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "page_synced_at" BEFORE INSERT OR UPDATE ON "page" FOR EACH ROW EXECUTE FUNCTION "stamp_synced_at"();--> statement-breakpoint
CREATE TRIGGER "view_synced_at" BEFORE INSERT OR UPDATE ON "view" FOR EACH ROW EXECUTE FUNCTION "stamp_synced_at"();--> statement-breakpoint
CREATE TRIGGER "trait_synced_at" BEFORE INSERT OR UPDATE ON "trait" FOR EACH ROW EXECUTE FUNCTION "stamp_synced_at"();--> statement-breakpoint
CREATE FUNCTION "bury_view"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "sync_tombstone" ("model", "id", "workspace_id", "synced_at")
  SELECT 'views', OLD.id, p.workspace_id, clock_timestamp() FROM "page" p WHERE p.id = OLD.page_id
  ON CONFLICT ("model", "id") DO UPDATE SET "synced_at" = excluded.synced_at, "workspace_id" = excluded.workspace_id;
  RETURN OLD;
END $$;--> statement-breakpoint
CREATE TRIGGER "view_tombstone" AFTER DELETE ON "view" FOR EACH ROW EXECUTE FUNCTION "bury_view"();--> statement-breakpoint
CREATE FUNCTION "bury_trait"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "sync_tombstone" ("model", "id", "workspace_id", "synced_at")
  VALUES ('traits', OLD.id, OLD.workspace_id, clock_timestamp())
  ON CONFLICT ("model", "id") DO UPDATE SET "synced_at" = excluded.synced_at;
  RETURN OLD;
END $$;--> statement-breakpoint
CREATE TRIGGER "trait_tombstone" AFTER DELETE ON "trait" FOR EACH ROW EXECUTE FUNCTION "bury_trait"();
