<?php

/**
 * Comprueba que `cExcluirGoogleCalendarSync=true` bloquea SyncService::pushMeeting()
 * (y por tanto todo lo que termina llamándolo: hooks, sweep, reintentos) ANTES
 * de tocar GoogleClientFactory — cero llamadas a Google — salvo en las rutas
 * de limpieza (DELETE explícito o cita cancelada), que sí deben ejecutarse
 * para no dejar huérfano un evento ya sincronizado antes de excluir la cita.
 *
 * Además (bloques K en adelante) comprueba la garantía añadida tras el
 * incidente de la Puerta 5A (`docs/fase4b-puerta5a-limpieza-propuesta.md`
 * §12, `docs/fase4b-puerta6c-correccion-oauth-delete.md`): para CUALQUIER
 * acción DELETE, `SyncService::processDelete()` consulta localmente los
 * `GcsEventLink` del Meeting ANTES de crear el cliente de Google — sin
 * ningún vínculo, no se crea cliente, no se toca OAuth, no se guarda ningún
 * cambio en `GcsAccount`, y no se llama a la API de Calendar. Antes de esa
 * corrección, `processPush()` creaba el cliente de forma incondicional
 * también para DELETE, lo que disparaba una renovación OAuth real aunque no
 * hubiera nada que borrar en Google.
 *
 * SyncService se ejecuta contra dobles completos de EntityManager,
 * GoogleClientFactory, EventMapper, ContactNameResolver, Config, Messages y
 * Log: no necesita EspoCRM en marcha ni red hacia Google.
 *
 * Uso:  php tests/exclusion_sync_service_test.php <ruta-del-modulo>
 */

declare(strict_types=1);

// ---------------------------------------------------- Dobles del núcleo
namespace Espo\ORM {
    interface Entity {}

    /** Doble de repositorio: soporta where()->order()->limit()->find() y where()->findOne(). */
    class FakeQueryBuilder
    {
        /** @var array<int, object> */
        public array $results = [];
        public ?object $one = null;

        public function __construct(public string $entityType) {}

        /** @param array<string, mixed> $w */
        public function where(array $w): self { return $this; }
        public function order(mixed $o = null, mixed $d = null): self { return $this; }
        public function limit(mixed $o = null, mixed $l = null): self { return $this; }

        /** @return array<int, object> */
        public function find(): array { return $this->results; }
        public function findOne(): ?object { return $this->one; }
    }

    class EntityManager
    {
        /** @var array<string, FakeQueryBuilder> */
        public array $repos = [];
        /** @var array<string, object> */
        public array $entitiesById = [];
        /** @var array<int, object> */
        public array $savedEntities = [];
        /** @var array<int, object> */
        public array $removedEntities = [];
        private int $newEntityCounter = 0;

        public function getRDBRepository(string $entityType): FakeQueryBuilder
        {
            return $this->repos[$entityType] ??= new FakeQueryBuilder($entityType);
        }

        public function getEntityById(string $entityType, string $id): ?object
        {
            return $this->entitiesById[$entityType . ':' . $id] ?? null;
        }

        /** @param array<string, mixed> $options */
        public function saveEntity(object $entity, array $options = []): void
        {
            $this->savedEntities[] = $entity;
        }

        public function removeEntity(object $entity): void
        {
            $this->removedEntities[] = $entity;
        }

        public function getNewEntity(string $entityType): object
        {
            $this->newEntityCounter++;

            return new \FakeRecord($entityType . '-new-' . $this->newEntityCounter);
        }
    }
}

namespace Espo\Core\Utils {
    class Config
    {
        /** @param array<string, mixed> $data */
        public function __construct(private array $data = []) {}

        public function get(string $key): mixed
        {
            return $this->data[$key] ?? null;
        }
    }

    class Log
    {
        /** @var array<int, string> */
        public array $errors = [];

        public function error(string $message): void
        {
            $this->errors[] = $message;
        }
    }
}

namespace Espo\Modules\GoogleCalendarSync\Classes {
    class Messages
    {
        /** @param array<string, mixed> $params */
        public function get(string $key, string $default = '', array $params = []): string
        {
            return $default;
        }
    }

