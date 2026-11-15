<?php

namespace Tests\Feature;

use Illuminate\Auth\GenericUser;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * Spec 0044, AC-13: a customer (Passport) token is refused on traffic the staff gateway marked
 * X-Ticketing-Edge: staff, when TICKETING_EDGE_ENFORCE is on. The customer portal edge marks its
 * traffic "customer", where the token keeps working.
 *
 * The real Passport guard is swapped for a request guard that accepts the bearer "customer-token",
 * so the test exercises AuthenticateSubsystem's fallback path without Passport keys.
 */
class EdgeTrafficMarkTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        Auth::viaRequest('fake-customer-token', function (Request $request) {
            return $request->bearerToken() === 'customer-token'
                ? new GenericUser(['id' => 501, 'role' => 'customer'])
                : null;
        });
        config(['auth.guards.api' => ['driver' => 'fake-customer-token']]);
        Auth::forgetGuards();

        Route::middleware('auth.subsystem')->get('/__spec0044/probe', fn () => response()->json(['ok' => true]));
        Route::middleware('auth.subsystem:optional')->get('/__spec0044/optional', fn () => response()->json(['ok' => true]));
    }

    private function asCustomer(?string $edge): \Illuminate\Testing\TestResponse
    {
        $headers = ['Authorization' => 'Bearer customer-token'];
        if ($edge !== null) {
            $headers['X-Ticketing-Edge'] = $edge;
        }

        return $this->getJson('/__spec0044/probe', $headers);
    }

    public function test_customer_token_is_refused_on_staff_traffic_when_enforced(): void
    {
        config(['services.edge.enforce' => true]);

        $this->asCustomer('staff')->assertStatus(401);
        $this->asCustomer('STAFF')->assertStatus(401);
    }

    public function test_customer_token_works_on_customer_edge_traffic_when_enforced(): void
    {
        config(['services.edge.enforce' => true]);

        $this->asCustomer('customer')->assertOk();
    }

    public function test_customer_token_works_on_unmarked_internal_traffic_when_enforced(): void
    {
        config(['services.edge.enforce' => true]);

        $this->asCustomer(null)->assertOk();
    }

    public function test_enforcement_off_keeps_todays_behaviour(): void
    {
        config(['services.edge.enforce' => false]);

        $this->asCustomer('staff')->assertOk();
    }

    public function test_optional_routes_still_serve_staff_traffic_as_guest(): void
    {
        config(['services.edge.enforce' => true]);

        $this->getJson('/__spec0044/optional', [
            'Authorization' => 'Bearer customer-token',
            'X-Ticketing-Edge' => 'staff',
        ])->assertOk();
    }
}
