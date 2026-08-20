CREATE TYPE "public"."audit_actor_type" AS ENUM('user', 'guest', 'system');--> statement-breakpoint
CREATE TYPE "public"."audit_channel" AS ENUM('web', 'admin_espocrm', 'n8n', 'google_calendar', 'email');--> statement-breakpoint
CREATE TYPE "public"."audit_reason_code" AS ENUM('ApprovedByStaff', 'RejectedByStaff', 'ApprovalExpired', 'VerificationExpired', 'RecoveryWindowExceeded', 'ClientRequested', 'SystemReconciliation', 'AccountRegistered', 'AccountEmailVerified', 'LoginSucceeded', 'LoginFailedInvalidCredentials', 'LoginFailedAccountNotVerified', 'LoginFailedAccountSuspended', 'LoginRateLimited', 'LogoutRequested', 'SessionRevokedByUser', 'SessionRevokedByPasswordChange', 'SessionExpiredIdle', 'SessionExpiredAbsolute', 'PasswordResetRequested', 'PasswordResetCompleted', 'GuardianLinkRequested', 'GuardianLinkConfirmed', 'GuardianLinkRevoked', 'IndependenceRequested', 'IndependenceGranted', 'IndependenceRejected', 'EspoLinkProposed', 'EspoLinkApprovedByStaff', 'EspoLinkRejectedByStaff');--> statement-breakpoint
CREATE TYPE "public"."audit_value_representation" AS ENUM('raw', 'redacted');--> statement-breakpoint
CREATE TYPE "public"."client_account_status" AS ENUM('pending_verification', 'active', 'suspended', 'pending_deletion');--> statement-breakpoint
CREATE TYPE "public"."credential_type" AS ENUM('password');--> statement-breakpoint
CREATE TYPE "public"."email_verification_request_status" AS ENUM('pending', 'verified', 'expired');--> statement-breakpoint
CREATE TYPE "public"."espo_link_status" AS ENUM('unlinked', 'pending_review', 'linked', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."guardian_link_status" AS ENUM('pending_minor_confirmation', 'active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."independence_request_status" AS ENUM('pending', 'confirmed', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."independence_status" AS ENUM('not_applicable', 'pending', 'granted');--> statement-breakpoint
CREATE TYPE "public"."password_reset_request_status" AS ENUM('pending', 'consumed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."session_revoked_reason" AS ENUM('user_logout', 'user_revoked_other_session', 'password_changed', 'admin_action', 'expired_idle', 'expired_absolute');--> statement-breakpoint
CREATE TABLE "auth_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_id" text,
	"actor_system_name" text,
	"channel" "audit_channel" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"reason_code" "audit_reason_code",
	"value_representation" "audit_value_representation" NOT NULL,
	"field" text,
	"previous_value" jsonb,
	"new_value" jsonb,
	"redacted_algorithm" text,
	"redacted_digest" text,
	"redacted_change_kind" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"status" "client_account_status" DEFAULT 'pending_verification' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"date_of_birth" date NOT NULL,
	"locale" text NOT NULL,
	"espo_link_status" "espo_link_status" DEFAULT 'unlinked' NOT NULL,
	"espo_contact_id" text,
	"independence_status" "independence_status" DEFAULT 'not_applicable' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"type" "credential_type" NOT NULL,
	"secret_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_verification_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"status" "email_verification_request_status" DEFAULT 'pending' NOT NULL,
	"otp_challenge_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "guardian_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guardian_account_id" uuid NOT NULL,
	"minor_account_id" uuid NOT NULL,
	"status" "guardian_link_status" DEFAULT 'pending_minor_confirmation' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"requested_by" uuid NOT NULL,
	"confirmed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid
);
--> statement-breakpoint
CREATE TABLE "independence_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"minor_account_id" uuid NOT NULL,
	"status" "independence_request_status" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"otp_challenge_id" text NOT NULL,
	"identity_confirmation_method" text DEFAULT 'email_otp_reconfirmation' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "password_reset_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"status" "password_reset_request_status" DEFAULT 'pending' NOT NULL,
	"otp_challenge_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"idempotency_key" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" "inet",
	"user_agent" text,
	"revoked_at" timestamp with time zone,
	"revoked_reason" "session_revoked_reason"
);
--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_account_id_client_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_verification_requests" ADD CONSTRAINT "email_verification_requests_account_id_client_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_links" ADD CONSTRAINT "guardian_links_guardian_account_id_client_accounts_id_fk" FOREIGN KEY ("guardian_account_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_links" ADD CONSTRAINT "guardian_links_minor_account_id_client_accounts_id_fk" FOREIGN KEY ("minor_account_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_links" ADD CONSTRAINT "guardian_links_requested_by_client_accounts_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."client_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_links" ADD CONSTRAINT "guardian_links_revoked_by_client_accounts_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."client_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "independence_requests" ADD CONSTRAINT "independence_requests_minor_account_id_client_accounts_id_fk" FOREIGN KEY ("minor_account_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_requests" ADD CONSTRAINT "password_reset_requests_account_id_client_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_client_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_audit_log_entity_entity_id_idx" ON "auth_audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "auth_audit_log_occurred_at_idx" ON "auth_audit_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "client_accounts_email_key" ON "client_accounts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "client_accounts_espo_contact_id_idx" ON "client_accounts" USING btree ("espo_contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credentials_account_id_type_key" ON "credentials" USING btree ("account_id","type");--> statement-breakpoint
CREATE INDEX "email_verification_requests_account_id_idx" ON "email_verification_requests" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "email_verification_requests_status_idx" ON "email_verification_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "guardian_links_minor_account_id_idx" ON "guardian_links" USING btree ("minor_account_id");--> statement-breakpoint
CREATE INDEX "guardian_links_guardian_account_id_idx" ON "guardian_links" USING btree ("guardian_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guardian_links_unique_live_pair" ON "guardian_links" USING btree ("guardian_account_id","minor_account_id") WHERE "guardian_links"."status" in ('pending_minor_confirmation', 'active');--> statement-breakpoint
CREATE INDEX "independence_requests_minor_account_id_idx" ON "independence_requests" USING btree ("minor_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_requests_idempotency_key_key" ON "password_reset_requests" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "password_reset_requests_account_id_idx" ON "password_reset_requests" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_account_id_idx" ON "sessions" USING btree ("account_id");