    class EventMapper
    {
        public const MEETING_ID_PROPERTY = 'espoMeetingId';

        /** IDs que esta prueba trata como cancelados. @var array<string, true> */
        public static array $canceledIds = [];

        public function isCanceled(object $meeting): bool
        {
            return isset(self::$canceledIds[$meeting->getId()]);
        }

        /** @param string[] $contactNames */
        public function toGoogleEvent(object $meeting, array $contactNames = []): object
        {
            return new \Google\Service\Calendar\Event('summary-' . $meeting->getId());
        }
    }

    class ContactNameResolver
    {
        /** @return string[] */
        public function getNames(object $meeting): array
        {
            return [];
        }
    }

    class GoogleClientFactory
    {
        public static int $calls = 0;
        public static ?\Throwable $throwOnCreate = null;
        public static ?\Google\Service\Calendar $lastService = null;

        public function createCalendarService(object $account): object
        {
            self::$calls++;

            if (self::$throwOnCreate) {
                throw self::$throwOnCreate;
            }

            self::$lastService = new \Google\Service\Calendar();

            return self::$lastService;
        }
    }
}

// Los tipos declarados en las firmas privadas reales de SyncService (que sí
// se ejecutan en esta prueba) exigen que los dobles sean instancias de las
// clases reales de google/apiclient-services — nunca se carga el paquete
// vendor real, solo se redeclaran los dos tipos mínimos que se usan.
namespace Google\Service {
    class Exception extends \Exception {}

    class Calendar
    {
        public \FakeEventsResource $events;

        public function __construct()
        {
            $this->events = new \FakeEventsResource();
        }
    }
}

namespace Google\Service\Calendar {
    class Event
    {
        public function __construct(
            private string $summary = '',
            private string $id = 'evt-fake',
            private string $etag = 'etag-fake'
        ) {}

        public function getSummary(): string { return $this->summary; }
        public function getId(): string { return $this->id; }
        public function getEtag(): string { return $this->etag; }
    }
}

// ---------------------------------------------------- Dobles auxiliares
namespace {

    class FakeEventsResource
    {
        /** @var array<int, array{0: string, 1: object}> */
        public array $insertCalls = [];
        /** @var array<int, array{0: string, 1: string, 2: object}> */
        public array $updateCalls = [];
        /** @var array<int, array{0: string, 1: string}> */
        public array $deleteCalls = [];

        public function insert(string $calendarId, object $event): \Google\Service\Calendar\Event
        {
            $this->insertCalls[] = [$calendarId, $event];

            return new \Google\Service\Calendar\Event('inserted');
        }

        public function update(string $calendarId, string $eventId, object $event): \Google\Service\Calendar\Event
        {
            $this->updateCalls[] = [$calendarId, $eventId, $event];

            return new \Google\Service\Calendar\Event('updated');
        }

        public function delete(string $calendarId, string $eventId): void
        {
            $this->deleteCalls[] = [$calendarId, $eventId];
        }

        public function listEvents(string $calendarId, array $params): object
        {
            return new class {
                /** @return array<int, object> */
                public function getItems(): array { return []; }
            };
        }
    }

    class FakeRecord implements \Espo\ORM\Entity
    {
        /** @param array<string, mixed> $data */
        public function __construct(private string $id, private array $data = []) {}

        public function getId(): string { return $this->id; }

        public function get(string $key): mixed { return $this->data[$key] ?? null; }

        /** @param string|array<string, mixed> $keyOrData */
        public function set(string|array $keyOrData, mixed $value = null): void
        {
            if (is_array($keyOrData)) {
                foreach ($keyOrData as $k => $v) {
                    $this->data[$k] = $v;
                }

                return;
            }

            $this->data[$keyOrData] = $value;
        }
    }
}

namespace {

    use Espo\Core\Utils\Config;
    use Espo\Core\Utils\Log;
    use Espo\Modules\GoogleCalendarSync\Classes\ContactNameResolver;
    use Espo\Modules\GoogleCalendarSync\Classes\EventMapper;
    use Espo\Modules\GoogleCalendarSync\Classes\GoogleClientFactory;
    use Espo\Modules\GoogleCalendarSync\Classes\Messages;
    use Espo\Modules\GoogleCalendarSync\Classes\SyncService;
    use Espo\ORM\EntityManager;
    use Espo\ORM\FakeQueryBuilder;

