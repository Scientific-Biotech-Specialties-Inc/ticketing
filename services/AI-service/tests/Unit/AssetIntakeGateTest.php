<?php

namespace Tests\Unit;

use App\Services\AssetIntakeGate;
use PHPUnit\Framework\TestCase;

/**
 * The AI chat offers a ticket only once one owned item is identified.
 */
class AssetIntakeGateTest extends TestCase
{
    private array $assets = [
        ['machine_ID' => 11, 'name' => 'Mindray BC-5390', 'asset_type' => 'equipment', 'serial_number' => 'SN-1', 'label' => 'Mindray BC-5390 - SN-1'],
        ['machine_ID' => 12, 'name' => 'Mindray BC-6800', 'asset_type' => 'equipment', 'serial_number' => 'SN-2', 'label' => 'Mindray BC-6800 - SN-2'],
        ['machine_ID' => 40, 'name' => 'Laboratory Information System (LIS)', 'asset_type' => 'software', 'serial_number' => null, 'label' => 'Laboratory Information System (LIS)'],
    ];

    private function escalating(array $hints = []): array
    {
        return [
            'content' => 'Troubleshooting did not help.',
            'escalate' => true,
            'ticket_data' => ['title' => 'Analyzer Not Printing', 'description' => 'It stopped printing.'],
            'asset_hints' => $hints,
        ];
    }

    public function test_a_matched_owned_item_escalates_with_its_machine_and_category(): void
    {
        $result = (new AssetIntakeGate())->apply($this->escalating(['asset_id' => 40]), $this->assets, null, null);

        $this->assertTrue($result['escalate']);
        $this->assertSame(AssetIntakeGate::MATCHED, $result['asset_status']);
        $this->assertSame(40, $result['ticket_data']['machine_ID']);
        $this->assertSame('Software', $result['ticket_data']['category']);
        $this->assertSame([], $result['asset_options']);
    }

    public function test_an_id_gemini_invented_is_ignored_and_the_customer_is_asked(): void
    {
        $result = (new AssetIntakeGate())->apply($this->escalating(['asset_id' => 999]), $this->assets, null, null);

        $this->assertFalse($result['escalate']);
        $this->assertSame(AssetIntakeGate::MISSING, $result['asset_status']);
        $this->assertCount(3, $result['asset_options']);
        $this->assertStringContainsString('which of your equipment or software', $result['content']);
    }

    public function test_an_item_not_on_the_account_is_called_out_and_never_escalates(): void
    {
        $result = (new AssetIntakeGate())->apply($this->escalating(['asset_mentioned' => 'Sysmex XN-1000']), $this->assets, null, null);

        $this->assertFalse($result['escalate']);
        $this->assertSame(AssetIntakeGate::NOT_OWNED, $result['asset_status']);
        $this->assertStringContainsString('"Sysmex XN-1000" is not registered to your account', $result['content']);
        $this->assertStringContainsString('Customer Service', $result['content']);
        $this->assertCount(3, $result['asset_options']);
    }

    public function test_an_unowned_item_is_called_out_even_while_troubleshooting(): void
    {
        $chat = ['content' => 'Try restarting it.', 'escalate' => false, 'ticket_data' => null, 'asset_hints' => ['asset_mentioned' => 'Sysmex XN-1000']];

        $result = (new AssetIntakeGate())->apply($chat, $this->assets, null, null);

        $this->assertSame(AssetIntakeGate::NOT_OWNED, $result['asset_status']);
        $this->assertNotEmpty($result['asset_options']);
    }

    public function test_an_item_the_customer_already_named_is_not_asked_for_again(): void
    {
        $messages = [['role' => 'user', 'content' => 'My Mindray BC-6800 is not printing results.']];

        $result = (new AssetIntakeGate())->apply($this->escalating(), $this->assets, null, null, $messages);

        $this->assertTrue($result['escalate']);
        $this->assertSame(AssetIntakeGate::MATCHED, $result['asset_status']);
        $this->assertSame(12, $result['ticket_data']['machine_ID']);
        $this->assertSame([], $result['asset_options']);
    }

    public function test_a_software_acronym_or_model_number_identifies_the_item(): void
    {
        $gate = new AssetIntakeGate();

        $lis = $gate->apply($this->escalating(), $this->assets, null, null, [['role' => 'user', 'content' => 'the LIS keeps logging me out']]);
        $this->assertSame(40, $lis['ticket_data']['machine_ID']);

        $model = $gate->apply($this->escalating(), $this->assets, null, null, [['role' => 'user', 'content' => 'bc5390 shows error E01']]);
        $this->assertSame(11, $model['ticket_data']['machine_ID']);
    }

