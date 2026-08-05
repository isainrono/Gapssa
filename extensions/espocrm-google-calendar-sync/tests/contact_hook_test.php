<?php

/**
 * Comprueba que renombrar un Contact reexporta sus citas, y solo entonces.
 *
 * Motivo: el barrido programado filtra por `Meeting.modifiedAt`, que no cambia
 * al editar un Contact. Sin este hook el título de Google quedaría obsoleto.
 *
 * Uso:  php tests/contact_hook_test.php <ruta-del-modulo>
 */

declare(strict_types=1);

namespace Espo\ORM {
    interface Entity {}
}

namespace Espo\ORM\Repository\Option {
    class SaveOptions
    {
        /** @param array<string, mixed> $options */
        public function __construct(private array $options = []) {}

        public function get(string $option): mixed
        {
            return $this->options[$option] ?? null;
        }
    }
}

namespace Espo\Core\Hook\Hook {
    use Espo\ORM\Entity;
    use Espo\ORM\Repository\Option\SaveOptions;

    interface AfterSave { public function afterSave(Entity $e, SaveOptions $o): void; }
}

namespace Espo\Core\Utils {
    class Config
    {
        /** @param array<string, mixed> $data */
        public function __construct(private array $data = ['gcsSyncStartAt' => '2026-08-01 00:00:00']) {}

        public function get(string $key): mixed { return $this->data[$key] ?? null; }
    }

    class Log
    {
        /** @var string[] */
        public static array $warnings = [];

        public function warning(string $m): void { self::$warnings[] = $m; }
        public function error(string $m): void {}
    }
}

namespace Espo\Modules\Crm\Entities {
    class Contact { public const ENTITY_TYPE = 'Contact'; }
    class Meeting { public const ENTITY_TYPE = 'Meeting'; public const LINK_CONTACTS = 'contacts'; }
}

namespace Espo\Core\Job {
    class JobScheduler
    {
        /** @var array<int, array<string, mixed>> */
        public static array $scheduled = [];

        private string $className = '';
        private ?string $group = null;
        /** @var array<string, mixed> */
        private array $data = [];

        public function setClassName(string $c): self { $this->className = $c; return $this; }
        public function setGroup(?string $g): self { $this->group = $g; return $this; }
        public function setData($d): self { $this->data = (array) $d; return $this; }

        public function schedule(): void
        {
            self::$scheduled[] = ['className' => $this->className, 'group' => $this->group, 'data' => $this->data];
        }
    }

    class JobSchedulerFactory
    {
        public function create(): JobScheduler { return new JobScheduler(); }
    }
}

namespace Espo\ORM {
    /** Doble del ORM: devuelve las citas configuradas y registra las llamadas. */
    class FakeRelationBuilder
    {
        /** @var array<int, object> */
        public static array $result = [];
        /** @var array<string, mixed> */
        public static array $calls = [];

        public function select($s): self { self::$calls['select'] = $s; return $this; }
        public function order($o, $d = null): self { self::$calls['order'] = [$o, $d]; return $this; }
        public function limit(?int $o, ?int $l): self { self::$calls['limit'] = [$o, $l]; return $this; }
        public function find(): array { return self::$result; }
    }

    class FakeRepository
    {
        public function getRelation($entity, string $link): FakeRelationBuilder
        {
            FakeRelationBuilder::$calls['link'] = $link;

            return new FakeRelationBuilder();
        }
    }

    class EntityManager
    {
        public function getRDBRepository(string $entityType): FakeRepository
        {
            FakeRelationBuilder::$calls['entityType'] = $entityType;

            return new FakeRepository();
        }
    }
}

namespace {

    use Espo\Core\Job\JobScheduler;
    use Espo\Core\Job\JobSchedulerFactory;
    use Espo\Core\Utils\Config;
    use Espo\Core\Utils\Log;
    use Espo\ORM\EntityManager;
    use Espo\ORM\FakeRelationBuilder;
    use Espo\ORM\Repository\Option\SaveOptions;

    $root = rtrim($argv[1] ?? '', '/');

    if ($root === '' || !is_dir($root)) {
        fwrite(STDERR, "Uso: php tests/contact_hook_test.php <ruta-del-modulo>\n");
        exit(2);
    }