    $root = rtrim($argv[1] ?? '', '/');

    if ($root === '' || !is_dir($root)) {
        fwrite(STDERR, "Uso: php tests/exclusion_sync_service_test.php <ruta-del-modulo>\n");
        exit(2);
    }

    require $root . '/Classes/SyncService.php';

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

    /**
     * @param array<string, mixed> $config
     * @return array{0: SyncService, 1: EntityManager, 2: FakeRecord}
     */
    function newSyncService(array $config = ['gcsSyncStartAt' => '2026-08-01 00:00:00']): array
    {
        GoogleClientFactory::$calls = 0;
        GoogleClientFactory::$throwOnCreate = null;
        GoogleClientFactory::$lastService = null;
        EventMapper::$canceledIds = [];

        $em = new EntityManager();

        $account = new FakeRecord('acct-business', ['calendarId' => 'cal-business']);
        $accountRepo = new FakeQueryBuilder('GcsAccount');
        $accountRepo->one = $account;
        $em->repos['GcsAccount'] = $accountRepo;

        $sync = new SyncService(
            $em,
            new GoogleClientFactory(),
            new EventMapper(),
            new ContactNameResolver(),
            new Config($config),
            new Messages(),
            new Log()
        );

        return [$sync, $em, $account];
    }

    // ==== A · Excluida + upsert (creación/actualización normal): cero todo ====
    [$sync, $em] = newSyncService();
    $meeting = new FakeRecord('m-excluded', ['cExcluirGoogleCalendarSync' => true]);
    $em->entitiesById['Meeting:m-excluded'] = $meeting;

    $sync->pushMeeting('m-excluded');

    check('A1 · excluida (upsert) no llama a GoogleClientFactory', GoogleClientFactory::$calls === 0);
    check('A2 · excluida (upsert) no guarda ni siquiera la cuenta', $em->savedEntities === []);

    // ==== B · No excluida: comportamiento normal intacto (regresión) ====
    [$sync, $em] = newSyncService();
    $meeting = new FakeRecord('m-normal', ['cExcluirGoogleCalendarSync' => false]);
    $em->entitiesById['Meeting:m-normal'] = $meeting;
    $em->repos['GcsEventLink'] = new FakeQueryBuilder('GcsEventLink');

    $sync->pushMeeting('m-normal');

    check('B1 · no excluida sí llama a GoogleClientFactory', GoogleClientFactory::$calls === 1);
    check('B2 · no excluida inserta el evento', count(GoogleClientFactory::$lastService->events->insertCalls) === 1);
    check('B3 · no excluida actualiza la cuenta (lastSyncAt/status)', $em->savedEntities !== []);

    // ==== C · Campo ausente/null se trata como false ====
    [$sync, $em] = newSyncService();
    $meeting = new FakeRecord('m-null', []);
    $em->entitiesById['Meeting:m-null'] = $meeting;
    $em->repos['GcsEventLink'] = new FakeQueryBuilder('GcsEventLink');

    $sync->pushMeeting('m-null');

    check('C1 · campo ausente/null se sincroniza (se trata como false)', GoogleClientFactory::$calls === 1);

    // ==== D · Excluida + DELETE con vínculo heredado: limpieza permitida ====
    [$sync, $em] = newSyncService();
    $meeting = new FakeRecord('m-cleanup', ['cExcluirGoogleCalendarSync' => true]);
    $em->entitiesById['Meeting:m-cleanup'] = $meeting;
    $link = new FakeRecord('link-old', ['calendarId' => 'cal-business', 'eventId' => 'evt-old']);
    $linkRepo = new FakeQueryBuilder('GcsEventLink');
    $linkRepo->results = [$link];
    $em->repos['GcsEventLink'] = $linkRepo;

    $sync->pushMeeting('m-cleanup', SyncService::ACTION_DELETE);

