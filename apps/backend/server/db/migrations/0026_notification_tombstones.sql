CREATE TABLE "notification_tombstone" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recipient" uuid NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "notification_tombstone_recipient" ON "notification_tombstone" USING btree ("recipient","synced_at");--> statement-breakpoint
CREATE FUNCTION "bury_notification"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "notification_tombstone" ("id", "recipient", "synced_at") VALUES (OLD.id, OLD.recipient, clock_timestamp())
  ON CONFLICT ("id") DO UPDATE SET "synced_at" = excluded.synced_at;
  RETURN OLD;
END $$;--> statement-breakpoint
CREATE TRIGGER "notification_tombstone" AFTER DELETE ON "notification" FOR EACH ROW EXECUTE FUNCTION "bury_notification"();
