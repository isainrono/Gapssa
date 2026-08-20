<?php

namespace Espo\Custom\Classes\Api\GapssaMeetingDecision;

use PDO;

/**
 * Fase 4B, revisión OCC 2, punto 7 del encargo (idempotencia). Tabla propia
 * `gapssa_meeting_decision_operation` (DDL en `sql/install.sql`, NO
 * ejecutada contra ninguna instancia real — solo contra el EspoCRM
 * desechable de este ensayo), fuera del modelo de entidades de EspoCRM a
 * propósito: es bookkeeping puro de esta acción, no un dato de negocio que
 * deba pasar por Studio/ACL/stream. Se accede vía PDO directo
 * (`EntityManager::getPDO()`) para participar en la MISMA conexión/
 * transacción que `PutDecide` ya tiene abierta — nunca una conexión
 * separada, que rompería la atomicidad.
 *
 * Diseño deliberado sin estado intermedio "pending": la fila de una
 * operación solo se escribe (INSERT) dentro de la MISMA transacción que la
 * propia decisión, justo antes del único COMMIT de `PutDecide`. Si la
 * transacción se revierte por cualquier motivo (CAS perdido tratado como
 * excepción, fallo inyectado, error interno), la fila NUNCA llega a
 * existir — un reintento con la misma clave no encuentra nada y vuelve a
 * ejecutar desde cero, exactamente el comportamiento correcto para
 * cualquier fallo ANTES del commit. Un fallo DESPUÉS del commit pero antes
 * de que la respuesta llegue al llamante (el último punto de la matriz de
 * fallos, punto 6 del encargo) es, por construcción, el ÚNICO caso donde la
 * fila SÍ existe — un reintento la encuentra y devuelve el mismo resultado
 * ya confirmado, sin volver a ejecutar nada. No hace falta un job de
 * limpieza de operaciones "colgadas": no puede haberlas.
 *
 * Solo se persisten enums/ids opacos y un hash — nunca el cuerpo íntegro
 * de la petición (podría llevar `note`/motivo de texto libre) ni ningún
 * secreto.
 */
final class DecisionIdempotencyStore
{
    private const TABLE = 'gapssa_meeting_decision_operation';

    public function __construct(private PDO $pdo)
    {}

    /**
     * Hash estable del payload relevante para detectar "misma clave, payload
     * distinto" (encargo, punto 7) — nunca almacena el payload en claro.
     * "Fase 4B — flujo de decisión final": incluye `resultReason` (motivo
     * cerrado, nunca PII) — "misma clave + payload distinto, incluido
     * reason/note -> 409" exige que un cambio de motivo por sí solo cambie
     * el hash, exactamente igual que un cambio de `decision`/`note`.
     */
    public static function hashPayload(string $meetingId, string $decision, string $resultReason, ?string $note): string
    {
        $canonical = json_encode([
            'meetingId' => $meetingId,
            'decision' => $decision,
            'resultReason' => $resultReason,
            // Se incluye la LONGITUD y un hash del motivo, nunca el texto,
            // para que un motivo distinto SÍ cambie el hash (detecta
            // "mismo id, payload distinto") sin persistir el texto libre
            // en ningún sitio, ni siquiera de forma indirecta reversible.
            'noteHash' => $note !== null ? hash('sha256', $note) : null,
        ], JSON_THROW_ON_ERROR);

        return hash('sha256', $canonical);
    }

    /**
     * @return array{resultStatus: string, resultHttpStatus: int, resultBody: string}|null
     */
    public function findByKey(string $operationKey): ?array
    {
        $statement = $this->pdo->prepare(
            'SELECT payload_hash, result_status, result_http_status, result_body '
                . 'FROM ' . self::TABLE . ' WHERE operation_key = :operationKey LIMIT 1'
        );
        $statement->execute(['operationKey' => $operationKey]);

        /** @var array{payload_hash: string, result_status: string, result_http_status: int, result_body: string}|false $row */
        $row = $statement->fetch(PDO::FETCH_ASSOC);

        if ($row === false) {
            return null;
        }

        return [
            'payloadHash' => $row['payload_hash'],
            'resultStatus' => $row['result_status'],
            'resultHttpStatus' => (int) $row['result_http_status'],
            'resultBody' => $row['result_body'],
        ];
    }

    public function record(
        string $operationKey,
        string $meetingId,
        string $payloadHash,
        string $decision,
        string $resultStatus,
        ?string $resultCEstadoReserva,
        int $resultHttpStatus,
        string $resultBodyJson,
    ): void {
        $statement = $this->pdo->prepare(
            'INSERT INTO ' . self::TABLE . ' '
                . '(operation_key, meeting_id, payload_hash, decision, result_status, '
                . 'result_c_estado_reserva, result_http_status, result_body, created_at) '
                . 'VALUES (:operationKey, :meetingId, :payloadHash, :decision, :resultStatus, '
                . ':resultCEstadoReserva, :resultHttpStatus, :resultBody, :createdAt)'
        );

        $statement->execute([
            'operationKey' => $operationKey,
            'meetingId' => $meetingId,
            'payloadHash' => $payloadHash,
            'decision' => $decision,
            'resultStatus' => $resultStatus,
            'resultCEstadoReserva' => $resultCEstadoReserva,
            'resultHttpStatus' => $resultHttpStatus,
            'resultBody' => $resultBodyJson,
            'createdAt' => gmdate('Y-m-d H:i:s'),
        ]);
    }
}