    check('D1 · delete con vínculo heredado sí llama a GoogleClientFactory', GoogleClientFactory::$calls === 1);
    check('D2 · el evento se borra en Google', count(GoogleClientFactory::$lastService->events->deleteCalls) === 1);
    check('D3 · el vínculo local se elimina', in_array($link, $em->removedEntities, true));

    // ==== E · DELETE sin vínculo, OAuth válido (caso 1): no-op local puro ====
    // Antes de la corrección, createCalendarService() SÍ se llamaba aquí
    // (incidente de la Puerta 5A) — ahora processDelete() consulta
    // GcsEventLink localmente antes de crear ningún cliente.
    [$sync, $em] = newSyncService();
    $meeting = new FakeRecord('m-noop', ['cExcluirGoogleCalendarSync' => true]);
    $em->entitiesById['Meeting:m-noop'] = $meeting;
    $em->repos['GcsEventLink'] = new FakeQueryBuilder('GcsEventLink');

    $sync->pushMeeting('m-noop', SyncService::ACTION_DELETE);

    check('E1 · delete sin vínculo: cero cliente/transporte (createCalendarService NO se llama)',
        GoogleClientFactory::$calls === 0);
    check('E2 · cero llamadas events->delete (nada que borrar)',
        GoogleClientFactory::$lastService === null);
    check('E3 · cero entidades eliminadas', $em->removedEntities === []);
    check('E4 · cero cambio en GcsAccount (no-op puro, nada que registrar)',
        $em->savedEntities === []);

    // ==== F · Cancelada y excluida, CON vínculo: la cancelación permite limpiar ====
    [$sync, $em] = newSyncService();
    EventMapper::$canceledIds = ['m-canceled' => true];
    $meeting = new FakeRecord('m-canceled', ['cExcluirGoogleCalendarSync' => true]);
    $em->entitiesById['Meeting:m-canceled'] = $meeting;
    $link = new FakeRecord('link-canceled', ['calendarId' => 'cal-business', 'eventId' => 'evt-canceled']);
    $linkRepo = new FakeQueryBuilder('GcsEventLink');
    $linkRepo->results = [$link];
    $em->repos['GcsEventLink'] = $linkRepo;

    $sync->pushMeeting('m-canceled'); // acción por defecto: upsert

    check('F1 · cancelada y excluida con vínculo heredado sí limpia (isCanceled fuerza mustDelete)',
        GoogleClientFactory::$calls === 1);
    check('F2 · el vínculo se elimina', in_array($link, $em->removedEntities, true));

    // ==== G · sweep(): cita excluida con vínculo heredado se limpia ====
    [$sync, $em] = newSyncService();
    $meeting = new FakeRecord('m-sweep-cleanup', [
        'cExcluirGoogleCalendarSync' => true,
        'modifiedAt' => '2026-08-10 00:00:00',
    ]);
    $em->entitiesById['Meeting:m-sweep-cleanup'] = $meeting;
    $meetingRepo = new FakeQueryBuilder('Meeting');
    $meetingRepo->results = [$meeting];
    $em->repos['Meeting'] = $meetingRepo;
    $link = new FakeRecord('link-sweep', ['calendarId' => 'cal-business', 'eventId' => 'evt-sweep']);
    $linkRepo = new FakeQueryBuilder('GcsEventLink');
    $linkRepo->one = $link;
    $linkRepo->results = [$link];
    $em->repos['GcsEventLink'] = $linkRepo;

    $sync->sweep();

    check('G1 · sweep limpia el vínculo heredado de una cita excluida', GoogleClientFactory::$calls === 1);
    check('G2 · el vínculo se elimina', in_array($link, $em->removedEntities, true));

    // ==== H · sweep(): cita excluida sin vínculo se ignora por completo ====
    // Cubre el caso 9 de la matriz de pruebas del incidente OAuth/DELETE:
    // sweep() ya filtra por `findLink()` antes de llamar a pushMeeting(), así
    // que ni siquiera llega a processDelete() — cero OAuth confirmado aquí en
    // dos niveles (el propio filtro de sweep + la guardia central).
    [$sync, $em] = newSyncService();
    $meeting = new FakeRecord('m-sweep-skip', [
        'cExcluirGoogleCalendarSync' => true,
        'modifiedAt' => '2026-08-10 00:00:00',
    ]);
    $meetingRepo = new FakeQueryBuilder('Meeting');
    $meetingRepo->results = [$meeting];
    $em->repos['Meeting'] = $meetingRepo;
    $em->repos['GcsEventLink'] = new FakeQueryBuilder('GcsEventLink');

