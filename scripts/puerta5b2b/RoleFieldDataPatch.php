<?php

declare(strict_types=1);

/**
 * Construye una preimagen nueva para Role.fieldData.
 *
 * EspoCRM hidrata fieldData como un objeto anidado. Mutarlo in-place no
 * marca el atributo como cambiado en el ORM, aunque AclManager vea el valor
 * mutado durante ese mismo proceso. La copia profunda anterior a la mutación
 * y la posterior reasignación mediante Entity::set son obligatorias.
 */
final class RoleFieldDataPatch
{
    public static function withMeetingGcsEdit(object $source, string $expected, string $next): object
    {
        if (!in_array($expected, ['yes', 'no'], true) || !in_array($next, ['yes', 'no'], true)) {
            throw new InvalidArgumentException('Nivel ACL no permitido.');
        }

        $copy = unserialize(serialize($source), ['allowed_classes' => [stdClass::class]]);
        if (!$copy instanceof stdClass) {
            throw new RuntimeException('fieldData no tiene la forma esperada.');
        }

        $entry = $copy->Meeting->cExcluirGoogleCalendarSync ?? null;
        if (!$entry instanceof stdClass || ($entry->read ?? null) !== 'yes' || ($entry->edit ?? null) !== $expected) {
            throw new RuntimeException('Precondición ACL inesperada; no se modifica nada.');
        }

        $entry->edit = $next;

        return $copy;
    }
}
