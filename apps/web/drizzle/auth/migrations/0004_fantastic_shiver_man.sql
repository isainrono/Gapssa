ALTER TYPE "public"."audit_reason_code" ADD VALUE 'ContactAmbiguous' BEFORE 'AccountRegistered';--> statement-breakpoint
ALTER TYPE "public"."audit_reason_code" ADD VALUE 'ContactConflictingSignals' BEFORE 'AccountRegistered';--> statement-breakpoint
ALTER TYPE "public"."audit_reason_code" ADD VALUE 'MeetingDuplicate' BEFORE 'AccountRegistered';--> statement-breakpoint
ALTER TYPE "public"."audit_reason_code" ADD VALUE 'MeetingContactMissing' BEFORE 'AccountRegistered';--> statement-breakpoint
ALTER TYPE "public"."audit_reason_code" ADD VALUE 'MeetingContactMismatch' BEFORE 'AccountRegistered';--> statement-breakpoint
ALTER TYPE "public"."audit_reason_code" ADD VALUE 'MeetingMultipleContacts' BEFORE 'AccountRegistered';--> statement-breakpoint
ALTER TYPE "public"."audit_reason_code" ADD VALUE 'ContactReviewRejectedByStaff' BEFORE 'AccountRegistered';--> statement-breakpoint
ALTER TYPE "public"."audit_reason_code" ADD VALUE 'ContactReviewExpired' BEFORE 'AccountRegistered';--> statement-breakpoint
ALTER TYPE "public"."audit_reason_code" ADD VALUE 'MeetingIncompatibleDuringResume' BEFORE 'AccountRegistered';--> statement-breakpoint
ALTER TYPE "public"."audit_reason_code" ADD VALUE 'ContactReviewReplaced' BEFORE 'AccountRegistered';--> statement-breakpoint
ALTER TYPE "public"."audit_reason_code" ADD VALUE 'MeetingGcsExclusionMismatch' BEFORE 'AccountRegistered';--> statement-breakpoint
ALTER TYPE "public"."audit_reason_code" ADD VALUE 'ContactReviewReconciledAfterBookingLinked' BEFORE 'AccountRegistered';