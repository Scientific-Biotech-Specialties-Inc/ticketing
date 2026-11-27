<?php

namespace Tests\Feature;

use Tests\Concerns\ComparesParityGolden;
use Tests\RefreshReportingDatabase;
use Tests\TestCase;

/**
 * GET /insights/predictive returns the same JSON ticket-service's
 * /admin-reports/predictive-insights returned, for the same seed, frozen time and actors.
 */
class PredictiveInsightsParityTest extends TestCase
{
    use RefreshReportingDatabase;
    use ComparesParityGolden;

    protected function setUp(): void
    {
        parent::setUp();
        $this->loadParityFixture();
    }

    /** Recalculated from the parity seed's 7 days of history: the insufficient_data shape. */
    public function test_recalculated_insights_match_the_ticket_service_golden(): void
    {
        foreach (['superadmin', 'admin'] as $actor) {
            $this->assertMatchesJsonGolden(
                "predictive-insights.{$actor}",
                $this->actingAs($this->parityActor($actor))->getJson('/api/insights/predictive?force_refresh=true')
            );
        }
    }

    /** Served from stored forecast rows and trends: the success shape, trend casts and ordering included. */
    public function test_stored_insights_match_the_ticket_service_golden(): void
    {
        $this->loadReportingSql('fixtures/forecast_seed.sql');

        foreach (['superadmin', 'admin'] as $actor) {
            $this->assertMatchesJsonGolden(
                "predictive-insights-stored.{$actor}",
                $this->actingAs($this->parityActor($actor))->getJson('/api/insights/predictive?horizon_days=7')
            );
        }
    }
}
