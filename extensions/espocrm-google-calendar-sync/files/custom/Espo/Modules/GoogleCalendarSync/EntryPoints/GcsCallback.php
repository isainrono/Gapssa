<?php

namespace Espo\Modules\GoogleCalendarSync\EntryPoints;

use Espo\Core\Api\Request;
use Espo\Core\Api\Response;
use Espo\Core\EntryPoint\EntryPoint;
use Espo\Core\Exceptions\BadRequest;
use Espo\Core\Exceptions\Forbidden;
use Espo\Core\Utils\Log;
use Espo\Entities\User;
use Espo\Modules\GoogleCalendarSync\Classes\Messages;
use Espo\Modules\GoogleCalendarSync\Classes\OAuthService;
use Throwable;

/**
 * Callback OAuth de Google: {siteUrl}/?entryPoint=gcsCallback
 *
 * Requiere sesión autenticada de EspoCRM (sin trait NoAuth): el administrador
 * debe estar conectado al CRM en el mismo navegador.
 */
class GcsCallback implements EntryPoint
{
    public function __construct(
        private OAuthService $oauthService,
        private User $user,
        private Log $log
    ) {}

    public function run(Request $request, Response $response): void
    {
        $error = $request->getQueryParam('error');

        if ($error) {
            // El usuario denegó el acceso u ocurrió un error en Google.
            $this->redirect($response, '#GcsAccount');

            return;
        }

        $code = $request->getQueryParam('code');
        $state = $request->getQueryParam('state');

        if (!$code || !$state) {
            throw new BadRequest($this->messages->get(
                'oauthMissingParams',
                "Missing 'code' or 'state' parameter."
            ));
        }

        if (!$this->user->isAdmin()) {
            // Fase 1: solo el administrador conecta cuentas.
            throw new Forbidden($this->messages->get('adminOnly', 'Only an administrator can manage Google accounts.'));
        }

        try {
            $account = $this->oauthService->handleCallback($code, $state);
        } catch (Throwable $e) {
            $this->log->error('GoogleCalendarSync callback: ' . $e->getMessage());

            throw $e;
        }

        $this->redirect($response, '#GcsAccount/view/' . $account->getId());
    }

    private function redirect(Response $response, string $fragment): void
    {
        $response
            ->setStatus(302)
            ->setHeader('Location', './' . $fragment);
    }
}
