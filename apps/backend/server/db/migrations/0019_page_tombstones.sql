-- A page deleted for good (from the trash, or by the cron) leaves a tombstone, as a comment does, so a device that
-- still holds it alive learns it is gone. Children going with it by the cascade leave theirs too.
CREATE FUNCTION "bury_page"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "sync_tombstone" ("model", "id", "workspace_id", "synced_at")
  VALUES ('pages', OLD.id, COALESCE(OLD.workspace_id, OLD.id), clock_timestamp())
  ON CONFLICT ("model", "id") DO UPDATE SET "synced_at" = excluded.synced_at;
  RETURN OLD;
END $$;--> statement-breakpoint
CREATE TRIGGER "page_tombstone" AFTER DELETE ON "page" FOR EACH ROW EXECUTE FUNCTION "bury_page"();
