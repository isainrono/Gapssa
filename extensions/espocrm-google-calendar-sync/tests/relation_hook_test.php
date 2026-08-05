<?php

/**
 * Comprueba que vincular, desvincular o sustituir contactos de una cita encola
 * un GcsPushEvent con acción UPSERT, sin llamar a Google y sin encolar de más.
 *
 * El hook se instancia con dobles de JobSchedulerFactory y Config, así que la
 * prueba no necesita EspoCRM en marcha.
 *
 * Uso:  php tests/relation_hook_test.php <ruta-del-modulo>
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
        fwrite(STDERR, "Uso: php tests/relation_hook_test.php <ruta-del-modulo>\n");
        exit(2);
    }

    // Constantes de acción sin arrastrar todo SyncService.
    if (!class_exists('Espo\Modules\GoogleCalendarSync\Classes\SyncService', false)) {
        eval('namespace Espo\Modules\GoogleCalendarSync\Classes;
              class SyncService { const ACTION_UPSERT = "upsert"; const ACTION_DELETE = "delete"; }');
    }

    if (!class_exists('Espo\Modules\GoogleCalendarSync\Jobs\GcsPushEvent', false)) {
        eval('namespace Espo\Modules\GoogleCalendarSync\Jobs; class GcsPushEvent {}');
    }

    require $root . '/Hooks/Meeting/GcsPush.php';

    class FakeEntity implements \Espo\ORM\Entity
    {
        public function __construct(private string $id) {}
        public function getId(): string { return $this->id; }
        public function isNew(): bool { return false; }
        public function isAttributeChanged(string $a): bool { return false; }
        public function get(string $k): mixed { return null; }
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

    $meeting = new FakeEntity('meeting-1');
    $contact = new FakeEntity('contact-1');

    // ---- 10 · vincular un contacto encola UPSERT ----
    $hook = newHook();
    $hook->afterRelate($meeting, Meeting::LINK_CONTACTS, $contact, [], new RelateOptions());

    check('10 · vincular contacto encola 1 trabajo', count(JobScheduler::$scheduled) === 1);
    check('10b · la acción es UPSERT',
        (JobScheduler::$scheduled[0]['data']['action'] ?? null) === 'upsert');
    check('10c · el meetingId es el correcto',
        (JobScheduler::$scheduled[0]['data']['meetingId'] ?? null) === 'meeting-1');
    check('10d · reutiliza el grupo de trabajos existente',
        (JobScheduler::$scheduled[0]['group'] ?? null) === 'gcs-push');

    // ---- 11 · desvincular encola UPSERT (no DELETE: la cita sigue existiendo) ----
    $hook = newHook();
    $hook->afterUnrelate($meeting, Meeting::LINK_CONTACTS, $contact, new UnrelateOptions());

    check('11 · desvincular contacto encola 1 trabajo', count(JobScheduler::$scheduled) === 1);
    check('11b · desvincular usa UPSERT, no DELETE',
        (JobScheduler::$scheduled[0]['data']['action'] ?? null) === 'upsert');

    // ---- 12 · sustituir contacto no encola trabajos duplicados ----
    $hook = newHook();
    $hook->afterUnrelate($meeting, Meeting::LINK_CONTACTS, $contact, new UnrelateOptions());
    $hook->afterRelate($meeting, Meeting::LINK_CONTACTS, new FakeEntity('contact-2'), [], new RelateOptions());

    check('12 · sustituir contacto encola un solo trabajo', count(JobScheduler::$scheduled) === 1);

    // Varios contactos en el mismo guardado: un único trabajo
    $hook = newHook();

    foreach (['c1', 'c2', 'c3'] as $id) {
        $hook->afterRelate($meeting, Meeting::LINK_CONTACTS, new FakeEntity($id), [], new RelateOptions());
    }

    check('12b · tres contactos a la vez encolan un solo trabajo',
        count(JobScheduler::$scheduled) === 1);

    // Citas distintas sí encolan por separado
    $hook = newHook();
    $hook->afterRelate($meeting, Meeting::LINK_CONTACTS, $contact, [], new RelateOptions());
    $hook->afterRelate(new FakeEntity('meeting-2'), Meeting::LINK_CONTACTS, $contact, [], new RelateOptions());

    check('12c · citas distintas encolan por separado', count(JobScheduler::$scheduled) === 2);

    // ---- Protecciones ----
    $hook = newHook();
    $hook->afterRelate($meeting, 'users', $contact, [], new RelateOptions());

    check('6 · otras relaciones se siguen ignorando (users)', JobScheduler::$scheduled === []);

    $hook = newHook();
    $hook->afterRelate($meeting, 'users', $contact, [], new RelateOptions(['silent' => true]));

    check('6b · users con silent tampoco encola', JobScheduler::$scheduled === []);

    // ---- `silent` en relaciones: SÍ se procesa (cierra la carrera) ----
    //
    // EspoCRM relaciona los contactos de una cita nueva con silent = true. Si
    // se ignorara y el daemon procesara el UPSERT de afterSave antes de que
    // terminen las relaciones, el evento se quedaría sin cliente para siempre:
    // el barrido no lo corrige porque filtra por Meeting.modifiedAt.

    $hook = newHook();
    $hook->afterRelate($meeting, Meeting::LINK_CONTACTS, $contact, [], new RelateOptions(['silent' => true]));

    check('2 · afterRelate con silent NO se ignora', count(JobScheduler::$scheduled) === 1);
    check('2b · el trabajo encolado es UPSERT',
        (JobScheduler::$scheduled[0]['data']['action'] ?? null) === 'upsert');

    // 7 · afterUnrelate con silent también actualiza el título
    $hook = newHook();
    $hook->afterUnrelate($meeting, Meeting::LINK_CONTACTS, $contact, new UnrelateOptions(['silent' => true]));

    check('7 · afterUnrelate con silent tampoco se ignora',
        count(JobScheduler::$scheduled) === 1);
    check('7b · y encola UPSERT',
        (JobScheduler::$scheduled[0]['data']['action'] ?? null) === 'upsert');

    // ---- Flujo completo de una cita nueva ----
    // 1 · afterSave encola · 3 · misma instancia => deduplicado a un trabajo
    $hook = newHook();

    $newMeeting = new class ('meeting-new') extends FakeEntity {
        public function isNew(): bool { return true; }
        public function isAttributeChanged(string $a): bool { return true; }
    };

    $hook->afterSave($newMeeting, new SaveOptions());

    check('1 · la cita nueva encola UPSERT en afterSave',
        count(JobScheduler::$scheduled) === 1 &&
        JobScheduler::$scheduled[0]['data']['action'] === 'upsert');

    // Después EspoCRM relaciona los contactos con silent = true
    $hook->afterRelate($newMeeting, Meeting::LINK_CONTACTS, $contact, [], new RelateOptions(['silent' => true]));
    $hook->afterRelate($newMeeting, Meeting::LINK_CONTACTS, new FakeEntity('c2'), [], new RelateOptions(['silent' => true]));

    check('3 · con la misma instancia, la deduplicación deja un solo trabajo',
        count(JobScheduler::$scheduled) === 1);

    // 4 · Instancias distintas: dos trabajos, ambos UPSERT sobre la misma cita
    JobScheduler::$scheduled = [];

    $hookA = new \Espo\Modules\GoogleCalendarSync\Hooks\Meeting\GcsPush(
        new JobSchedulerFactory(), new Config(['gcsSyncStartAt' => '2026-08-01 00:00:00']));
    $hookB = new \Espo\Modules\GoogleCalendarSync\Hooks\Meeting\GcsPush(
        new JobSchedulerFactory(), new Config(['gcsSyncStartAt' => '2026-08-01 00:00:00']));

    $hookA->afterSave($newMeeting, new SaveOptions());
    $hookB->afterRelate($newMeeting, Meeting::LINK_CONTACTS, $contact, [], new RelateOptions(['silent' => true]));

    check('4 · instancias distintas pueden encolar dos trabajos',
        count(JobScheduler::$scheduled) === 2);
    check('4b · ambos son UPSERT',
        array_unique(array_column(array_column(JobScheduler::$scheduled, 'data'), 'action')) === ['upsert']);
    check('4c · ambos sobre el mismo meetingId',
        array_unique(array_column(array_column(JobScheduler::$scheduled, 'data'), 'meetingId')) === ['meeting-new']);

    $hook = newHook();
    $hook->afterRelate($meeting, Meeting::LINK_CONTACTS, $contact, [], new RelateOptions(['gcsSync' => true]));

    check('5 · gcsSync sigue sin encolar (evita bucles)', JobScheduler::$scheduled === []);

    $hook = newHook();
    $hook->afterUnrelate($meeting, Meeting::LINK_CONTACTS, $contact, new UnrelateOptions(['gcsSync' => true]));

    check('5b · gcsSync en afterUnrelate tampoco encola', JobScheduler::$scheduled === []);

    $hook = newHook([]);
    $hook->afterRelate($meeting, Meeting::LINK_CONTACTS, $contact, [], new RelateOptions());

    check('sin gcsSyncStartAt no encola (integración nunca activada)',
        JobScheduler::$scheduled === []);

    // El guardado normal sigue funcionando
    $hook = newHook();
    $hook->afterSave(new class ('m-9') extends FakeEntity {
        public function isAttributeChanged(string $a): bool { return $a === 'name'; }
    }, new SaveOptions());

    check('afterSave sigue encolando al cambiar el asunto',
        count(JobScheduler::$scheduled) === 1);

    // 8 · El hook no llama a Google en ningún momento
    $source = (string) file_get_contents($root . '/Hooks/Meeting/GcsPush.php');

    check('8 · el hook no referencia la API de Google',
        !preg_match('/Google\\\\(Client|Service)|GoogleClientFactory|events->|CalendarService/', $source));
    check('8b · el hook solo encola trabajos', str_contains($source, 'GcsPushEvent::class'));

    if ($failures) {
        echo 'HOOK DE RELACIONES: FALLA (' . count($failures) . '/' . $assertions . ")\n";

        foreach ($failures as $f) {
            echo "  ✗ $f\n";
        }

        exit(1);
    }

    echo "HOOK DE RELACIONES: OK ($assertions aserciones)\n";

    exit(0);
}
