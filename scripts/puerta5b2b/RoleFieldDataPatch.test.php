<?php

declare(strict_types=1);

require __DIR__ . '/RoleFieldDataPatch.php';

$failures = 0;
$check = static function (bool $ok, string $label) use (&$failures): void {
    echo ($ok ? 'ok' : 'not ok') . " - $label\n";
    $failures += $ok ? 0 : 1;
};

$source = (object) [
    'Meeting' => (object) [
        'name' => (object) ['read' => 'no', 'edit' => 'yes'],
        'cExcluirGoogleCalendarSync' => (object) ['read' => 'yes', 'edit' => 'no'],
    ],
    'Contact' => (object) ['emailAddress' => (object) ['read' => 'yes', 'edit' => 'yes']],
];

$opened = RoleFieldDataPatch::withMeetingGcsEdit($source, 'no', 'yes');
$check($source->Meeting->cExcluirGoogleCalendarSync->edit === 'no', 'la fuente no se muta in-place');
$check($opened !== $source, 'se devuelve una copia profunda distinta');
$check($opened->Meeting->cExcluirGoogleCalendarSync->edit === 'yes', 'solo el edit objetivo se abre');
$check($opened->Meeting->name->edit === 'yes', 'otro campo Meeting queda intacto');
$check($opened->Contact->emailAddress->read === 'yes', 'otro scope queda intacto');

$closed = RoleFieldDataPatch::withMeetingGcsEdit($opened, 'yes', 'no');
$check($closed->Meeting->cExcluirGoogleCalendarSync->edit === 'no', 'la operación inversa cierra la ACL');

try {
    RoleFieldDataPatch::withMeetingGcsEdit($source, 'yes', 'no');
    $check(false, 'una precondición divergente debe fallar');
} catch (RuntimeException) {
    $check(true, 'una precondición divergente falla cerrada');
}

exit($failures === 0 ? 0 : 1);