    if (!class_exists('Espo\Modules\GoogleCalendarSync\Classes\SyncService', false)) {
        eval('namespace Espo\Modules\GoogleCalendarSync\Classes;
              class SyncService { const ACTION_UPSERT = "upsert"; const ACTION_DELETE = "delete"; }');
    }

    if (!class_exists('Espo\Modules\GoogleCalendarSync\Jobs\GcsPushEvent', false)) {
        eval('namespace Espo\Modules\GoogleCalendarSync\Jobs; class GcsPushEvent {}');
    }

    require $root . '/Hooks/Contact/GcsContactRename.php';

    class FakeContact implements \Espo\ORM\Entity
    {
        /** @param string[] $changed */
        public function __construct(private string $id, private array $changed = [], private bool $new = false) {}

        public function getId(): string { return $this->id; }
        public function isNew(): bool { return $this->new; }
        public function isAttributeChanged(string $a): bool { return in_array($a, $this->changed, true); }
        public function get(string $k): mixed { return null; }
    }

    class FakeMeeting
    {
        public function __construct(private string $id) {}
        public function getId(): string { return $this->id; }
    }

    $assertions = 0;
    $failures = [];

    function check(string $what, bool $condition): void
    {
        global $assertions, $failures;

        $assertions++;

        if (!$condition) {
            $failures[] = $what;
        }
    }

    /** @param string[] $meetingIds */
    function newHook(array $meetingIds, array $config = ['gcsSyncStartAt' => '2026-08-01 00:00:00']): object
    {
        JobScheduler::$scheduled = [];
        Log::$warnings = [];
        FakeRelationBuilder::$calls = [];
        FakeRelationBuilder::$result = array_map(fn($id) => new FakeMeeting($id), $meetingIds);

        return new \Espo\Modules\GoogleCalendarSync\Hooks\Contact\GcsContactRename(
            new JobSchedulerFactory(),
            new EntityManager(),
            new Config($config),
            new Log()
        );
    }

    // ---- Cambio de firstName ----
    $hook = newHook(['m1', 'm2']);
    $hook->afterSave(new FakeContact('c1', ['firstName']), new SaveOptions());

    check('cambiar firstName encola las citas relacionadas', count(JobScheduler::$scheduled) === 2);
    check('la acción es UPSERT',
        (JobScheduler::$scheduled[0]['data']['action'] ?? null) === 'upsert');
    check('reutiliza el grupo gcs-push',
        (JobScheduler::$scheduled[0]['group'] ?? null) === 'gcs-push');
    check('consulta la relación meetings de Contact',
        (FakeRelationBuilder::$calls['link'] ?? null) === 'meetings' &&
        (FakeRelationBuilder::$calls['entityType'] ?? null) === 'Contact');
    check('la consulta acota columnas y aplica límite',
        (FakeRelationBuilder::$calls['select'] ?? null) === ['id'] &&
        (FakeRelationBuilder::$calls['limit'][1] ?? null) === 200);

    // ---- Cambio de lastName ----
    $hook = newHook(['m1']);
    $hook->afterSave(new FakeContact('c1', ['lastName']), new SaveOptions());

    check('cambiar lastName encola las citas relacionadas', count(JobScheduler::$scheduled) === 1);

    // ---- middleName (también compone `name`) ----
    $hook = newHook(['m1']);
    $hook->afterSave(new FakeContact('c1', ['middleName']), new SaveOptions());

    check('cambiar middleName encola', count(JobScheduler::$scheduled) === 1);

    // ---- Campo ajeno al nombre ----
    $hook = newHook(['m1', 'm2']);
    $hook->afterSave(new FakeContact('c1', ['emailAddress', 'description']), new SaveOptions());

    check('cambiar un campo ajeno al nombre NO encola', JobScheduler::$scheduled === []);

    // ---- Contacto sin citas ----
    $hook = newHook([]);
    $hook->afterSave(new FakeContact('c1', ['firstName']), new SaveOptions());

    check('contacto sin citas no encola nada', JobScheduler::$scheduled === []);

    // ---- Varias citas: una vez cada una ----
    $hook = newHook(['m1', 'm2', 'm3', 'm4']);
    $hook->afterSave(new FakeContact('c1', ['firstName']), new SaveOptions());

    check('cuatro citas encolan cuatro trabajos', count(JobScheduler::$scheduled) === 4);

    $ids = array_map(fn($j) => $j['data']['meetingId'], JobScheduler::$scheduled);

    check('cada cita aparece una sola vez', count($ids) === count(array_unique($ids)));

    // ---- Citas repetidas en el resultado: deduplicadas ----
    $hook = newHook(['m1', 'm1', 'm2']);
    $hook->afterSave(new FakeContact('c1', ['firstName']), new SaveOptions());

    check('citas repetidas se deduplican', count(JobScheduler::$scheduled) === 2);

    // ---- Protecciones ----
    $hook = newHook(['m1']);
    $hook->afterSave(new FakeContact('c1', ['firstName']), new SaveOptions(['silent' => true]));

    check('silent no encola', JobScheduler::$scheduled === []);

    $hook = newHook(['m1']);
    $hook->afterSave(new FakeContact('c1', ['firstName']), new SaveOptions(['gcsSync' => true]));

    check('gcsSync no encola (evita bucles)', JobScheduler::$scheduled === []);

    $hook = newHook(['m1'], []);
    $hook->afterSave(new FakeContact('c1', ['firstName']), new SaveOptions());

    check('sin gcsSyncStartAt no encola', JobScheduler::$scheduled === []);

    $hook = newHook(['m1']);
    $hook->afterSave(new FakeContact('c1', ['firstName'], true), new SaveOptions());

    check('contacto nuevo no encola (aún no tiene citas)', JobScheduler::$scheduled === []);

    // ---- Aviso al alcanzar el tope ----
    $hook = newHook(array_map(fn($i) => "m$i", range(1, 200)));
    $hook->afterSave(new FakeContact('c1', ['firstName']), new SaveOptions());

    check('el tope de 200 se respeta', count(JobScheduler::$scheduled) === 200);
    check('al alcanzar el tope se registra un aviso', count(Log::$warnings) === 1);

    // ---- El hook no llama a Google ----
    $source = (string) file_get_contents($root . '/Hooks/Contact/GcsContactRename.php');

    check('el hook no referencia la API de Google',
        !preg_match('/Google\\\\(Client|Service)|GoogleClientFactory|events->/', $source));
    check('el hook solo encola trabajos', str_contains($source, 'GcsPushEvent::class'));

    if ($failures) {
        echo 'HOOK DE CONTACT: FALLA (' . count($failures) . '/' . $assertions . ")\n";

        foreach ($failures as $f) {
            echo "  ✗ $f\n";
        }

        exit(1);
    }

    echo "HOOK DE CONTACT: OK ($assertions aserciones)\n";

    exit(0);
}
