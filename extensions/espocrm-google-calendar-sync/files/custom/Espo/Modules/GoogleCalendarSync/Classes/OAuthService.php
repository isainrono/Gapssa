<?php

namespace Espo\Modules\GoogleCalendarSync\Classes;

use Espo\Core\Exceptions\BadRequest;
use Espo\Core\Exceptions\Error;
use Espo\Core\Exceptions\Forbidden;
use Espo\Core\Utils\Config;
use Espo\Core\Utils\Config\ConfigWriter;
use Espo\Core\Utils\Log;
use Espo\ORM\Entity;
use Espo\ORM\EntityManager;
use Google\Service\Calendar as CalendarService;
use Google\Service\Calendar\CalendarListEntry;
use Google\Service\Exception as GoogleServiceException;
use Throwable;

/**
 * Flujo OAuth 2.0 de Google para cuentas GcsAccount, sobre google/apiclient.
 */
class OAuthService
{
    public function __construct(
        private Config $config,
        private ConfigWriter $configWriter,
        private EntityManager $entityManager,
        private GoogleClientFactory $clientFactory,
        private TokenService $tokenService,
        private Messages $messages,
        private Log $log
    ) {}

    /**
     * Construye la URL de autorización y guarda el state anti-CSRF en la cuenta.
     *
     * @throws Error si falta configuración.
     */
    public function buildAuthUrl(Entity $account): string
    {
        $client = $this->clientFactory->createBare();

        $state = $account->getId() . '_' . bin2hex(random_bytes(16));

        $account->set('oauthState', $state);

        $this->entityManager->saveEntity($account, ['silent' => true]);

        $client->setState($state);

        return $client->createAuthUrl();
    }

    /**
     * Procesa el callback OAuth: valida el state, canjea el code y guarda tokens.
     *
     * @return Entity la cuenta conectada.
     * @throws BadRequest
     * @throws Forbidden
     * @throws Error
     * @throws GoogleApiException
     */
    public function handleCallback(string $code, string $state): Entity
    {
        $accountId = explode('_', $state)[0] ?? '';

        if (!$accountId) {
            throw new BadRequest($this->messages->get('oauthStateInvalid', 'Invalid OAuth state.'));
        }

        $account = $this->entityManager->getEntityById('GcsAccount', $accountId);

        if (!$account) {
            throw new BadRequest($this->messages->get('accountNotFound', 'Google account not found.'));
        }

        $storedState = $account->get('oauthState');

        if (!$storedState || !hash_equals($storedState, $state)) {
            throw new Forbidden($this->messages->get(
                'oauthStateMismatch',
                'OAuth state does not match (possible CSRF). Start the connection again.'
            ));
        }

        $account->set('oauthState', null);

        $client = $this->clientFactory->createBare();

        $tokenResponse = $client->fetchAccessTokenWithAuthCode($code);

        if (!empty($tokenResponse['error'])) {
            throw new GoogleApiException(
                400,
                $this->messages->get(
                    'oauthError',
                    'OAuth error: {reason}. {description}',
                    [
                        'reason' => (string) $tokenResponse['error'],
                        'description' => (string) ($tokenResponse['error_description'] ?? ''),
                    ]
                ),
                (string) $tokenResponse['error']
            );
        }

        if (empty($tokenResponse['refresh_token']) && !$account->get('refreshToken')) {
            throw new Error($this->messages->get(
                'noRefreshTokenReturned',
                'Google did not return a refresh token. Revoke access at ' .
                'https://myaccount.google.com/permissions and connect again.'
            ));
        }

        $this->tokenService->storeTokens($account, $tokenResponse);

        try {
            $this->refreshCalendarList($account);
        } catch (Throwable $e) {
            // La conexión ya es válida; la lista se puede recargar después.
            $this->log->warning(
                'GoogleCalendarSync: could not load the calendar list: ' . $e->getMessage()
            );
        }

        if ($account->get('type') === 'Business' && !$this->config->get('gcsSyncStartAt')) {
            $this->configWriter->set('gcsSyncStartAt', gmdate('Y-m-d H:i:s'));
            $this->configWriter->save();
        }

        return $account;
    }

    /**
     * Recarga la lista de calendarios (con permiso de escritura) y la cachea.
     *
     * @return array<int, array{id: string, summary: string, primary: bool}>
     * @throws GoogleServiceException
     * @throws Error
     * @throws GoogleApiException
     */
    public function refreshCalendarList(Entity $account): array
    {
        $service = $this->clientFactory->createCalendarService($account);

        $list = [];
        $pageToken = null;

        do {
            $params = ['maxResults' => 250, 'minAccessRole' => 'writer'];

            if ($pageToken) {
                $params['pageToken'] = $pageToken;
            }

            $response = $service->calendarList->listCalendarList($params);

            /** @var CalendarListEntry $item */
            foreach ($response->getItems() as $item) {
                $id = $item->getId();

                if (!$id) {
                    continue;
                }

                $isPrimary = (bool) $item->getPrimary();

                if ($isPrimary) {
                    $account->set('googleEmail', $id);
                }

                $list[] = [
                    'id' => $id,
                    'summary' => $item->getSummaryOverride() ?: ($item->getSummary() ?: $id),
                    'primary' => $isPrimary,
                ];
            }

            $pageToken = $response->getNextPageToken();
        } while ($pageToken);

        $account->set('calendarListCache', json_encode($list, JSON_UNESCAPED_UNICODE));

        $calendarId = $account->get('calendarId');

        if ($calendarId) {
            foreach ($list as $item) {
                if ($item['id'] === $calendarId) {
                    $account->set('calendarSummary', $item['summary']);

                    break;
                }
            }
        }

        $this->entityManager->saveEntity($account, ['silent' => true]);

        return $list;
    }

    /**
     * Desconecta la cuenta: revoca tokens (best-effort) y los borra.
     */
    public function disconnect(Entity $account): void
    {
        $token = $this->tokenService->getRefreshTokenPlain($account)
            ?? $this->tokenService->getAccessTokenPlain($account);

        if ($token) {
            try {
                $this->clientFactory->createBare()->revokeToken($token);
            } catch (Throwable $e) {
                $this->log->warning(
                    'GoogleCalendarSync: could not revoke the token at Google: ' . $e->getMessage()
                );
            }
        }

        $this->tokenService->clearTokens($account);
    }
}
