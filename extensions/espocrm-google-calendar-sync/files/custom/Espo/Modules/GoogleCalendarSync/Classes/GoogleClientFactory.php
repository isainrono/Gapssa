<?php

namespace Espo\Modules\GoogleCalendarSync\Classes;

use Espo\Core\Exceptions\Error;
use Espo\Core\Utils\Config;
use Espo\Core\Utils\Log;
use Espo\ORM\Entity;
use Google\Client as GoogleClient;
use Google\Service\Calendar as CalendarService;
use GuzzleHttp\ClientInterface as GuzzleClientInterface;

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

    /**
     * Transporte HTTP alternativo — SOLO para ensayos desechables. Cuando se
     * inyecta (vía `setHttpClientOverride()`), sustituye el cliente Guzzle
     * por defecto de google/apiclient, así que TODO el tráfico saliente de
     * la librería —incluida la renovación OAuth en `TokenService`, no solo
     * las llamadas a la API de Calendar— se dirige hacia el servidor que
     * indique el ensayo, nunca hacia Google real. Ningún código de
     * producción llama a `setHttpClientOverride()`; por defecto queda en
     * `null` y `createBare()` no cambia de comportamiento.
     */
    private ?GuzzleClientInterface $httpClientOverride = null;

    public function __construct(
        private Config $config,
        private Log $log,
        private TokenService $tokenService,
        private Messages $messages
    ) {}

    /**
     * Solo para ensayos desechables (ver `$httpClientOverride`). Nunca
     * invocar desde código de producción.
     */
    public function setHttpClientOverride(GuzzleClientInterface $httpClient): void
    {
        $this->httpClientOverride = $httpClient;
    }

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

        if ($this->httpClientOverride) {
            // Solo en ensayos desechables: ver el docblock de
            // `$httpClientOverride`. En producción esto nunca se ejecuta.
            $client->setHttpClient($this->httpClientOverride);
        }

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
