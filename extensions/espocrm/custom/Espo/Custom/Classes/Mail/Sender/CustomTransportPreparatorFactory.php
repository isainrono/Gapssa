<?php

namespace Espo\Custom\Classes\Mail\Sender;

use Espo\Core\InjectableFactory;
use Espo\Core\Mail\Sender\DefaultTransportPreparator;
use Espo\Core\Mail\Sender\TransportPreparator;
use Espo\Core\Mail\Sender\TransportPreparatorFactory;
use Espo\Core\Mail\SmtpParams;

/**
 * Fábrica de preparador de transporte SMTP que garantiza que cualquier
 * envío saliente de EspoCRM utilice CustomTransportPreparator, permitiendo
 * el certificado autofirmado de Plesk en el puerto 587 (STARTTLS).
 */
class CustomTransportPreparatorFactory extends TransportPreparatorFactory
{
    public function __construct(
        private InjectableFactory $injectableFactory,
    ) {
        parent::__construct($injectableFactory);
    }

    public function create(SmtpParams $smtpParams): TransportPreparator
    {
        $className = $smtpParams->getTransportPreparatorClassName() ?? CustomTransportPreparator::class;

        if ($className === DefaultTransportPreparator::class || empty($className)) {
            $className = CustomTransportPreparator::class;
        }

        return $this->injectableFactory->create($className);
    }
}
