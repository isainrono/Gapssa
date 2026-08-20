<?php

namespace Espo\Custom\Classes\RecordHooks\Meeting;

/**
 * "Fase 4B — flujo de decisión final", hueco 3/4 del encargo. Copia exacta
 * de `MEETING_RESOLUTION_COMPATIBLE_REASONS`/`isMeetingResolutionReasonCompatible`
 * (`packages/contracts/src/booking.ts`) — no cambiar un lado sin el otro.
 * Clase pura (sin `Espo\...` en sus imports), consumida por `PutDecide`
 * (valida ANTES de escribir) y, en el lado TypeScript, por
 * `deriveResolutionFromDecidedMeeting` (falla seguro ante una combinación
 * que esta política no reconoce como válida).
 */
final class MeetingResolutionPolicy
{
    private const COMPATIBLE_REASONS = [
        'Confirmed' => [MeetingResolutionReason::APPROVED],
        'Canceled' => [MeetingResolutionReason::REJECTED_BY_STAFF, MeetingResolutionReason::APPROVAL_EXPIRED],
    ];

    /**
     * ¿Es `$reason` un motivo admitido para el destino `$cEstadoReserva`?
     * Cualquier `cEstadoReserva` ajeno a Confirmed/Canceled devuelve
     * siempre `false` — esos estados nunca deben llevar un motivo de esta
     * lista (requisito explícito del encargo: "otros estados no deben
     * recibir un motivo inventado").
     */
    public static function isCompatible(string $cEstadoReserva, string $reason): bool
    {
        if (!MeetingResolutionReason::isValid($reason)) {
            return false;
        }

        $allowed = self::COMPATIBLE_REASONS[$cEstadoReserva] ?? null;

        if ($allowed === null) {
            return false;
        }

        return in_array($reason, $allowed, true);
    }

    /**
     * ¿Es `$note` aceptable para este `$reason`? RejectedByStaff exige una
     * nota humana no vacía y no compuesta únicamente por espacios
     * (`trim($note) !== ''`) — el rechazo debe conservar un motivo
     * operativo real, nunca uno ausente ni uno en blanco disfrazado de
     * presente. ApprovalExpired admite únicamente `null` (ninguna nota) o
     * exactamente `MeetingResolutionReason::EXPIRY_TECHNICAL_NOTE` — nunca
     * texto libre, para que una caducidad de sistema no pueda simular un
     * motivo operativo que nadie escribió. Approved no impone ninguna
     * restricción propia sobre `note` (puede llevar una nota informativa
     * opcional de aprobación, sin ningún requisito de negocio sobre su
     * contenido).
     */
    public static function isNoteAcceptable(string $reason, ?string $note): bool
    {
        return match ($reason) {
            MeetingResolutionReason::REJECTED_BY_STAFF => is_string($note) && trim($note) !== '',
            MeetingResolutionReason::APPROVAL_EXPIRED => $note === null || $note === MeetingResolutionReason::EXPIRY_TECHNICAL_NOTE,
            default => true,
        };
    }
}