    $sync->sweep();

    check('H1 · sweep no toca una cita excluida sin vínculo (caso 9)', GoogleClientFactory::$calls === 0);

    // ==== I · sweep(): cita normal sigue funcionando (regresión) ====
    [$sync, $em] = newSyncService();
    $meeting = new FakeRecord('m-sweep-normal', [
        'cExcluirGoogleCalendarSync' => false,
        'modifiedAt' => '2026-08-10 00:00:00',
    ]);
    $em->entitiesById['Meeting:m-sweep-normal'] = $meeting;
    $meetingRepo = new FakeQueryBuilder('Meeting');
    $meetingRepo->results = [$meeting];
    $em->repos['Meeting'] = $meetingRepo;
    $em->repos['GcsEventLink'] = new FakeQueryBuilder('GcsEventLink');

    $sync->sweep();

    check('I1 · sweep sigue exportando citas normales', GoogleClientFactory::$calls === 1);

    // ==== K · DELETE sin vínculo, OAuth caducado/revocado (caso 2) ====
    // $throwOnCreate simula que, SI se llegara a crear el cliente, la
    // renovación OAuth fallaría (invalid_grant). La guardia central de
    // processDelete() debe cortar antes de eso: createCalendarService()
    // nunca se invoca, así que $throwOnCreate nunca llega a dispararse.
    [$sync, $em] = newSyncService();
    $meeting = new FakeRecord('m-noop-oauth-broken', ['cExcluirGoogleCalendarSync' => true]);
    $em->entitiesById['Meeting:m-noop-oauth-broken'] = $meeting;
    $em->repos['GcsEventLink'] = new FakeQueryBuilder('GcsEventLink');
    GoogleClientFactory::$throwOnCreate = new \Exception('invalid_grant simulado — no debería dispararse');

    $threw = false;

    try {
        $sync->pushMeeting('m-noop-oauth-broken', SyncService::ACTION_DELETE);
    } catch (\Throwable) {
        $threw = true;
    }

    check('K1 · delete sin vínculo con OAuth roto: no intenta refresh (createCalendarService no se llama)',
        GoogleClientFactory::$calls === 0);
    check('K2 · no lanza ninguna excepción (el fallo simulado nunca se alcanza)', $threw === false);
    check('K3 · GcsAccount.lastError/lastSyncAt intactos (nada guardado)', $em->savedEntities === []);

    GoogleClientFactory::$throwOnCreate = null;

    // ==== L · Soft-delete de Meeting excluido=true sin vínculo (caso 3) ====
    // Mismo camino que `GcsPush::afterRemove()` produce en la app real: la
    // exclusión no bloquea el DELETE (por diseño), pero sin vínculo tampoco
    // hay nada que hacer.
    [$sync, $em] = newSyncService();
    $meeting = new FakeRecord('m-softdelete-excluded', ['cExcluirGoogleCalendarSync' => true]);
    $em->entitiesById['Meeting:m-softdelete-excluded'] = $meeting;
    $em->repos['GcsEventLink'] = new FakeQueryBuilder('GcsEventLink');

    $sync->pushMeeting('m-softdelete-excluded', SyncService::ACTION_DELETE);

    check('L1 · soft-delete de Meeting excluido sin vínculo: cero efectos externos',
        GoogleClientFactory::$calls === 0);
    check('L2 · cero cambio en GcsAccount', $em->savedEntities === []);

