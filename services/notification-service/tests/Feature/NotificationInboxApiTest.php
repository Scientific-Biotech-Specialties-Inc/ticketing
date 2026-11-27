<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Employee;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Notification bell API, moved from ticket-service: list, mark all read, mark one read.
 */
class NotificationInboxApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_requires_authentication(): void
    {
        $this->getJson('/api/notifications')->assertUnauthorized();
        $this->patchJson('/api/notifications/read-all')->assertUnauthorized();
        $this->patchJson('/api/notifications/1/read')->assertUnauthorized();
    }

    public function test_employee_sees_only_their_own_notifications_newest_first(): void
    {
        $older = $this->insertNotification(7, 'employee', ['title' => 'Older', 'created_at' => now()->subHour()]);
        $newer = $this->insertNotification(7, 'employee', ['title' => 'Newer', 'is_read' => true]);
        $this->insertNotification(8, 'employee', ['title' => 'Someone else']);
        $this->insertNotification(7, 'client', ['title' => 'Client with the same id']);

        $response = $this->actingAs($this->employee(7))->getJson('/api/notifications')->assertOk();

        $this->assertSame([$newer, $older], array_column($response->json('notifications'), 'id'));
        $this->assertSame(1, $response->json('unread_count'));
        $this->assertTrue($response->json('notifications.0.is_read'));
        $this->assertSame('fixture', $response->json('notifications.0.type'));
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/', $response->json('notifications.0.created_at'));
    }

    public function test_client_never_sees_reassignment_notifications(): void
    {
        $this->insertNotification(5, 'client', ['title' => 'Ticket updated']);
        $this->insertNotification(5, 'client', ['title' => 'Ticket reassigned']);
        $this->insertNotification(5, 'client', ['message' => 'Your ticket was reassigned to a new engineer']);

        $response = $this->actingAs($this->client(5))->getJson('/api/notifications')->assertOk();

        $this->assertCount(1, $response->json('notifications'));
        $this->assertSame(1, $response->json('unread_count'));
    }

    public function test_mark_all_read_touches_only_the_recipient(): void
    {
        $mine = $this->insertNotification(7, 'employee');
        $theirs = $this->insertNotification(8, 'employee');

        $this->actingAs($this->employee(7))->patchJson('/api/notifications/read-all')
            ->assertOk()
            ->assertJson(['unread_count' => 0]);

        $this->assertDatabaseHas('notifications', ['id' => $mine, 'is_read' => true]);
        $this->assertDatabaseHas('notifications', ['id' => $theirs, 'is_read' => false]);
    }

    public function test_mark_one_read_returns_the_notification_and_remaining_count(): void
    {
        $first = $this->insertNotification(7, 'employee');
        $this->insertNotification(7, 'employee');

        $this->actingAs($this->employee(7))->patchJson("/api/notifications/{$first}/read")
            ->assertOk()
            ->assertJsonPath('notification.id', $first)
            ->assertJsonPath('notification.is_read', true)
            ->assertJsonPath('unread_count', 1);
    }

    public function test_cannot_read_or_mark_someone_elses_notification(): void
    {
        $theirs = $this->insertNotification(8, 'employee', ['title' => 'Private']);

        $this->actingAs($this->employee(7))->patchJson("/api/notifications/{$theirs}/read")
            ->assertOk()
            ->assertJsonPath('notification', null);

        $this->assertDatabaseHas('notifications', ['id' => $theirs, 'is_read' => false]);
    }

    private function employee(int $empId): Employee
    {
        return (new Employee())->forceFill(['emp_id' => $empId, 'email' => "emp{$empId}@example.test"]);
    }

    private function client(int $id): Client
    {
        return (new Client())->forceFill(['id' => $id]);
    }

    private function insertNotification(int $recipientId, string $recipientType, array $overrides = []): int
    {
        return DB::table('notifications')->insertGetId(array_merge([
            'recipient_id' => $recipientId,
            'recipient_type' => $recipientType,
            'title' => 'Fixture',
            'message' => 'Fixture notification',
            'data' => json_encode(['type' => 'fixture']),
            'ticket_id' => null,
            'is_read' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }
}
