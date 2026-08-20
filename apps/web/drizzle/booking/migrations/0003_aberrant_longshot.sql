CREATE TYPE "public"."booking_review_conflict_type" AS ENUM('contact_multiple_matches', 'contact_conflicting_signals', 'meeting_duplicate', 'meeting_contact_missing', 'meeting_contact_mismatch', 'meeting_multiple_contacts');--> statement-breakpoint
CREATE TYPE "public"."booking_review_status" AS ENUM('pending', 'resolved', 'rejected', 'expired');--> statement-breakpoint
ALTER TYPE "public"."booking_audit_reason_code" ADD VALUE 'ContactAmbiguous' BEFORE 'AccountRegistered';--> statement-breakpoint
ALTER TYPE "public"."booking_audit_reason_code" ADD VALUE 'ContactConflictingSignals' BEFORE 'AccountRegistered';--> statement-breakpoint
ALTER TYPE "public"."booking_audit_reason_code" ADD VALUE 'MeetingDuplicate' BEFORE 'AccountRegistered';--> statement-breakpoint
ALTER TYPE "public"."booking_audit_reason_code" ADD VALUE 'MeetingContactMissing' BEFORE 'AccountRegistered';--> statement-breakpoint
ALTER TYPE "public"."booking_audit_reason_code" ADD VALUE 'MeetingContactMismatch' BEFORE 'AccountRegistered';--> statement-breakpoint
ALTER TYPE "public"."booking_audit_reason_code" ADD VALUE 'MeetingMultipleContacts' BEFORE 'AccountRegistered';--> statement-breakpoint
ALTER TYPE "public"."booking_audit_reason_code" ADD VALUE 'ContactReviewRejectedByStaff' BEFORE 'AccountRegistered';--> statement-breakpoint
ALTER TYPE "public"."booking_audit_reason_code" ADD VALUE 'ContactReviewExpired' BEFORE 'AccountRegistered';--> statement-breakpoint
ALTER TYPE "public"."booking_reason_code" ADD VALUE 'ContactReviewRejectedByStaff';--> statement-breakpoint
ALTER TYPE "public"."booking_reason_code" ADD VALUE 'ContactReviewExpired';--> statement-breakpoint
ALTER TYPE "public"."booking_request_resolution" ADD VALUE 'contact_review_rejected';--> statement-breakpoint
ALTER TYPE "public"."booking_request_resolution" ADD VALUE 'contact_review_expired';--> statement-breakpoint
ALTER TYPE "public"."booking_request_status" ADD VALUE 'contact_review_pending' BEFORE 'pending_approval';--> statement-breakpoint
CREATE TABLE "booking_review_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_request_id" uuid NOT NULL,
	"conflict_type" "booking_review_conflict_type" NOT NULL,
	"candidate_contact_ids" jsonb,
	"candidate_meeting_ids" jsonb,
	"status" "booking_review_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolution_contact_id" text,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_authenticated_contact_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_request_id" uuid NOT NULL,
	"first_name_ciphertext" text NOT NULL,
	"first_name_nonce" text NOT NULL,
	"first_name_key_version" text NOT NULL,
	"last_name_ciphertext" text NOT NULL,
	"last_name_nonce" text NOT NULL,
	"last_name_key_version" text NOT NULL,
	"phone_ciphertext" text NOT NULL,
	"phone_nonce" text NOT NULL,
	"phone_key_version" text NOT NULL,
	"status" "pending_guest_identity_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sim_espo_meeting_contacts" (
	"meeting_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	CONSTRAINT "sim_espo_meeting_contacts_meeting_id_contact_id_pk" PRIMARY KEY("meeting_id","contact_id")
);
--> statement-breakpoint
ALTER TABLE "sim_espo_meetings" DROP CONSTRAINT "sim_espo_meetings_contact_id_sim_espo_contacts_id_fk";
--> statement-breakpoint
ALTER TABLE "booking_review_records" ADD CONSTRAINT "booking_review_records_booking_request_id_booking_request_records_id_fk" FOREIGN KEY ("booking_request_id") REFERENCES "public"."booking_request_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_authenticated_contact_details" ADD CONSTRAINT "pending_authenticated_contact_details_booking_request_id_booking_request_records_id_fk" FOREIGN KEY ("booking_request_id") REFERENCES "public"."booking_request_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_espo_meeting_contacts" ADD CONSTRAINT "sim_espo_meeting_contacts_meeting_id_sim_espo_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."sim_espo_meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_espo_meeting_contacts" ADD CONSTRAINT "sim_espo_meeting_contacts_contact_id_sim_espo_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."sim_espo_contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_review_records_booking_request_id_idx" ON "booking_review_records" USING btree ("booking_request_id");--> statement-breakpoint
CREATE INDEX "booking_review_records_status_expires_at_idx" ON "booking_review_records" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pending_authenticated_contact_details_booking_request_id_key" ON "pending_authenticated_contact_details" USING btree ("booking_request_id");--> statement-breakpoint
CREATE INDEX "pending_authenticated_contact_details_status_idx" ON "pending_authenticated_contact_details" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sim_espo_meeting_contacts_contact_id_idx" ON "sim_espo_meeting_contacts" USING btree ("contact_id");--> statement-breakpoint
ALTER TABLE "sim_espo_meetings" DROP COLUMN "contact_id";