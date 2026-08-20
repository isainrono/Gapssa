CREATE TYPE "public"."outbox_job_status" AS ENUM('pending', 'completed', 'failed_retryable');--> statement-breakpoint
CREATE TYPE "public"."outbox_job_type" AS ENUM('evaluate_espo_link');--> statement-breakpoint
CREATE TABLE "outbox_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_type" "outbox_job_type" NOT NULL,
	"account_id" uuid NOT NULL,
	"status" "outbox_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "outbox_jobs" ADD CONSTRAINT "outbox_jobs_account_id_client_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_jobs_status_next_attempt_at_idx" ON "outbox_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_jobs_unique_unresolved_account_job_type" ON "outbox_jobs" USING btree ("account_id","job_type") WHERE "outbox_jobs"."status" in ('pending', 'failed_retryable');