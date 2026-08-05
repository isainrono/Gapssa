<?php

namespace Espo\Modules\GoogleCalendarSync\Classes;

use Espo\Core\Exceptions\Error;
use Espo\Core\Utils\Crypt;
use Espo\ORM\Entity;
use Espo\ORM\EntityManager;
use Google\Client as GoogleClient;

/**
 * Almacena y renueva tokens OAuth de una GcsAccount.
 *
 * La renovación la realiza google/apiclient; aquí solo se persiste el
 * resultado, cifrado con las utilidades de EspoCRM (Crypt).
 */
class TokenService
{
    private const EXPIRY_MARGIN_SECONDS = 120;

    public function __construct(
        private EntityManager $entityManager,
        private Crypt $crypt,
        private Messages $messages
    ) {}

    /**
     * Guarda la respuesta del endpoint de tokens en la cuenta (cifrada).
     *
     * @param array<string, mixed> $tokenResponse Respuesta de google/apiclient.
     */
    public function storeTokens(Entity $account, array $tokenResponse): void
    {
        if (!empty($tokenResponse['access_token'])) {
            $account->set('accessToken', $this->crypt->encrypt($tokenResponse['access_token']));
        }

        if (!empty($tokenResponse['refresh_token'])) {
            $account->set('refreshToken', $this->crypt->encrypt($tokenResponse['refresh_token']));
        }

        $expiresIn = (int) ($tokenResponse['expires_in'] ?? 3600);

        $account->set('tokenExpiresAt', gmdate('Y-m-d H:i:s', time() + $expiresIn));
        $account->set('status', 'Active');
        $account->set('lastError', null);

        $this->entityManager->saveEntity($account, ['silent' => true]);
    }

    /**
     * Devuelve un access token válido, renovándolo con el refresh token si está
     * caducado. El cliente recibido debe estar configurado con clientId/secret.
     *
     * @throws Error si la cuenta no tiene refresh token.
     * @throws GoogleApiException si Google rechaza la renovación.
     */
    public function getAccessToken(Entity $account, GoogleClient $client): string
    {
        $expiresAt = $account->get('tokenExpiresAt');

        $isExpired = !$expiresAt ||
            strtotime($expiresAt . ' UTC') - self::EXPIRY_MARGIN_SECONDS <= time();

        $encryptedAccessToken = $account->get('accessToken');

        if (!$isExpired && $encryptedAccessToken) {
            return $this->crypt->decrypt($encryptedAccessToken);
        }

        $refreshToken = $this->getRefreshTokenPlain($account);

        if (!$refreshToken) {
            throw new Error($this->messages->get(
                'refreshTokenMissing',
                'This account has no refresh token. Connect it to Google again.'
            ));
        }

        $tokenResponse = $client->fetchAccessTokenWithRefreshToken($refreshToken);

        if (!empty($tokenResponse['error'])) {
            $this->handleRefreshError($account, $tokenResponse);
        }

        $this->storeTokens($account, $tokenResponse);

        return $tokenResponse['access_token'];
    }

    /**
     * Devuelve el refresh token descifrado o null.
     */
    public function getRefreshTokenPlain(Entity $account): ?string
    {
        $encrypted = $account->get('refreshToken');

        return $encrypted ? $this->crypt->decrypt($encrypted) : null;
    }

    /**
     * Devuelve el access token descifrado sin renovar, o null.
     */
    public function getAccessTokenPlain(Entity $account): ?string
    {
        $encrypted = $account->get('accessToken');

        return $encrypted ? $this->crypt->decrypt($encrypted) : null;
    }

    /**
     * Borra los tokens de la cuenta.
     */
    public function clearTokens(Entity $account): void
    {
        $account->set('accessToken', null);
        $account->set('refreshToken', null);
        $account->set('tokenExpiresAt', null);
        $account->set('oauthState', null);
        $account->set('status', 'Disconnected');

        $this->entityManager->saveEntity($account, ['silent' => true]);
    }

    /**
     * @param array<string, mixed> $tokenResponse
     * @throws GoogleApiException
     */
    private function handleRefreshError(Entity $account, array $tokenResponse): never
    {
        $reason = (string) $tokenResponse['error'];
        $description = (string) ($tokenResponse['error_description'] ?? '');

        if ($reason === 'invalid_grant') {
            $account->set('status', 'Error');
            $account->set('lastError', $this->messages->get(
                'invalidGrant',
                'The refresh token is no longer valid (invalid_grant). Connect the account again. ' .
                'Common causes: the OAuth app is still in Testing mode, or access was revoked.'
            ));

            $this->entityManager->saveEntity($account, ['silent' => true]);
        }

        throw new GoogleApiException(
            401,
            $this->messages->get(
                'oauthError',
                'OAuth error: {reason}. {description}',
                ['reason' => $reason, 'description' => $description]
            ),
            $reason
        );
    }
}
