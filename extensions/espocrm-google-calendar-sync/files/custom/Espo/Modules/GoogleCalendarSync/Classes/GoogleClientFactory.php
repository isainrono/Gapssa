<?php

namespace Espo\Modules\GoogleCalendarSync\Classes;

use Espo\Core\Exceptions\Error;
use Espo\Core\Utils\Config;
use Espo\Core\Utils\Log;
use Espo\ORM\Entity;
use Google\Client as GoogleClient;
use Google\Service\Calendar as CalendarService;

/**
 * Construye clientes autenticados de la librería oficial google/apiclient.
 */
class GoogleClientFactory
{
    private const APPLICATION_NAME = 'EspoCRM Google Calendar Sync';

    /** Scopes mínimos: gestionar eventos + listar calendarios. */
    public const SCOPES = [
        CalendarService::CALENDAR_EVENTS,
        CalendarService::CALENDAR_CALENDARLIST_READONLY,
    ];

    public function __construct(
        private Config $config,
        private Log $log,
        private TokenService $tokenService,
        private Messages $messages
    ) {}

    /**
     * Cliente sin tokens, listo para el flujo de autorización.
     *
     * @throws Error si faltan credenciales en la configuración.
     */
    public function createBare(): GoogleClient
    {
        $clientId = $this->config->get('gcsClientId');
        $clientSecret = $this->config->get('gcsClientSecret');

        if (!$clientId || !$clientSecret) {
            throw new Error($this->messages->get(
                'clientCredentialsMissing',
                'Google Client ID or Client Secret is not configured. ' .
                'Set them in Administration → Google Calendar Sync → Settings.'
            ));
        }

        $client = new GoogleClient();

        $client->setApplicationName(self::APPLICATION_NAME);
        $client->setClientId($clientId);
        $client->setClientSecret($clientSecret);
        $client->setRedirectUri($this->getRedirectUri());
        $client->setScopes(self::SCOPES);
        $client->setAccessType('offline');
        $client->setPrompt('consent');
        $client->setIncludeGrantedScopes(true);
        $client->setLogger($this->log);

        return $client;
    }

    /**
     * Cliente autenticado con los tokens de la cuenta, renovándolos si hace falta.
     *
     * @throws Error
     * @throws GoogleApiException
     */
    public function createForAccount(Entity $account): GoogleClient
    {
        $client = $this->createBare();

        $client->setAccessToken([
            'access_token' => $this->tokenService->getAccessToken($account, $client),
            'expires_in' => 3600,
            'created' => time(),
        ]);

        return $client;
    }

    /**
     * Servicio de Google Calendar autenticado para la cuenta.
     *
     * @throws Error
     * @throws GoogleApiException
     */
    public function createCalendarService(Entity $account): CalendarService
    {
        return new CalendarService($this->createForAccount($account));
    }

    /**
     * @throws Error
     */
    public function getRedirectUri(): string
    {
        $redirectUri = $this->config->get('gcsRedirectUri');

        if ($redirectUri) {
            return $redirectUri;
        }

        $siteUrl = rtrim((string) $this->config->get('siteUrl'), '/');

        if (!$siteUrl) {
            throw new Error($this->messages->get(
                'redirectUriMissing',
                'Configure the OAuth Redirect URI, or set the Site URL in Administration → Settings.'
            ));
        }

        return $siteUrl . '/?entryPoint=gcsCallback';
    }
}
