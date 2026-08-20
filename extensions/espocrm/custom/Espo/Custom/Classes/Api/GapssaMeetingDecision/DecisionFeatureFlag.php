<?php

namespace Espo\Custom\Classes\Api\GapssaMeetingDecision;

/**
 * Decisión adoptada tras el hallazgo de que `MeetingDecisionAuthorizationPolicy`
 * autoriza a `isAdmin()` incondicionalmente: ni la ACL de scope ni la
 * política de autorización pueden, por diseño, bloquear al admin real de la
 * instancia. Este interruptor es la única puerta que sí lo hace, porque vive
 * dentro del propio endpoint (`PutDecide::process()`), antes de cualquier
 * lectura de `Meeting`, comprobación de ACL o apertura de transacción — no
 * depende de sesión, de rol ni de modo mantenimiento de EspoCRM (que también
 * deja pasar a cualquier admin).
 *
 * Validación deliberadamente estricta (`===`, nunca "truthy"): la clave de
 * config ausente, `false`, `null`, `0`/`1`, las cadenas `"true"`/`"false"`,
 * un array o cualquier otro tipo deben bloquear igual que `false` — solo el
 * booleano `true` habilita la decisión. Config::get() en EspoCRM devuelve
 * tipos sin garantía (JSON/PHP escrito a mano en `data/config.php`); una
 * comparación laxa (`==`, `!empty`) dejaría pasar `"true"` (string) o `1`
 * como si fueran el flag activado, exactamente el tipo de corrupción de
 * config ya visto y tratado como denegación en el resto de esta puerta
 * (`MeetingDecisionAuthorizationPolicy`).
 */
final class DecisionFeatureFlag
{
    public static function isEnabled(mixed $value): bool
    {
        return $value === true;
    }
}
