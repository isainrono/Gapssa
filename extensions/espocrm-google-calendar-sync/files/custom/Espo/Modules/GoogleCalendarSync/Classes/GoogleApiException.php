<?php

namespace Espo\Modules\GoogleCalendarSync\Classes;

use Exception;

/**
 * Error OAuth normalizado.
 *
 * google/apiclient devuelve los errores del endpoint de tokens como array
 * (`['error' => ..., 'error_description' => ...]`) en lugar de lanzarlos; esta
 * excepción los convierte en un fallo explícito. Los errores de la API de
 * Calendar sí llegan como `Google\Service\Exception` y se tratan directamente.
 *
 * Nunca contiene tokens.
 */
class GoogleApiException extends Exception
{
    public function __construct(
        private int $statusCode,
        string $message,
        private ?string $reason = null
    ) {
        parent::__construct($message, $statusCode);
    }

    public function getStatusCode(): int
    {
        return $this->statusCode;
    }

    public function getReason(): ?string
    {
        return $this->reason;
    }
}
