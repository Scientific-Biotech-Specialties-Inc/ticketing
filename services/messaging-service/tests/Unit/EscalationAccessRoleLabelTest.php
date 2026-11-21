<?php

namespace Tests\Unit;

use App\Services\EscalationAccess;
use PHPUnit\Framework\TestCase;

/** Pure unit test: no app boot, no database. */
class EscalationAccessRoleLabelTest extends TestCase
{
    public function test_manager_label_follows_the_department(): void
    {
        $this->assertSame('Service Manager', EscalationAccess::roleLabel((object) ['department' => 'Service']));
        $this->assertSame('IT Manager', EscalationAccess::roleLabel((object) ['department' => 'it']));
        $this->assertSame('Customer Service Manager', EscalationAccess::roleLabel((object) ['department' => 'customer service']));
        $this->assertSame('Manager', EscalationAccess::roleLabel((object) ['department' => '']));
    }
}
