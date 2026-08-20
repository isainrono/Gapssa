ALTER TYPE "public"."booking_audit_reason_code" ADD VALUE 'MeetingIncompatibleDuringResume' BEFORE 'AccountRegistered';--> statement-breakpoint
ALTER TYPE "public"."booking_audit_reason_code" ADD VALUE 'ContactReviewReplaced' BEFORE 'AccountRegistered';--> statement-breakpoint
ALTER TYPE "public"."booking_review_conflict_type" ADD VALUE 'meeting_incompatible';--> statement-breakpoint
ALTER TYPE "public"."booking_review_status" ADD VALUE 'processing' BEFORE 'resolved';--> statement-breakpoint
ALTER TYPE "public"."booking_review_status" ADD VALUE 'replaced';--> statement-breakpoint
ALTER TABLE "booking_review_records" ADD COLUMN "claim_token" uuid;--> statement-breakpoint
ALTER TABLE "booking_review_records" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "booking_review_records" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "booking_review_records_status_lease_expires_at_idx" ON "booking_review_records" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_review_records_active_booking_request_id_key" ON "booking_review_records" USING btree ("booking_request_id") WHERE "booking_review_records"."status" IN ('pending', 'processing');