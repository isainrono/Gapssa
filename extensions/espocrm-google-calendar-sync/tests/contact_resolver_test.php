<?php

/**
 * Comprueba el orden lógico de ContactNameResolver y que los errores del ORM
 * NO se silencian.
 *
 * El máximo de diez nombres debe aplicarse al final, sobre nombres ya válidos:
 * si se aplicara a las filas leídas, unos cuantos contactos vacíos o repetidos
 * al principio dejarían fuera contactos válidos posteriores.
 *
 * Uso:  php tests/contact_resolver_test.php <ruta-del-modulo>
 */

declare(strict_types=1);

namespace Espo\ORM {
    interface Entity {}

    class FakeRelationBuilder
    {
        /** @var array<int, object> */
        public static array $result = [];
        public static ?\Throwable $throwOnFind = null;
        /** @var array<string, mixed> */
        public static array $calls = [];

        public function limit(?int $o, ?int $l): self { self::$calls['limit'] = [$o, $l]; return $this; }
        public function order($o, $d = null): self { self::$calls['order'] = [$o, $d]; return $this; }
        public function select($s): self { self::$calls['select'] = $s; return $this; }

        public function find(): array
        {
            if (self::$throwOnFind) {
                throw self::$throwOnFind;
            }

            return self::$result;
        }
    }

    class FakeRepository
    {
        public function getRelation($e, string $link): FakeRelationBuilder
        {
            FakeRelationBuilder::$calls['link'] = $link;

            return new FakeRelationBuilder();
        }
    }

    class EntityManager
    {
        public function getRDBRepository(string $t): FakeRepository
        {
            FakeRelationBuilder::$calls['entityType'] = $t;

            return new FakeRepository();
        }
    }
}

namespace Espo\Modules\Crm\Entities {
    class Meeting { public const ENTITY_TYPE = 'Meeting'; public const LINK_CONTACTS = 'contacts'; }
}

namespace {

    use Espo\ORM\EntityManager;
    use Espo\ORM\FakeRelationBuilder;

    $root = rtrim($argv[1] ?? '', '/');

    if ($root === '' || !is_dir($root)) {
        fwrite(STDERR, "Uso: php tests/contact_resolver_test.php <ruta-del-modulo>\n");
        exit(2);
    }

    require $root . '/Classes/ContactNameResolver.php';

    class FakeContact implements \Espo\ORM\Entity
    {
        /** @param array<string, mixed> $data */
        public function __construct(private array $data) {}

        public function get(string $k): mixed { return $this->data[$k] ?? null; }
    }

    class FakeMeeting implements \Espo\ORM\Entity
    {
        public function getId(): string { return 'm1'; }
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

    /** @param array<int, array<string, mixed>> $contacts */
    function resolve(array $contacts, ?Throwable $throw = null): array
    {
        FakeRelationBuilder::$result = array_map(fn($c) => new FakeContact($c), $contacts);
        FakeRelationBuilder::$throwOnFind = $throw;
        FakeRelationBuilder::$calls = [];

        $resolver = new \Espo\Modules\GoogleCalendarSync\Classes\ContactNameResolver(new EntityManager());

        return $resolver->getNames(new FakeMeeting());
    }

    // ---- Vacíos ANTES de válidos: no deben consumir el cupo ----
    $contacts = [];

    foreach (range(1, 8) as $i) {
        $contacts[] = ['name' => '   '];
    }

    foreach (range(1, 12) as $i) {
        $contacts[] = ['name' => sprintf('Cliente %02d', $i)];
    }

    $names = resolve($contacts);

    check('vacíos al principio no consumen el máximo', count($names) === 10);
    check('los nombres devueltos son válidos', !in_array('', array_map('trim', $names), true));
    check('empieza por el primero alfabético', $names[0] === 'Cliente 01');

    // ---- Duplicados ANTES de válidos ----
    $contacts = [];

    foreach (range(1, 8) as $i) {
        $contacts[] = ['name' => 'Repetido'];
    }

    foreach (range(1, 12) as $i) {
        $contacts[] = ['name' => sprintf('Cliente %02d', $i)];
    }

    $names = resolve($contacts);

    check('duplicados al principio no consumen el máximo', count($names) === 10);
    check('el duplicado aparece una sola vez',
        count(array_keys($names, 'Repetido', true)) <= 1);

    // ---- Más de diez válidos: se cortan en diez ----
    $contacts = array_map(fn($i) => ['name' => sprintf('Cliente %02d', $i)], range(1, 25));
    $names = resolve($contacts);

    check('más de diez válidos se recortan a diez', count($names) === 10);
    check('se conservan los diez primeros alfabéticos',
        $names === array_map(fn($i) => sprintf('Cliente %02d', $i), range(1, 10)));

    // ---- Orden alfabético determinista ----
    $names = resolve([
        ['name' => 'Zoe Martín'],
        ['name' => 'ana lópez'],
        ['name' => 'Beatriz Ruiz'],
    ]);

    check('orden alfabético insensible a mayúsculas',
        $names === ['ana lópez', 'Beatriz Ruiz', 'Zoe Martín']);

    $a = resolve([['name' => 'Bea'], ['name' => 'Ana']]);
    $b = resolve([['name' => 'Ana'], ['name' => 'Bea']]);

    check('determinista: el orden de entrada no altera el resultado', $a === $b);

    // ---- Respaldo con firstName / middleName / lastName ----
    $names = resolve([['firstName' => 'María', 'lastName' => 'García']]);

    check('compone el nombre si `name` viene vacío', $names === ['María García']);

    $names = resolve([['firstName' => 'Ana', 'middleName' => 'Isabel', 'lastName' => 'López']]);

    check('incluye middleName en el respaldo', $names === ['Ana Isabel López']);

    // ---- La consulta lee más filas que el máximo ----
    resolve([['name' => 'X']]);

    check('la consulta usa un tope superior a diez, para descartar después',
        (FakeRelationBuilder::$calls['limit'][1] ?? 0) > 10);
    check('consulta la relación contacts de Meeting',
        (FakeRelationBuilder::$calls['link'] ?? null) === 'contacts' &&
        (FakeRelationBuilder::$calls['entityType'] ?? null) === 'Meeting');

    // ---- Los errores del ORM NO se silencian ----
    $propagated = false;

    try {
        resolve([['name' => 'X']], new RuntimeException('SQLSTATE[42S22]: columna desconocida'));
    } catch (RuntimeException $e) {
        $propagated = str_contains($e->getMessage(), 'SQLSTATE');
    }

    check('un error del ORM se propaga, no devuelve []', $propagated);

    // Un error propagado impide construir el evento: nunca se envía a Google un
    // título sin cliente como si fuera correcto.
    $source = (string) file_get_contents($root . '/Classes/ContactNameResolver.php');

    check('el resolver no captura Throwable', !str_contains($source, 'catch (Throwable'));
    check('el resolver no devuelve [] ante errores', !preg_match('/catch\s*\([^)]*\)\s*\{\s*(\/\/[^\n]*\n\s*)*return \[\];/', $source));

    if ($failures) {
        echo 'RESOLVER DE CONTACTOS: FALLA (' . count($failures) . '/' . $assertions . ")\n";

        foreach ($failures as $f) {
            echo "  ✗ $f\n";
        }

        exit(1);
    }

    echo "RESOLVER DE CONTACTOS: OK ($assertions aserciones)\n";

    exit(0);
}
