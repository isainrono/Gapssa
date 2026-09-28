<?php

namespace Espo\Custom\Controllers;

use Espo\Core\Api\Request;
use Espo\Custom\Classes\Mail\BookingConfirmationSender;
use Espo\Modules\Crm\Controllers\Meeting as BaseMeeting;

/**
 * Controlador personalizado de Meeting para GAPSSA.
 * Intercepta cuando un profesional (como Diana) acepta la cita en el calendario
 * o panel de reunión para confirmar el estado en verde y enviar automáticamente
 * la confirmación al cliente con la plantilla oficial.
 */
class Meeting extends BaseMeeting
{
    public function postActionSetAcceptanceStatus(Request $request): bool
    {
        $result = parent::postActionSetAcceptanceStatus($request);

        try {
            $body = $request->getParsedBody();
            $id = is_object($body) ? ($body->id ?? null) : (is_array($body) ? ($body['id'] ?? null) : null);
            $status = is_object($body) ? ($body->status ?? null) : (is_array($body) ? ($body['status'] ?? null) : null);

            if ($id && $status === 'Accepted') {
                /** @var BookingConfirmationSender $sender */
                $sender = $this->injectableFactory->create(BookingConfirmationSender::class);
                $sender->sendConfirmationById((string) $id);
            }
        } catch (\Throwable $e) {
            error_log("GAPSSA Acceptance Notification: " . $e->getMessage());
        }

        return $result;
    }
}
