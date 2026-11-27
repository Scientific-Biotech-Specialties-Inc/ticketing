<?php

namespace Tests\Support;

use Illuminate\Support\Str;

/**
 * Finds code that writes to a table analytics-service does not own (spec 0050 AC-15).
 *
 * Flags:
 *   (a) DB::table('<non owned>') ... ->insert / update / upsert / delete / truncate / increment / decrement
 *       (and their variants such as insertGetId, updateOrInsert) in the same statement;
 *   (b) DB::statement / unprepared / insert / update / delete whose statement text names a non owned table;
 *   (c) an Eloquent model whose table is non owned and that is not read only, meaning it lacks a
 *       saving hook and a deleting hook that throw.
 */
final class ReadOnlyTableScanner
{
    /** Tables analytics-service only reads. Their owners are ticket-service, employee-service and others. */
    public const NON_OWNED_TABLES = [
        'tickets',
        'ticket_statuses',
        'ticket_priorities',
        'ticket_assignments',
        'ticket_assignment_periods',
        'reassignment_requests',
        'employees',
        'branches',
        'machines',
        'problem_categories',
        'clients',
        // Read by TechnicalDepartments (shared package); owned by the superadmin settings in ticket-service.
        'departments',
    ];

    private const WRITE_METHODS = '(?:insert\w*|update\w*|upsert|delete|truncate|increment\w*|decrement\w*|forceDelete)';

    /**
     * @param array<int, string> $directories
     * @return array<int, string> one line per violation: "path: reason"
     */
    public function scanDirectories(array $directories): array
    {
        $violations = [];
        foreach ($directories as $dir) {
            if (!is_dir($dir)) {
                continue;
            }
            $files = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS));
            foreach ($files as $file) {
                if ($file->getExtension() !== 'php') {
                    continue;
                }
                foreach ($this->scanSource((string) file_get_contents($file->getPathname())) as $reason) {
                    $violations[] = $file->getPathname() . ': ' . $reason;
                }
            }
        }

        return $violations;
    }

    /**
     * @return array<int, string> reasons found in one PHP source
     */
    public function scanSource(string $source): array
    {
        $code = $this->stripComments($source);

        return array_merge($this->queryBuilderWrites($code), $this->rawWrites($code), $this->writableModels($code));
    }

    /** (a) DB::table('x')->...->update(...) */
    private function queryBuilderWrites(string $code): array
    {
        $found = [];
        if (!preg_match_all('/DB::table\(\s*([\'"])([^\'"]+)\1\s*\)/', $code, $matches, PREG_OFFSET_CAPTURE)) {
            return $found;
        }

        foreach ($matches[2] as $i => [$tableExpr]) {
            $table = $this->baseTable($tableExpr);
            if (!$this->isNonOwned($table)) {
                continue;
            }
            $start = $matches[0][$i][1];
            $statement = $this->statementFrom($code, $start);
            if (preg_match('/->\s*' . self::WRITE_METHODS . '\s*\(/', $statement, $m)) {
                $found[] = "writes to non owned table '{$table}' via query builder (" . trim($m[0], "->( \t\n") . ')';
            }
        }

        return $found;
    }

    /** (b) DB::statement('UPDATE tickets ...') and friends */
    private function rawWrites(string $code): array
    {
        $found = [];
        if (!preg_match_all('/DB::(statement|unprepared|insert|update|delete)\s*\(/', $code, $matches, PREG_OFFSET_CAPTURE)) {
            return $found;
        }

        foreach ($matches[0] as $i => [, $offset]) {
            $statement = $this->statementFrom($code, $offset);
            foreach (self::NON_OWNED_TABLES as $table) {
                if (preg_match('/(?<![\w])`?' . preg_quote($table, '/') . '`?(?![\w])/i', $statement)) {
                    $found[] = "raw DB::{$matches[1][$i][0]} names non owned table '{$table}'";
                }
            }
        }

        return $found;
    }

    /** (c) class X extends Model with a non owned table and no throwing saving and deleting hooks */
    private function writableModels(string $code): array
    {
        if (!preg_match('/class\s+(\w+)\s+extends\s+(?:\\\\?Illuminate\\\\Database\\\\Eloquent\\\\)?Model\b/', $code, $m)) {
            return [];
        }

        $table = preg_match('/\$table\s*=\s*([\'"])([^\'"]+)\1/', $code, $t)
            ? $t[2]
            : Str::snake(Str::pluralStudly($m[1]));

        if (!$this->isNonOwned($table)) {
            return [];
        }

        $guarded = preg_match('/static::saving\s*\(.*?throw\s/s', $code)
            && preg_match('/static::deleting\s*\(.*?throw\s/s', $code);

        return $guarded ? [] : ["model {$m[1]} maps non owned table '{$table}' without throwing saving and deleting hooks"];
    }

    private function isNonOwned(string $table): bool
    {
        return in_array(strtolower($table), self::NON_OWNED_TABLES, true);
    }

    /** "tickets as t" -> "tickets" */
    private function baseTable(string $expr): string
    {
        return strtolower(preg_split('/\s+as\s+|\s+/i', trim($expr))[0]);
    }

    /** Source text from $offset to the end of its statement (first ; outside parentheses and strings). */
    private function statementFrom(string $code, int $offset): string
    {
        $depth = 0;
        $quote = null;
        $len = strlen($code);
        for ($i = $offset; $i < $len; $i++) {
            $c = $code[$i];
            if ($quote !== null) {
                if ($c === '\\') {
                    $i++;
                } elseif ($c === $quote) {
                    $quote = null;
                }
                continue;
            }
            if ($c === '\'' || $c === '"') {
                $quote = $c;
            } elseif ($c === '(' || $c === '[' || $c === '{') {
                $depth++;
            } elseif ($c === ')' || $c === ']' || $c === '}') {
                $depth--;
                if ($depth < 0) {
                    return substr($code, $offset, $i - $offset);
                }
            } elseif ($c === ';' && $depth <= 0) {
                return substr($code, $offset, $i - $offset);
            }
        }

        return substr($code, $offset);
    }

    private function stripComments(string $source): string
    {
        $out = '';
        foreach (token_get_all($source) as $token) {
            if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
                continue;
            }
            $out .= is_array($token) ? $token[1] : $token;
        }

        return $out;
    }
}
