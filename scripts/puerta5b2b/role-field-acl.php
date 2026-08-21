<?php

declare(strict_types=1);

require '/var/www/html/bootstrap.php';
require __DIR__ . '/RoleFieldDataPatch.php';

use Espo\Core\Application;
use Espo\Core\Acl\Table;
use Espo\Core\AclManager;
use Espo\ORM\EntityManager;

$action = $argv[1] ?? '';
if (!in_array($action, ['inspect', 'open', 'close'], true)) {
    fwrite(STDERR, "Uso: role-field-acl.php inspect|open|close\n");
    exit(2);
}

$app = new Application();
$app->setupSystemUser();
$em = $app->getContainer()->getByClass(EntityManager::class);
$role = $em->getRDBRepository('Role')->where(['name' => 'Portal GAPSSA API'])->findOne();

if ($role === null) {
    fwrite(STDERR, "Rol esperado ausente.\n");
    exit(3);
}

$fieldData = $role->get('fieldData');
if (!$fieldData instanceof stdClass) {
    fwrite(STDERR, "fieldData tiene una forma inesperada.\n");
    exit(4);
}

$entry = $fieldData->Meeting->cExcluirGoogleCalendarSync ?? null;
if (!$entry instanceof stdClass || ($entry->read ?? null) !== 'yes' || !in_array($entry->edit ?? null, ['yes', 'no'], true)) {
    fwrite(STDERR, "ACL objetivo ausente o inesperada.\n");
    exit(5);
}

if ($action === 'inspect') {
    $user = $em->getRDBRepository('User')->where(['userName' => 'portal-gapssa-api'])->findOne();
    if ($user === null || $user->get('type') !== 'api' || !$user->get('isActive')) {
        fwrite(STDERR, "Usuario API esperado ausente o inactivo.\n");
        exit(8);
    }
    $aclManager = $app->getContainer()->getByClass(AclManager::class);
    echo json_encode([
        'read' => $entry->read,
        'edit' => $entry->edit,
        'effectiveRead' => $aclManager->checkField($user, 'Meeting', 'cExcluirGoogleCalendarSync', Table::ACTION_READ),
        'effectiveEdit' => $aclManager->checkField($user, 'Meeting', 'cExcluirGoogleCalendarSync', Table::ACTION_EDIT),
        'changed' => false,
    ], JSON_THROW_ON_ERROR), PHP_EOL;
    exit(0);
}

$expected = $action === 'open' ? 'no' : 'yes';
$next = $action === 'open' ? 'yes' : 'no';
$patched = RoleFieldDataPatch::withMeetingGcsEdit($fieldData, $expected, $next);
$role->set('fieldData', $patched);

if (!$role->isAttributeChanged('fieldData')) {
    fwrite(STDERR, "El ORM no detectó la reasignación; no se guarda nada.\n");
    exit(6);
}

$em->saveEntity($role);

// Relectura desde SQL a través de la conexión del ORM. No se confía en la
// misma entidad hidratada que acabamos de modificar.
$stmt = $em->getPDO()->prepare('SELECT field_data FROM role WHERE id = :id');
$stmt->execute(['id' => $role->getId()]);
$stored = $stmt->fetchColumn();
$decoded = is_string($stored) ? json_decode($stored) : null;
$storedEntry = $decoded?->Meeting?->cExcluirGoogleCalendarSync ?? null;

if (!$storedEntry instanceof stdClass || ($storedEntry->read ?? null) !== 'yes' || ($storedEntry->edit ?? null) !== $next) {
    fwrite(STDERR, "La relectura persistente no confirmó el cambio.\n");
    exit(7);
}

echo json_encode(['read' => 'yes', 'edit' => $next, 'changed' => true], JSON_THROW_ON_ERROR), PHP_EOL;
