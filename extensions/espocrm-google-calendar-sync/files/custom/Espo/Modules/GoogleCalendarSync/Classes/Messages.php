<?php

namespace Espo\Modules\GoogleCalendarSync\Classes;

use Espo\Core\Utils\Language;

/**
 * Mensajes de error traducibles.
 *
 * Se usa el idioma **por defecto** de la instancia (no el del usuario) porque
 * algunos de estos textos se guardan en base de datos (campo `lastError` de
 * GcsAccount) y los leerá cualquier administrador.
 *
 * Los mensajes de log NO pasan por aquí: van siempre en inglés, que es lo
 * esperable en `data/logs/`.
 */
class Messages
{
    private const CATEGORY = 'errors';
    private const SCOPE = 'GcsAccount';

    public function __construct(private Language $defaultLanguage)
    {}

    /**
     * Devuelve el mensaje traducido; si falta la traducción usa el texto en
     * inglés que se pasa como respaldo, de modo que nunca se muestra una clave.
     *
     * @param array<string, string> $params Sustituciones tipo {clave}.
     */
    public function get(string $key, string $fallback, array $params = []): string
    {
        $text = $this->defaultLanguage->translateLabel($key, self::CATEGORY, self::SCOPE);

        if ($text === $key || $text === '') {
            $text = $fallback;
        }

        foreach ($params as $name => $value) {
            $text = str_replace('{' . $name . '}', $value, $text);
        }

        return $text;
    }
}
