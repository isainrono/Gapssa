<?php

namespace Espo\Modules\GoogleCalendarSync\Api;

use Espo\Core\Api\Action;
use Espo\Core\Api\Request;
use Espo\Core\Api\Response;
use Espo\Core\Api\ResponseComposer;
use Espo\Core\Exceptions\BadRequest;
use Espo\Core\Exceptions\Forbidden;
use Espo\Core\Exceptions\NotFound;
use Espo\Entities\User;
use Espo\Modules\GoogleCalendarSync\Classes\Messages;
use Espo\Modules\GoogleCalendarSync\Classes\OAuthService;
use Espo\ORM\EntityManager;

/**
 * GET GcsSync/authUrl?id={gcsAccountId} — devuelve la URL de autorización de Google.
 */
class GetAuthUrl implements Action
{
    public function __construct(
        private OAuthService $oauthService,
        private EntityManager $entityManager,
        private User $user,
        private Messages $messages
    ) {}

    public function process(Request $request): Response
    {
        $id = $request->getQueryParam('id');

        if (!$id) {
            throw new BadRequest($this->messages->get('missingId', "Missing 'id' parameter."));
        }

        $account = $this->entityManager->getEntityById('GcsAccount', $id);

        if (!$account) {
            throw new NotFound($this->messages->get('accountNotFound', 'Google account not found.'));
        }

        if (!$this->user->isAdmin()) {
            // Fase 1: solo el administrador conecta cuentas.
            throw new Forbidden($this->messages->get('adminOnly', 'Only an administrator can manage Google accounts.'));
        }

        $authUrl = $this->oauthService->buildAuthUrl($account);

        return ResponseComposer::json(['authUrl' => $authUrl]);
    }
}
