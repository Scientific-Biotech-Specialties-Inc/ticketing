<?php

namespace App\Services;

use App\Models\Client;
use App\Models\Notification;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

/**
 * Read side of the in-app notification bell: listing and mark-read for the signed-in
 * client or employee. Moved here from ticket-service (TicketNotificationController).
 */
class NotificationInboxService
{
    /**
     * Resolve [recipient_id, recipient_type] for the authenticated user, or [null, null].
     * Clients are keyed by clients.id; staff (Passport User, SSO Employee or DTO) by emp_id.
     *
     * @return array{0: ?int, 1: ?string}
     */
    public function recipientFor(?Authenticatable $user): array
    {
        if (!$user) {
            return [null, null];
        }

        if ($user instanceof Client) {
            return [(int) $user->id, 'client'];
        }

        $empId = $user->emp_id ?? null;

        return $empId ? [(int) $empId, 'employee'] : [null, null];
    }

    /**
     * All notifications for the recipient, newest first.
     */
    public function list(int $recipientId, string $recipientType): Collection
    {
        return $this->visible($recipientId, $recipientType)
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->get();
    }

    public function unreadCount(int $recipientId, string $recipientType): int
    {
        return $this->visible($recipientId, $recipientType)->unread()->count();
    }

    /**
     * Mark every notification of the recipient as read.
     */
    public function markAllRead(int $recipientId, string $recipientType): int
    {
        return Notification::query()
            ->forRecipient($recipientId, $recipientType)
            ->unread()
            ->update(['is_read' => true, 'updated_at' => now()]);
    }

    /**
     * Mark one notification as read. Returns null when it does not belong to the recipient.
     */
    public function markRead(int $id, int $recipientId, string $recipientType): ?Notification
    {
        $notification = Notification::query()
            ->forRecipient($recipientId, $recipientType)
            ->find($id);

        if ($notification && !$notification->is_read) {
            $notification->is_read = true;
            $notification->save();
        }

        return $notification;
    }

    /**
     * Customers never see reassignment notifications (internal handling).
     */
    private function visible(int $recipientId, string $recipientType): Builder
    {
        return Notification::query()
            ->forRecipient($recipientId, $recipientType)
            ->when($recipientType === 'client', fn (Builder $q) => $q
                ->where('title', 'not like', '%reassign%')
                ->where('message', 'not like', '%reassign%'));
    }
}
