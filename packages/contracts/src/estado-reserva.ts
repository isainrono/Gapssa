/**
 * Espejo exacto del campo custom `cEstadoReserva` de `Meeting` en EspoCRM
 * (extensions/espocrm/custom/Espo/Custom/Resources/metadata/entityDefs/Meeting.json).
 * Los 12 estados de negocio vienen de PROJECT_CONTEXT.md §6.3. Cambiar un
 * lado sin el otro rompe el contrato con el CRM.
 */
export const ESTADOS_RESERVA = [
  "RequestReceived",
  "PendingGuardianAuthorization",
  "PendingAssessment",
  "PendingCenterApproval",
  "Confirmed",
  "ClientArrived",
  "InTreatment",
  "Completed",
  "Canceled",
  "NoShow",
  "RescheduleRequested",
  "ScheduleConflict",
] as const;

export type EstadoReserva = (typeof ESTADOS_RESERVA)[number];

/**
 * `cEstadoReserva` es opcional y **sin valor por defecto** en EspoCRM
 * (corrección de Fase 0: el default original "RequestReceived" se retiró
 * porque el campo también cubre reuniones internas e importadas que nunca
 * pasan por el portal). `null`/ausente se interpreta como "fuera del flujo
 * de reservas del portal" — ver docs/espocrm-modelo-inicial.md. Los flujos
 * del portal deben asignar el estado explícitamente en cada transición
 * (el primero que escriben es "PendingCenterApproval", nunca confían en un
 * valor implícito).
 */
export type EstadoReservaDeMeeting = EstadoReserva | null;

/**
 * Estados nativos de `Meeting.status` en EspoCRM (Planned/Held/Not Held).
 * Gobiernan la semántica de calendario y la extensión Google Calendar Sync
 * (`canceledStatusList: ["Not Held"]`, `completedStatusList: ["Held"]`,
 * `activityStatusList: ["Planned"]`). No confundir con EstadoReserva: son
 * dos campos independientes en el mismo Meeting.
 */
export const ESTADOS_MEETING_NATIVOS = ["Planned", "Held", "Not Held"] as const;
export type EstadoMeetingNativo = (typeof ESTADOS_MEETING_NATIVOS)[number];

/**
 * Mapeo obligatorio entre `cEstadoReserva` y el `status` nativo. Desde la
 * revisión 3, la garantía de que ambos campos queden sincronizados no
 * depende de que el BFF escriba los dos a la vez: un hook propio de
 * EspoCRM (diseño en docs/contratos-portal-v1.md §3, no implementado
 * todavía — Fase 4) aplica este mismo mapeo dentro del propio guardado del
 * Meeting, para que también funcione cuando Gapssa cambia
 * `cEstadoReserva` directamente desde la interfaz de EspoCRM. Justificación
 * fila a fila en docs/contratos-portal-v1.md §6 — no cambiar un valor aquí
 * sin actualizar esa justificación (y su reflejo en PHP).
 *
 * Nota: el flujo automático de reserva de invitado (booking.ts) nunca
 * escribe "RequestReceived" (crea el Meeting directamente en
 * "PendingCenterApproval"); ese valor queda disponible para otros canales
 * de alta (teléfono, presencial, alta interna) que sí puedan usarlo como
 * primer estado.
 */
export const ESTADO_RESERVA_A_MEETING_STATUS: Readonly<
  Record<EstadoReserva, EstadoMeetingNativo>
> = {
  RequestReceived: "Planned",
  PendingGuardianAuthorization: "Planned",
  PendingAssessment: "Planned",
  PendingCenterApproval: "Planned",
  Confirmed: "Planned",
  ClientArrived: "Planned",
  InTreatment: "Planned",
  Completed: "Held",
  Canceled: "Not Held",
  NoShow: "Not Held",
  RescheduleRequested: "Planned",
  ScheduleConflict: "Planned",
};
