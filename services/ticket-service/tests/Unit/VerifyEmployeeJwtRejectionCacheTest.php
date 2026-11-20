<?php

namespace Tests\Unit;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;
use Ticketing\Auth\Middleware\VerifyEmployeeJwt;

/**
 * A token that fails signature verification is remembered briefly, so repeat requests with the
 * same stale token get an immediate 401 instead of another remote auth-service round trip.
 *
 * These tests never write storage/auth-module-public.key: the forged signature fails local
 * verification whatever key is present, which keeps the running dev containers unaffected.
 */
class VerifyEmployeeJwtRejectionCacheTest extends TestCase
{
    private ?string $originalInternalToken = null;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();

        // Remote verification only runs when an internal secret is configured.
        $this->originalInternalToken = $_SERVER['INTERNAL_TOKEN'] ?? null;
        $_SERVER['INTERNAL_TOKEN'] = 'test-internal-token';
    }

    protected function tearDown(): void
    {
        if ($this->originalInternalToken === null) {
            unset($_SERVER['INTERNAL_TOKEN']);
        } else {
            $_SERVER['INTERNAL_TOKEN'] = $this->originalInternalToken;
        }
        parent::tearDown();
    }

    public function test_definitive_rejection_is_cached_and_skips_remote_verification(): void
    {
        Http::fake(['*/api/internal/verify-token' => Http::response(['valid' => false], 200)]);
        $token = $this->forgedToken();

        $this->assertSame(401, $this->callMiddleware($token));
        $this->assertSame(401, $this->callMiddleware($token));
        $this->assertSame(401, $this->callMiddleware($token));

        $this->assertSame(1, $this->remoteVerifyCalls());
    }

    public function test_definitive_rejection_expires_after_ttl(): void
    {
        Http::fake(['*/api/internal/verify-token' => Http::response(['valid' => false], 200)]);
        $token = $this->forgedToken();

        $this->callMiddleware($token);

        $this->travel(30)->seconds();
        $this->callMiddleware($token);
        $this->assertSame(1, $this->remoteVerifyCalls(), 'Still cached inside the 60s window');

        $this->travel(31)->seconds();
        $this->callMiddleware($token);
        $this->assertSame(2, $this->remoteVerifyCalls(), 'Re-verified once the 60s window passed');
    }

    public function test_transient_remote_failure_uses_short_cache_window(): void
    {
        Http::fake(['*/api/internal/verify-token' => Http::response(['message' => 'down'], 503)]);
        $token = $this->forgedToken();

        $this->assertSame(401, $this->callMiddleware($token));
        $this->assertSame(401, $this->callMiddleware($token));
        $this->assertSame(1, $this->remoteVerifyCalls());

        $this->travel(11)->seconds();
        $this->callMiddleware($token);
        $this->assertSame(2, $this->remoteVerifyCalls(), 'Transient failures are retried after 10s');
    }

    public function test_rejection_cache_is_per_token(): void
    {
        Http::fake(['*/api/internal/verify-token' => Http::response(['valid' => false], 200)]);

        $this->callMiddleware($this->forgedToken(1));
        $this->callMiddleware($this->forgedToken(2));

        $this->assertSame(2, $this->remoteVerifyCalls());
    }

    private function callMiddleware(string $token): int
    {
        $request = Request::create('/api/tickets', 'GET');
        $request->headers->set('Authorization', 'Bearer ' . $token);

        $response = (new VerifyEmployeeJwt())->handle($request, fn () => response()->json(['ok' => true]));

        return $response->getStatusCode();
    }

    private function remoteVerifyCalls(): int
    {
        return Http::recorded(fn ($request) => str_contains($request->url(), '/api/internal/verify-token'))->count();
    }

    private function forgedToken(int $sub = 1): string
    {
        $encode = fn (array $part) => rtrim(strtr(base64_encode(json_encode($part)), '+/', '-_'), '=');

        return $encode(['typ' => 'JWT', 'alg' => 'RS256'])
            . '.' . $encode(['sub' => $sub, 'jti' => 'forged-' . $sub, 'exp' => time() + 3600])
            . '.' . rtrim(strtr(base64_encode('not-a-real-signature'), '+/', '-_'), '=');
    }
}