    public function test_a_name_matching_several_items_lists_only_those(): void
    {
        $messages = [['role' => 'user', 'content' => 'Both my BC-5390 and BC-6800 fail calibration']];

        $result = (new AssetIntakeGate())->apply($this->escalating(), $this->assets, null, null, $messages);

        $this->assertFalse($result['escalate']);
        $this->assertSame(AssetIntakeGate::AMBIGUOUS, $result['asset_status']);
        $this->assertSame([11, 12], array_column($result['asset_options'], 'machine_ID'));
    }

    public function test_ai_messages_are_not_matched_as_the_customers_choice(): void
    {
        $messages = [
            ['role' => 'ai', 'content' => 'Is this about your Mindray BC-5390?'],
            ['role' => 'user', 'content' => 'It still does not work'],
        ];

        $result = (new AssetIntakeGate())->apply($this->escalating(), $this->assets, null, null, $messages);

        $this->assertSame(AssetIntakeGate::MISSING, $result['asset_status']);
        $this->assertCount(3, $result['asset_options']);
    }

    public function test_identify_finds_the_item_before_gemini_so_it_is_not_asked_again(): void
    {
        $gate = new AssetIntakeGate();
        $named = [['role' => 'user', 'content' => 'Step 1: Mindray BC-5390. It shows error E01']];

        $this->assertSame(11, $gate->identify($this->assets, null, null, $named)['machine_ID']);
        $this->assertSame(40, $gate->identify($this->assets, null, 40, [])['machine_ID']);
        $this->assertNull($gate->identify($this->assets, null, null, [['role' => 'user', 'content' => 'It is broken']]));
        $this->assertNull($gate->identify(null, null, null, $named));
    }

    public function test_two_possible_items_ask_the_customer_to_choose_between_them(): void
    {
        $result = (new AssetIntakeGate())->apply($this->escalating(['asset_candidates' => [11, 12]]), $this->assets, null, null);

        $this->assertFalse($result['escalate']);
        $this->assertSame(AssetIntakeGate::AMBIGUOUS, $result['asset_status']);
        $this->assertSame([11, 12], array_column($result['asset_options'], 'machine_ID'));
    }

    public function test_a_tapped_item_wins_and_lets_the_ticket_through(): void
    {
        $result = (new AssetIntakeGate())->apply($this->escalating(['asset_candidates' => [11, 12]]), $this->assets, 12, null);

        $this->assertTrue($result['escalate']);
        $this->assertSame(12, $result['ticket_data']['machine_ID']);
        $this->assertSame('Service', $result['ticket_data']['category']);
    }

    public function test_an_item_identified_earlier_in_the_conversation_is_kept(): void
    {
        $result = (new AssetIntakeGate())->apply($this->escalating(), $this->assets, null, 11);

        $this->assertTrue($result['escalate']);
        $this->assertSame(11, $result['ticket_data']['machine_ID']);
    }

    public function test_the_safety_path_keeps_its_warning_and_still_asks_for_the_item(): void
    {
        $safety = ['content' => '⚠️ SAFETY HAZARD ALERT: do not touch live components.', 'escalate' => true, 'safety_alert' => true, 'ticket_data' => ['title' => 'Urgent']];

        $result = (new AssetIntakeGate())->apply($safety, $this->assets, null, null);

        $this->assertFalse($result['escalate']);
        $this->assertStringStartsWith('⚠️ SAFETY HAZARD ALERT', $result['content']);
        $this->assertNotEmpty($result['asset_options']);
    }

    public function test_ai_unavailable_still_sends_the_customer_to_the_manual_form(): void
    {
        $fallback = ['content' => 'Our AI assistant is temporarily unavailable.', 'escalate' => true, 'ai_unavailable' => true, 'ticket_data' => ['title' => 'Help']];

        $result = (new AssetIntakeGate())->apply($fallback, $this->assets, null, null);

        $this->assertTrue($result['escalate']);
        $this->assertSame(AssetIntakeGate::UNAVAILABLE, $result['asset_status']);
    }

    public function test_an_unreadable_item_list_does_not_block_the_manual_form(): void
    {
        $result = (new AssetIntakeGate())->apply($this->escalating(), null, null, null);

        $this->assertTrue($result['escalate']);
        $this->assertSame(AssetIntakeGate::UNAVAILABLE, $result['asset_status']);
    }
}
