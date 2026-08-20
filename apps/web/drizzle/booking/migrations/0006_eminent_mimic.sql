CREATE TYPE "public"."sim_espo_meeting_resolution_reason" AS ENUM('Approved', 'RejectedByStaff', 'ApprovalExpired');--> statement-breakpoint
ALTER TABLE "booking_request_records" ADD COLUMN "decision_operation_key" text;--> statement-breakpoint
ALTER TABLE "sim_espo_meetings" ADD COLUMN "resolution_reason" "sim_espo_meeting_resolution_reason";--> statement-breakpoint
CREATE UNIQUE INDEX "booking_request_records_decision_operation_key_key" ON "booking_request_records" USING btree ("decision_operation_key") WHERE "booking_request_records"."decision_operation_key" IS NOT NULL;