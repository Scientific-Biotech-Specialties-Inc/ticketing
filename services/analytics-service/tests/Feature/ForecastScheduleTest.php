<?php

namespace Tests\Feature;

use Illuminate\Console\Scheduling\Schedule;
use Tests\TestCase;

/**
 * Spec 0050 AC-2: analytics-service schedules the nightly forecast job, under its old name.
 */
class ForecastScheduleTest extends TestCase
{
    public function test_forecasts_run_daily_at_two_on_one_server_in_the_background(): void
    {
        $events = collect($this->app->make(Schedule::class)->events())
            ->filter(fn ($event) => str_contains((string) $event->command, 'tickets:calculate-forecasts'))
            ->values();

        $this->assertCount(1, $events);
        $event = $events->first();
        $this->assertSame('0 2 * * *', $event->expression);
        $this->assertStringContainsString('--horizon=30', (string) $event->command);
        $this->assertTrue($event->onOneServer);
        $this->assertTrue($event->runInBackground);
    }
}
