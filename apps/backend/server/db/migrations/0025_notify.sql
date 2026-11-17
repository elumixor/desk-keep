CREATE TYPE "public"."delivery_state" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('mention', 'reply', 'watch', 'share', 'invite');--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"workspace_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"comment_id" uuid,
	"actor" uuid,
	"client" text,
	"title" text NOT NULL,
	"text" text,
	"url" text NOT NULL,
	"data" jsonb NOT NULL,
	"base" jsonb,
	"coalesce_key" text,
	"window_ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"state" "delivery_state" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"last_error" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_watch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"people_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"client" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_watch_unique" UNIQUE NULLS NOT DISTINCT("people_id","page_id","client")
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"event" jsonb NOT NULL,
	"state" "delivery_state" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_workspace_id_page_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_watch" ADD CONSTRAINT "page_watch_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_webhook_id_webhook_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhook"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_recipient" ON "notification" USING btree ("recipient","synced_at");--> statement-breakpoint
CREATE INDEX "notification_due" ON "notification" USING btree ("next_attempt_at") WHERE "notification"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "notification_coalesce" ON "notification" USING btree ("coalesce_key","window_ends_at") WHERE "notification"."coalesce_key" is not null;--> statement-breakpoint
CREATE INDEX "page_watch_page" ON "page_watch" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "page_watch_person" ON "page_watch" USING btree ("people_id","synced_at");--> statement-breakpoint
CREATE INDEX "webhook_delivery_due" ON "webhook_delivery" USING btree ("next_attempt_at") WHERE "webhook_delivery"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "webhook_delivery_hook" ON "webhook_delivery" USING btree ("webhook_id","created_at");--> statement-breakpoint
CREATE TRIGGER "notification_synced_at" BEFORE INSERT OR UPDATE ON "notification" FOR EACH ROW EXECUTE FUNCTION "stamp_synced_at"();--> statement-breakpoint
CREATE TRIGGER "page_watch_synced_at" BEFORE INSERT OR UPDATE ON "page_watch" FOR EACH ROW EXECUTE FUNCTION "stamp_synced_at"();
