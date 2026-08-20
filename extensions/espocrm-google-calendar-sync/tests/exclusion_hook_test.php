<?php

/**
 * Comprueba la lógica de `cExcluirGoogleCalendarSync` en GcsPush::afterSave():
 * creación excluida = cero jobs; false→true encola DELETE (limpieza, no-op si
 * nunca hubo vínculo); true→false encola UPSERT; excluida sin cambio de
 * exclusión ignora cualquier otro cambio; afterRelate/afterUnrelate respetan
 * la exclusión. El hook se instancia con dobles de JobSchedulerFactory y
 * Config: no necesita EspoCRM en marcha ni toca Google.
 *
 * Uso:  php tests/exclusion_hook_test.php <ruta-del-modulo>
 */

declare(strict_types=1);

// ---------------------------------------------------- Dobles del núcleo
namespace Espo\ORM {
    interface Entity {}
}

namespace Espo\ORM\Repository\Option {
    trait FakeOptions
    {
        /** @param array<string, mixed> $options */
        public function __construct(private array $options = [])
        {
        }

        public function get(string $option): mixed
        {
            return $this->options[$option] ?? null;
        }
    }

    class SaveOptions { use FakeOptions; }
    class RemoveOptions { use FakeOptions; }
    class RelateOptions { use FakeOptions; }
    class UnrelateOptions { use FakeOptions; }
}

namespace Espo\Core\Hook\Hook {
    use Espo\ORM\Entity;
    use Espo\ORM\Repository\Option\RelateOptions;
    use Espo\ORM\Repository\Option\RemoveOptions;
    use Espo\ORM\Repository\Option\SaveOptions;
    use Espo\ORM\Repository\Option\UnrelateOptions;

    interface AfterSave { public function afterSave(Entity $e, SaveOptions $o): void; }
    interface AfterRemove { public function afterRemove(Entity $e, RemoveOptions $o): void; }

    interface AfterRelate
    {
        public function afterRelate(Entity $e, string $r, Entity $re, array $c, RelateOptions $o): void;
    }

    interface AfterUnrelate
    {
        public function afterUnrelate(Entity $e, string $r, Entity $re, UnrelateOptions $o): void;
    }
}

namespace Espo\Core\Utils {
    class Config
    {
        /** @param array<string, mixed> $data */
        public function __construct(private array $data = ['gcsSyncStartAt' => '2026-08-01 00:00:00'])
        {
        }

        public function get(string $key): mixed
        {
            return $this->data[$key] ?? null;
        }
    }
}

namespace Espo\Modules\Crm\Entities {
    class Meeting
    {
        public const ENTITY_TYPE = 'Meeting';
        public const LINK_CONTACTS = 'contacts';
    }
}

namespace Espo\Core\Job {
    /** Registra los trabajos encolados en lugar de programarlos de verdad. */
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
            self::$scheduled[] = [
                'className' => $this->className,
                'group' => $this->group,
                'data' => $this->data,
            ];
        }
    }

    class JobSchedulerFactory
    {
        public function create(): JobScheduler
        {
            return new JobScheduler();
        }
    }
}

namespace {

    use Espo\Core\Job\JobScheduler;
    use Espo\Core\Job\JobSchedulerFactory;
    use Espo\Core\Utils\Config;
    use Espo\Modules\Crm\Entities\Meeting;
    use Espo\ORM\Repository\Option\RelateOptions;
    use Espo\ORM\Repository\Option\SaveOptions;
    use Espo\ORM\Repository\Option\UnrelateOptions;

    $root = rtrim($argv[1] ?? '', '/');

    if ($root === '' || !is_dir($root)) {
        fwrite(STDERR, "Uso: php tests/exclusion_hook_test.php <ruta-del-modulo>\n");
        exit(2);
    }

