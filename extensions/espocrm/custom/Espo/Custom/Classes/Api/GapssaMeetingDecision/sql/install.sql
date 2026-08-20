-- Fase 4B, revisión OCC 2 — tabla de idempotencia de `PutDecide`.
--
-- NO ejecutado contra ninguna instancia real de EspoCRM. Solo se aplica
-- contra el EspoCRM 10.0.3 desechable de este ensayo
-- (docs/fase4b-occ-revision-2.md). Aplicar contra la instancia real
-- requeriría un paso manual explícito y autorización aparte, igual que el
-- resto de `extensions/espocrm/custom` en esta fase.
--
-- InnoDB explícito: el propósito entero de esta tabla es participar en
-- transacciones reales (BEGIN/COMMIT/ROLLBACK) desde `PutDecide` — MyISAM
-- (sin soporte transaccional) rompería la atomicidad que esta tabla existe
-- para sostener.
CREATE TABLE IF NOT EXISTS gapssa_meeting_decision_operation (
    operation_key           VARCHAR(128) NOT NULL,
    meeting_id               VARCHAR(36)  NOT NULL,
    payload_hash              CHAR(64)     NOT NULL,
    decision                 VARCHAR(32)  NOT NULL,
    result_status             VARCHAR(16)  NOT NULL,
    result_c_estado_reserva  VARCHAR(64)  NULL,
    result_http_status       SMALLINT     NOT NULL,
    result_body               TEXT         NOT NULL,
    created_at                DATETIME     NOT NULL,
    PRIMARY KEY (operation_key),
    KEY idx_gapssa_mdo_meeting_id (meeting_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
