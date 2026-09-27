<?php

namespace Espo\Custom\Classes\Mail\Sender;

use Espo\Core\Mail\Sender\DefaultTransportPreparator;
use Espo\Core\Mail\SmtpParams;
use Symfony\Component\Mailer\Transport\Smtp\EsmtpTransport;
use Symfony\Component\Mailer\Transport\Smtp\Stream\SocketStream;
use Symfony\Component\Mailer\Transport\TransportInterface;

/**
 * Preparador de transporte SMTP que permite certificados SSL/TLS autofirmados
 * del servidor Plesk del host VPS en STARTTLS (puerto 587).
 */
class CustomTransportPreparator extends DefaultTransportPreparator
{
    public function prepare(SmtpParams $smtpParams): TransportInterface
    {
        @stream_context_set_default([
            'ssl' => [
                'verify_peer' => false,
                'verify_peer_name' => false,
                'allow_self_signed' => true,
            ],
        ]);

        $transport = parent::prepare($smtpParams);

        if ($transport instanceof EsmtpTransport) {
            $stream = $transport->getStream();

            if ($stream instanceof SocketStream) {
                $stream->setStreamOptions([
                    'ssl' => [
                        'verify_peer' => false,
                        'verify_peer_name' => false,
                        'allow_self_signed' => true,
                    ],
                ]);
            }
        }

        return $transport;
    }
}