    if (!class_exists('Espo\Modules\GoogleCalendarSync\Classes\SyncService', false)) {
        eval('namespace Espo\Modules\GoogleCalendarSync\Classes;
              class SyncService { const ACTION_UPSERT = "upsert"; const ACTION_DELETE = "delete"; }');
    }

    if (!class_exists('Espo\Modules\GoogleCalendarSync\Jobs\GcsPushEvent', false)) {
        eval('namespace Espo\Modules\GoogleCalendarSync\Jobs; class GcsPushEvent {}');
    }

    require $root . '/Hooks/Meeting/GcsPush.php';

    /** Entidad configurable: campos por array, isNew/isAttributeChanged por closure. */
    class FakeMeetingEntity implements \Espo\ORM\Entity
    {
        /**
         * @param array<string, mixed> $fields
         * @param string[] $changedAttributes
         */
        public function __construct(
            private string $id,
            private array $fields = [],
            private bool $isNew = false,
            private array $changedAttributes = []
        ) {}

        public function getId(): string { return $this->id; }
        public function isNew(): bool { return $this->isNew; }

        public function isAttributeChanged(string $attribute): bool
        {
            return in_array($attribute, $this->changedAttributes, true);
        }

        public function get(string $key): mixed { return $this->fields[$key] ?? null; }
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

    function newHook(array $config = ['gcsSyncStartAt' => '2026-08-01 00:00:00']): object
    {
        JobScheduler::$scheduled = [];

        return new \Espo\Modules\GoogleCalendarSync\Hooks\Meeting\GcsPush(
            new JobSchedulerFactory(),
            new Config($config)
        );
    }

    /** @return array<int, array<string, mixed>> */
    function scheduled(): array
    {
        return JobScheduler::$scheduled;
    }

    // ==== 1 · Creación excluida: cero jobs desde el origen ====
    $hook = newHook();
    $new = new FakeMeetingEntity('m-new-excluded', ['cExcluirGoogleCalendarSync' => true], isNew: true);
    $hook->afterSave($new, new SaveOptions());

    check('1 · creación con true no encola ningún job', scheduled() === []);

    // ==== 2 · Creación no excluida: comportamiento normal (regresión) ====
    $hook = newHook();
    $new = new FakeMeetingEntity('m-new-normal', ['cExcluirGoogleCalendarSync' => false], isNew: true);
    $hook->afterSave($new, new SaveOptions());

    check('2 · creación con false encola 1 UPSERT', count(scheduled()) === 1);
    check('2b · es UPSERT', (scheduled()[0]['data']['action'] ?? null) === 'upsert');

    // ==== 3 · Creación sin el campo (ausente/null): se trata como false ====
    $hook = newHook();
    $new = new FakeMeetingEntity('m-new-null', [], isNew: true);
    $hook->afterSave($new, new SaveOptions());

    check('3 · creación sin el campo encola UPSERT (se trata como false)', count(scheduled()) === 1);

    // ==== 4 · false→true con la cita existente: encola DELETE (limpieza) ====
    $hook = newHook();
    $existing = new FakeMeetingEntity(
        'm-turn-excluded',
        ['cExcluirGoogleCalendarSync' => true],
        isNew: false,
        changedAttributes: ['cExcluirGoogleCalendarSync']
    );
    $hook->afterSave($existing, new SaveOptions());

    check('4 · false→true encola exactamente 1 job', count(scheduled()) === 1);
    check('4b · el job es DELETE (limpieza del vínculo heredado, no-op si no hay ninguno)',
        (scheduled()[0]['data']['action'] ?? null) === 'delete');
    check('4c · el meetingId es el correcto',
        (scheduled()[0]['data']['meetingId'] ?? null) === 'm-turn-excluded');

    // ==== 5 · true→false: encola UPSERT idempotente ====
    $hook = newHook();
    $existing = new FakeMeetingEntity(
        'm-turn-included',
        ['cExcluirGoogleCalendarSync' => false],
        isNew: false,
        changedAttributes: ['cExcluirGoogleCalendarSync']
    );
    $hook->afterSave($existing, new SaveOptions());

    check('5 · true→false encola exactamente 1 job', count(scheduled()) === 1);
    check('5b · el job es UPSERT', (scheduled()[0]['data']['action'] ?? null) === 'upsert');

    // ==== 6 · Excluida, sin cambiar la exclusión: ignora otros cambios ====
    $hook = newHook();
    $excludedUnchanged = new FakeMeetingEntity(
        'm-excluded-other-change',
        ['cExcluirGoogleCalendarSync' => true],
        isNew: false,
        changedAttributes: ['name', 'dateStart'] // cambios relevantes, pero NO el de exclusión
    );
    $hook->afterSave($excludedUnchanged, new SaveOptions());

    check('6 · excluida sin cambio de exclusión no reacciona a otros cambios', scheduled() === []);

    // ==== 7 · No excluida, sin cambiar la exclusión: comportamiento normal (regresión) ====
    $hook = newHook();
    $normalChange = new FakeMeetingEntity(
        'm-normal-change',
        ['cExcluirGoogleCalendarSync' => false],
        isNew: false,
        changedAttributes: ['name']
    );
    $hook->afterSave($normalChange, new SaveOptions());

    check('7 · cambio relevante en cita normal sigue encolando UPSERT', count(scheduled()) === 1);

    // ==== 8 · No excluida, sin ningún cambio relevante: nada que hacer (regresión) ====
    $hook = newHook();
    $noChange = new FakeMeetingEntity(
        'm-no-change',
        ['cExcluirGoogleCalendarSync' => false],
        isNew: false,
        changedAttributes: []
    );
    $hook->afterSave($noChange, new SaveOptions());

    check('8 · sin cambios relevantes no encola nada', scheduled() === []);

    // ==== 9 · silent/gcsSync siguen cortando antes que la lógica de exclusión ====
    $hook = newHook();
    $existing = new FakeMeetingEntity(
        'm-silent',
        ['cExcluirGoogleCalendarSync' => true],
        isNew: false,
        changedAttributes: ['cExcluirGoogleCalendarSync']
    );
    $hook->afterSave($existing, new SaveOptions(['silent' => true]));

    check('9 · silent sigue impidiendo cualquier job, incluida la transición', scheduled() === []);

    // ==== 10 · afterRelate: cita excluida no reexporta al vincular un contacto ====
    $hook = newHook();
    $excludedMeeting = new FakeMeetingEntity('m-relate-excluded', ['cExcluirGoogleCalendarSync' => true]);
    $contact = new FakeMeetingEntity('contact-1');
    $hook->afterRelate($excludedMeeting, Meeting::LINK_CONTACTS, $contact, [], new RelateOptions());

    check('10 · afterRelate en cita excluida no encola nada', scheduled() === []);

    // ==== 11 · afterUnrelate: cita excluida no reexporta al desvincular ====
    $hook = newHook();
    $hook->afterUnrelate($excludedMeeting, Meeting::LINK_CONTACTS, $contact, new UnrelateOptions());

    check('11 · afterUnrelate en cita excluida no encola nada', scheduled() === []);

    // ==== 12 · afterRelate en cita normal sigue funcionando (regresión) ====
    $hook = newHook();
    $normalMeeting = new FakeMeetingEntity('m-relate-normal', ['cExcluirGoogleCalendarSync' => false]);
    $hook->afterRelate($normalMeeting, Meeting::LINK_CONTACTS, $contact, [], new RelateOptions());

    check('12 · afterRelate en cita normal encola 1 UPSERT', count(scheduled()) === 1);

    // ==== 13 · Sin gcsSyncStartAt, la transición tampoco encola nada ====
    $hook = newHook([]);
    $existing = new FakeMeetingEntity(
        'm-no-flag',
        ['cExcluirGoogleCalendarSync' => true],
        isNew: false,
        changedAttributes: ['cExcluirGoogleCalendarSync']
    );
    $hook->afterSave($existing, new SaveOptions());

    check('13 · integración nunca activada: ni la transición encola nada', scheduled() === []);

    if ($failures) {
        echo 'EXCLUSIÓN GCS (GcsPush): FALLA (' . count($failures) . '/' . $assertions . ")\n";

        foreach ($failures as $f) {
            echo "  ✗ $f\n";
        }

        exit(1);
    }

    echo "EXCLUSIÓN GCS (GcsPush): OK ($assertions aserciones)\n";

    exit(0);
}
