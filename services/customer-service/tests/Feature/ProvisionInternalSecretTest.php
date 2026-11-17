<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Spec 0044, AC-8: customer provisioning is internal only.
 */
class ProvisionInternalSecretTest extends TestCase
{
    private const SECRET = 'test-internal-secret-0044';

    private array $payload = [
        'client_name' => 'Acme Labs',
        'email' => 'acme-0044@example.com',
        'address' => '1 Test Street',
        'contact_number' => '09170000000',
    ];

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake(['*' => Http::response(['status' => 'success'], 200)]);
        Mail::fake();
        $this->ensureTablesExist();
        config(['services.internal.secret' => self::SECRET]);
    }

    private function ensureTablesExist(): void
    {
        if (!Schema::hasTable('clients')) {
            Schema::create('clients', function ($table) {
                $table->id();
                $table->string('client_name');
                $table->string('email')->unique();
                $table->string('address')->nullable();
                $table->string('contact_number')->nullable();
                $table->boolean('status')->default(true);
                $table->timestamps();
            });
        }
        if (!Schema::hasTable('clients_credentials')) {
            Schema::create('clients_credentials', function ($table) {
                $table->id();
                $table->unsignedBigInteger('client_id');
                $table->string('password_hash');
                $table->integer('failed_login_count')->default(0);
                $table->timestamp('locked_until')->nullable();
                $table->timestamp('last_login_at')->nullable();
                $table->timestamp('password_change_at')->nullable();
                $table->timestamps();
            });
        }
    }

    public function test_missing_secret_header_is_rejected_with_401(): void
    {
        $this->postJson('/api/customers/provision', $this->payload)->assertStatus(401);
        $this->assertDatabaseMissing('clients', ['email' => $this->payload['email']]);
    }

    public function test_wrong_secret_header_is_rejected_with_401(): void
    {
        $this->postJson('/api/customers/provision', $this->payload, ['X-Internal-Secret' => 'wrong'])
            ->assertStatus(401);
        $this->assertDatabaseMissing('clients', ['email' => $this->payload['email']]);
    }

    public function test_unconfigured_server_secret_fails_closed_with_503(): void
    {
        config(['services.internal.secret' => '']);

        $this->postJson('/api/customers/provision', $this->payload, ['X-Internal-Secret' => ''])
            ->assertStatus(503);
        $this->assertDatabaseMissing('clients', ['email' => $this->payload['email']]);
    }

    public function test_correct_secret_reaches_the_provision_controller(): void
    {
        $response = $this->postJson('/api/customers/provision', $this->payload, ['X-Internal-Secret' => self::SECRET]);

        $this->assertNotContains($response->status(), [401, 503]);
        $response->assertStatus(201, $response->getContent());
        $this->assertDatabaseHas('clients', ['email' => $this->payload['email']]);
    }

    public function test_send_welcome_email_false_creates_the_account_without_any_email(): void
    {
        $mailer = \Mockery::mock(\App\Services\Mail\ConfigServiceMailer::class);
        $mailer->shouldNotReceive('send');
        $this->app->instance(\App\Services\Mail\ConfigServiceMailer::class, $mailer);

        $payload = ['client_name' => 'CMS Silent', 'email' => 'cms-silent@example.com', 'send_welcome_email' => false];

        $this->postJson('/api/customers/provision', $payload, ['X-Internal-Secret' => self::SECRET])
            ->assertStatus(201)
            ->assertJsonPath('status', 'created')
            ->assertJsonPath('welcome_email_sent', false);
        $this->assertDatabaseHas('clients', ['email' => 'cms-silent@example.com']);
    }

    public function test_welcome_email_is_still_sent_by_default(): void
    {
        $mailer = \Mockery::mock(\App\Services\Mail\ConfigServiceMailer::class);
        $mailer->shouldReceive('send')->once();
        $this->app->instance(\App\Services\Mail\ConfigServiceMailer::class, $mailer);

        $this->postJson('/api/customers/provision', ['client_name' => 'Default', 'email' => 'default-0044@example.com'], ['X-Internal-Secret' => self::SECRET])
            ->assertStatus(201);
    }

    public function test_name_and_email_alone_are_enough_for_the_crms_machine_sync(): void
    {
        $payload = ['client_name' => 'CRMS Only', 'email' => 'crms-only@example.com'];

        $this->postJson('/api/customers/provision', $payload, ['X-Internal-Secret' => self::SECRET])
            ->assertStatus(201)
            ->assertJsonPath('status', 'created');
        $this->assertDatabaseHas('clients', ['email' => 'crms-only@example.com', 'address' => '', 'contact_number' => '']);

        $this->postJson('/api/customers/provision', $payload, ['X-Internal-Secret' => self::SECRET])
            ->assertStatus(200)
            ->assertJsonPath('status', 'exists');
    }
}
