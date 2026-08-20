<?php

declare(strict_types=1);

namespace Espo\Custom\Classes\Api\GapssaMeetingDecision;

/**
 * "Corrección de puerta 4" — política cerrada de autorización de
 * `PutDecide`, sustituye la regla anterior "cualquier usuario `type=api`
 * autorizado siempre". Esa regla era demasiado amplia: el TIPO de usuario
 * no es autorización — un API User cualquiera creado en el futuro (o
 * comprometido) para otro integrador nunca debería poder decidir reservas
 * solo por su tipo.
 *
 * Regla cerrada, en este orden:
 *
 * 1. Administrador (`isAdmin === true`) -> autorizado siempre, mismo
 *    criterio que el resto de EspoCRM.
 * 2. Usuario `type === 'api'` -> autorizado ÚNICAMENTE si su id aparece en
 *    `$authorizedApiUserIds` (config `gapssaBookingDecisionAuthorizedApiUserIds`).
 * 3. Cualquier otro usuario (humano regular) -> autorizado ÚNICAMENTE si
 *    su id aparece en `$authorizedUserIds` (config
 *    `gapssaBookingDecisionAuthorizedUserIds`).
 * 4. Cualquier otro caso -> denegado.
 *
 * Deliberadamente pura (sin ningún `Espo\...` en sus imports, sin acceso a
 * `Config`/`User` del framework) para poder probarse con el arnés mínimo
 * (`tests/MeetingHooksPureLogicTest.php`) sin bootstrap de EspoCRM — mismo
 * patrón que `MeetingResolutionPolicy`/`MeetingDecisionTransitionPolicy`.
 * `PutDecide::isAuthorizedToDecide()` es la única llamante real; ahí es
 * donde se leen `$this->user`/`$this->config` y se pasan como escalares
 * aquí.
 *
 * Ambas listas se tratan de forma defensiva: `null`/valor ausente/no-array
 * (config corrupta o nunca escrita) se trata como lista vacía -> deniega
 * por defecto, nunca lanza. Cualquier elemento de la lista que no sea un
 * string se ignora en vez de compararse (evita que un id numérico o un
 * `bool` coincida por coerción de tipos de `in_array` no estricto).
 */
final class MeetingDecisionAuthorizationPolicy
{
    public static function isAuthorized(
        bool $isAdmin,
        ?string $userType,
        string $userId,
        mixed $authorizedApiUserIds,
        mixed $authorizedUserIds,
    ): bool {
        if ($isAdmin) {
            return true;
        }

        if ($userType === 'api') {
            return self::idInAllowlist($userId, $authorizedApiUserIds);
        }

        return self::idInAllowlist($userId, $authorizedUserIds);
    }

    private static function idInAllowlist(string $userId, mixed $allowlist): bool
    {
        if (!is_array($allowlist)) {
            return false;
        }

        foreach ($allowlist as $candidate) {
            if (is_string($candidate) && $candidate === $userId) {
                return true;
            }
        }

        return false;
    }
}