    // ==== M · Cancelación de Meeting excluido=true sin vínculo (caso 4) ====
    // A diferencia del bloque F (que sí tiene vínculo heredado), aquí no hay
    // nada que limpiar: la cancelación fuerza mustDelete, pero sin vínculo
    // debe quedar en el mismo no-op local.
    [$sync, $em] = newSyncService();
    EventMapper::$canceledIds = ['m-canceled-noop' => true];
    $meeting = new FakeRecord('m-canceled-noop', ['cExcluirGoogleCalendarSync' => true]);
    $em->entitiesById['Meeting:m-canceled-noop'] = $meeting;
    $em->repos['GcsEventLink'] = new FakeQueryBuilder('GcsEventLink');

    $sync->pushMeeting('m-canceled-noop'); // acción por defecto: upsert, isCanceled fuerza mustDelete

    check('M1 · cancelada y excluida, sin vínculo: cero efectos externos',
        GoogleClientFactory::$calls === 0);
    check('M2 · cero cambio en GcsAccount', $em->savedEntities === []);

    // ==== N · Transición false→true sin vínculo (caso 5) ====
    // `GcsPush::afterSave()` encola ACTION_DELETE cuando el campo pasa a
    // true — desde la perspectiva de SyncService es indistinguible de
    // cualquier otro DELETE explícito (L, K), pero se deja como caso propio
    // porque así lo pide la matriz de pruebas del incidente.
    [$sync, $em] = newSyncService();
    $meeting = new FakeRecord('m-false-to-true', ['cExcluirGoogleCalendarSync' => true]);
    $em->entitiesById['Meeting:m-false-to-true'] = $meeting;
    $em->repos['GcsEventLink'] = new FakeQueryBuilder('GcsEventLink');

    $sync->pushMeeting('m-false-to-true', SyncService::ACTION_DELETE);

    check('N1 · false→true sin vínculo: cero efectos externos', GoogleClientFactory::$calls === 0);

    // ==== O · DELETE con vínculo y OAuth inválido (caso 7) ====
    // A diferencia de K (sin vínculo), aquí SÍ hay algo que borrar: la
    // guardia central debe dejar pasar la creación del cliente, intentar
    // OAuth, fallar, conservar el vínculo (no se llega a removeEntity) y
    // registrar el error contractual en GcsAccount.
    [$sync, $em] = newSyncService();
    $meeting = new FakeRecord('m-delete-oauth-broken', ['cExcluirGoogleCalendarSync' => true]);
    $em->entitiesById['Meeting:m-delete-oauth-broken'] = $meeting;
    $link = new FakeRecord('link-oauth-broken', ['calendarId' => 'cal-business', 'eventId' => 'evt-broken']);
    $linkRepo = new FakeQueryBuilder('GcsEventLink');
    $linkRepo->results = [$link];
    $em->repos['GcsEventLink'] = $linkRepo;
    GoogleClientFactory::$throwOnCreate = new \Exception('invalid_grant simulado');

    $threw = false;

    try {
        $sync->pushMeeting('m-delete-oauth-broken', SyncService::ACTION_DELETE);
    } catch (\Throwable) {
        $threw = true;
    }

    check('O1 · delete con vínculo y OAuth inválido: sí intenta OAuth (createCalendarService se llama)',
        GoogleClientFactory::$calls === 1);
    check('O2 · el vínculo se conserva (no se elimina tras el fallo)',
        !in_array($link, $em->removedEntities, true));
    check('O3 · se relanza la excepción (comportamiento contractual, reintentable por el job)',
        $threw === true);
    check('O4 · GcsAccount queda marcada en error (registerError sí se ejecuta)',
        $em->savedEntities !== []);

    GoogleClientFactory::$throwOnCreate = null;

    // ==== P · Job DELETE antiguo/manual sin vínculo (caso 8) ====
    // Simula un job encolado antes de esta corrección (o cualquier llamador
    // que nunca pasó por el filtrado de GcsPush): pushMeeting() se invoca
    // directamente, sin ningún prefiltro de hook. La garantía debe sostenerse
    // igual porque vive en SyncService, no en el hook que encola el job.
    [$sync, $em] = newSyncService();
    $meeting = new FakeRecord('m-legacy-job', ['cExcluirGoogleCalendarSync' => false]);
    $em->entitiesById['Meeting:m-legacy-job'] = $meeting;
    $em->repos['GcsEventLink'] = new FakeQueryBuilder('GcsEventLink');

