CREATE TYPE "public"."booking_audit_actor_type" AS ENUM('user', 'guest', 'system');--> statement-breakpoint
CREATE TYPE "public"."booking_audit_channel" AS ENUM('web', 'admin_espocrm', 'n8n', 'google_calendar', 'email');--> statement-breakpoint
CREATE TYPE "public"."booking_audit_reason_code" AS ENUM('ApprovedByStaff', 'RejectedByStaff', 'ApprovalExpired', 'VerificationExpired', 'RecoveryWindowExceeded', 'ClientRequested', 'SystemReconciliation', 'AccountRegistered', 'AccountEmailVerified', 'LoginSucceeded', 'LoginFailedInvalidCredentials', 'LoginFailedAccountNotVerified', 'LoginFailedAccountSuspended', 'LoginRateLimited', 'LogoutRequested', 'SessionRevokedByUser', 'SessionRevokedByAdmin', 'SessionRevokedByPasswordChange', 'SessionExpiredIdle', 'SessionExpiredAbsolute', 'PasswordResetRequested', 'PasswordResetCompleted', 'GuardianLinkRequested', 'GuardianLinkConfirmed', 'GuardianLinkRevoked', 'IndependenceRequested', 'IndependenceGranted', 'IndependenceRejected', 'AccountDeletionRequested', 'EspoLinkProposed', 'EspoLinkApprovedByStaff', 'EspoLinkRejectedByStaff');--> statement-breakpoint
CREATE TYPE "public"."booking_audit_value_representation" AS ENUM('raw', 'redacted', 'event');--> statement-breakpoint
CREATE TYPE "public"."booking_reason_code" AS ENUM('Approved', 'RejectedByStaff', 'ApprovalExpired', 'VerificationExpired', 'RecoveryWindowExceeded');--> statement-breakpoint
CREATE TYPE "public"."booking_request_resolution" AS ENUM('confirmed', 'rejected', 'verification_expired', 'approval_expired');--> statement-breakpoint
CREATE TYPE "public"."booking_request_status" AS ENUM('pending_verification', 'verification_processing', 'pending_approval', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."sim_espo_estado_meeting_nativo" AS ENUM('Planned', 'Held', 'Not Held');--> statement-breakpoint
CREATE TYPE "public"."sim_espo_estado_reserva" AS ENUM('RequestReceived', 'PendingGuardianAuthorization', 'PendingAssessment', 'PendingCenterApproval', 'Confirmed', 'ClientArrived', 'InTreatment', 'Completed', 'Canceled', 'NoShow', 'RescheduleRequested', 'ScheduleConflict');--> statement-breakpoint
CREATE TYPE "public"."pending_guest_identity_status" AS ENUM('active', 'consumed', 'discarded');--> statement-breakpoint
CREATE TABLE "booking_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"actor_type" "booking_audit_actor_type" NOT NULL,
	"actor_id" text,
	"actor_system_name" text,
	"channel" "booking_audit_channel" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"reason_code" "booking_audit_reason_code",
	"value_representation" "booking_audit_value_representation" NOT NULL,
	"field" text,
	"previous_value" jsonb,
	"new_value" jsonb,
	"redacted_algorithm" text,
	"redacted_digest" text,
	"redacted_change_kind" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_request_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_account_id" uuid,
	"meeting_id" text,
	"treatment_id" text NOT NULL,
	"professional_id" text NOT NULL,
	"zone_id" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"status" "booking_request_status" DEFAULT 'pending_verification' NOT NULL,
	"verification_expires_at" timestamp with time zone NOT NULL,
	"approval_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" "booking_request_resolution",
	"reason_code" "booking_reason_code",
	"idempotency_key" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"otp_challenge_id" text
);
--> statement-breakpoint
CREATE TABLE "pending_guest_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_request_id" uuid NOT NULL,
	"first_name_ciphertext" text NOT NULL,
	"first_name_nonce" text NOT NULL,
	"first_name_key_version" text NOT NULL,
	"last_name_ciphertext" text NOT NULL,
	"last_name_nonce" text NOT NULL,
	"last_name_key_version" text NOT NULL,
	"email_ciphertext" text NOT NULL,
	"email_nonce" text NOT NULL,
	"email_key_version" text NOT NULL,
	"phone_ciphertext" text NOT NULL,
	"phone_nonce" text NOT NULL,
	"phone_key_version" text NOT NULL,
	"email_lookup_hmac" text NOT NULL,
	"status" "pending_guest_identity_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sim_espo_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gapssa_account_id" uuid,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sim_espo_meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"booking_request_id" uuid NOT NULL,
	"treatment_id" text NOT NULL,
	"professional_id" text NOT NULL,
	"zone_id" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"c_estado_reserva" "sim_espo_estado_reserva" DEFAULT 'PendingCenterApproval' NOT NULL,
	"status" "sim_espo_estado_meeting_nativo" DEFAULT 'Planned' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_guest_identities" ADD CONSTRAINT "pending_guest_identities_booking_request_id_booking_request_records_id_fk" FOREIGN KEY ("booking_request_id") REFERENCES "public"."booking_request_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_espo_meetings" ADD CONSTRAINT "sim_espo_meetings_contact_id_sim_espo_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."sim_espo_contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_audit_log_entity_entity_id_idx" ON "booking_audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "booking_audit_log_occurred_at_idx" ON "booking_audit_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_request_records_idempotency_key_key" ON "booking_request_records" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "booking_request_records_status_idx" ON "booking_request_records" USING btree ("status");--> statement-breakpoint
CREATE INDEX "booking_request_records_client_account_id_idx" ON "booking_request_records" USING btree ("client_account_id");--> statement-breakpoint
CREATE INDEX "booking_request_records_meeting_id_idx" ON "booking_request_records" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "booking_request_records_professional_time_idx" ON "booking_request_records" USING btree ("professional_id","start_at","end_at");--> statement-breakpoint
CREATE INDEX "booking_request_records_zone_time_idx" ON "booking_request_records" USING btree ("zone_id","start_at","end_at");--> statement-breakpoint
CREATE INDEX "booking_request_records_verification_expires_at_idx" ON "booking_request_records" USING btree ("verification_expires_at");--> statement-breakpoint
CREATE INDEX "booking_request_records_approval_expires_at_idx" ON "booking_request_records" USING btree ("approval_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pending_guest_identities_booking_request_id_key" ON "pending_guest_identities" USING btree ("booking_request_id");--> statement-breakpoint
CREATE INDEX "pending_guest_identities_status_idx" ON "pending_guest_identities" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pending_guest_identities_email_lookup_hmac_idx" ON "pending_guest_identities" USING btree ("email_lookup_hmac");--> statement-breakpoint
CREATE INDEX "sim_espo_contacts_email_idx" ON "sim_espo_contacts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "sim_espo_contacts_phone_idx" ON "sim_espo_contacts" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "sim_espo_contacts_gapssa_account_id_idx" ON "sim_espo_contacts" USING btree ("gapssa_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sim_espo_meetings_booking_request_id_key" ON "sim_espo_meetings" USING btree ("booking_request_id");--> statement-breakpoint
CREATE INDEX "sim_espo_meetings_professional_time_idx" ON "sim_espo_meetings" USING btree ("professional_id","start_at","end_at");--> statement-breakpoint
CREATE INDEX "sim_espo_meetings_zone_time_idx" ON "sim_espo_meetings" USING btree ("zone_id","start_at","end_at");--> statement-breakpoint
CREATE INDEX "sim_espo_meetings_c_estado_reserva_idx" ON "sim_espo_meetings" USING btree ("c_estado_reserva");