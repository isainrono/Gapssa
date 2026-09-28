<?php

namespace Espo\Custom\Controllers;

use Espo\Core\Api\Request;
use Espo\Core\Api\Response;
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
    public function postActionSetAcceptanceStatus(Request $request, Response $response): void
    {
        parent::postActionSetAcceptanceStatus($request, $response);

        try {
            $data = $request->getParsedBody();
            $id = $data->id ?? null;
            $status = $data->status ?? null;

            if ($id && $status === 'Accepted') {
                $em = $this->getEntityManager();
                $meeting = $em->getEntity('Meeting', $id);

                if ($meeting) {
                    $meeting->set([
                        'cEstadoReserva' => 'Confirmed',
                        'color' => '#10B981',
                        'cMotivoResolucionReserva' => 'Approved',
                        'status' => 'Planned',
                    ]);
                    $em->saveEntity($meeting);

                    /** @var BookingConfirmationSender $sender */
                    $sender = $this->getInjectableFactory()->create(BookingConfirmationSender::class);
                    $sender->sendConfirmation($meeting);
                }
            }
        } catch (\Throwable $e) {
            $this->getLog()->error("Error en postActionSetAcceptanceStatus confirmación GAPSSA: " . $e->getMessage());
        }
    }
}
