DROP INDEX "booking_outbox_jobs_status_idx";--> statement-breakpoint
ALTER TABLE "booking_outbox_jobs" ADD COLUMN "claim_token" uuid;--> statement-breakpoint
ALTER TABLE "booking_outbox_jobs" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "booking_outbox_jobs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "booking_outbox_jobs_status_next_attempt_at_idx" ON "booking_outbox_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "booking_outbox_jobs_status_lease_expires_at_idx" ON "booking_outbox_jobs" USING btree ("status","lease_expires_at");