    $sync->pushMeeting('m-legacy-job', SyncService::ACTION_DELETE);

    check('P1 · job DELETE antiguo/manual sin vínculo: protegido por el punto central',
        GoogleClientFactory::$calls === 0);

    // ==== Q · Concurrencia: dos DELETE sobre el mismo vínculo (caso 10) ====
    // El doble de repositorio no refleja automáticamente el removeEntity()
    // de la primera llamada, así que se actualiza manualmente entre ambas
    // para modelar el estado real de la base tras la primera limpieza — la
    // comprobación que importa es que la segunda llamada, al encontrar 0
    // vínculos localmente, no repite ninguna llamada a Google ni falla.
    [$sync, $em] = newSyncService();
    $meeting = new FakeRecord('m-concurrent', ['cExcluirGoogleCalendarSync' => false]);
    $em->entitiesById['Meeting:m-concurrent'] = $meeting;
    $link = new FakeRecord('link-concurrent', ['calendarId' => 'cal-business', 'eventId' => 'evt-concurrent']);
    $linkRepo = new FakeQueryBuilder('GcsEventLink');
    $linkRepo->results = [$link];
    $em->repos['GcsEventLink'] = $linkRepo;

    $sync->pushMeeting('m-concurrent', SyncService::ACTION_DELETE);

    check('Q1 · primer DELETE concurrente sí borra el evento', GoogleClientFactory::$calls === 1);
    check('Q2 · primer DELETE elimina el vínculo', in_array($link, $em->removedEntities, true));

    // La base ya refleja la limpieza: el segundo intento (reintento del
    // mismo job, o un segundo worker) encuentra 0 vínculos.
    $linkRepo->results = [];

    $sync->pushMeeting('m-concurrent', SyncService::ACTION_DELETE);

    check('Q3 · segundo DELETE (vínculo ya limpiado): no repite la llamada a Google',
        GoogleClientFactory::$calls === 1);
    check('Q4 · resultado idempotente: sigue habiendo exactamente un vínculo eliminado en total',
        count(array_filter($em->removedEntities, fn ($e) => $e === $link)) === 1);

    // ==== J · El gate de exclusión se evalúa antes de crear el cliente ====
    // (sin esto, un fallo de red/OAuth podría dispararse igualmente para una
    // cita excluida — la comprobación en código real está en pushMeeting(),
    // antes de processPush()/createCalendarService()).
    $source = (string) file_get_contents($root . '/Classes/SyncService.php');

    check('J1 · isExcludedFromSync se comprueba antes de processPush',
        (bool) preg_match('/isExcludedFromSync.*?\n.*?return;.*?\n.*?\n.*?try\s*\{\s*\n\s*(?:\$\w+\s*=\s*)?\$this->processPush/s', $source));

    // ==== R · processDelete consulta GcsEventLink ANTES de crear el cliente ====
    // Comprobación estructural directa sobre el código fuente real (no solo
    // sobre el comportamiento observado con los dobles): dentro de
    // processDelete(), la consulta a GcsEventLink y el `return false`
    // temprano deben aparecer textualmente ANTES de createCalendarService().
    // Esta es la comprobación que habría detectado el incidente de la
    // Puerta 5A si hubiera existido antes: en el código previo,
    // createCalendarService() aparecía antes de cualquier consulta local a
    // GcsEventLink dentro de processPush().
    check('R1 · processDelete consulta GcsEventLink y puede retornar antes de crear el cliente',
        (bool) preg_match(
            '/private function processDelete.*?getRDBRepository\(\'GcsEventLink\'\).*?->find\(\).*?' .
            'if \(!count\(\$links\)\)\s*\{\s*\n\s*return false;.*?createCalendarService/s',
            $source
        ));

    if ($failures) {
        echo 'EXCLUSIÓN GCS (SyncService): FALLA (' . count($failures) . '/' . $assertions . ")\n";

        foreach ($failures as $f) {
            echo "  ✗ $f\n";
        }

        exit(1);
    }

    echo "EXCLUSIÓN GCS (SyncService): OK ($assertions aserciones)\n";

    exit(0);
}
