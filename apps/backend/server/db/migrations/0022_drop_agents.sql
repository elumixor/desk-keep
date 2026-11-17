ALTER TABLE "token" DROP CONSTRAINT "token_agent_id_agent_id_fk";--> statement-breakpoint
ALTER TABLE "token" DROP COLUMN "agent_id";--> statement-breakpoint
ALTER TABLE "token" ALTER COLUMN "person_id" SET NOT NULL;--> statement-breakpoint
DROP TABLE "agent";--> statement-breakpoint
ALTER TABLE "comment" DROP COLUMN "author_kind";--> statement-breakpoint
ALTER TABLE "page_version" DROP COLUMN "author_kind";--> statement-breakpoint
DROP TYPE "public"."author_kind";
