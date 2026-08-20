CREATE TYPE "public"."booking_outbox_job_error_code" AS ENUM('otp_issue_failed', 'otp_rate_limited', 'mail_send_failed', 'booking_request_not_pending', 'booking_request_not_found', 'unknown_error');--> statement-breakpoint
CREATE TYPE "public"."booking_outbox_job_status" AS ENUM('pending', 'processing', 'completed', 'failed_retryable');--> statement-breakpoint
CREATE TYPE "public"."booking_outbox_job_type" AS ENUM('send_guest_verification_otp');--> statement-breakpoint
CREATE TABLE "booking_outbox_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_type" "booking_outbox_job_type" NOT NULL,
	"booking_request_id" uuid NOT NULL,
	"status" "booking_outbox_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error_code" "booking_outbox_job_error_code",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "booking_request_records" ADD COLUMN "identity_fingerprint_key_version" text NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_outbox_jobs" ADD CONSTRAINT "booking_outbox_jobs_booking_request_id_booking_request_records_id_fk" FOREIGN KEY ("booking_request_id") REFERENCES "public"."booking_request_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_outbox_jobs_booking_request_id_job_type_key" ON "booking_outbox_jobs" USING btree ("booking_request_id","job_type");--> statement-breakpoint
CREATE INDEX "booking_outbox_jobs_status_idx" ON "booking_outbox_jobs" USING btree ("status");