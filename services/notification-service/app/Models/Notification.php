<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * In-app notification (the bell). notification-service owns this table's schema and its
 * read API. Other services still insert rows directly into the shared table; see
 * docs/database-cleanup-plan.md (Notifications).
 */
class Notification extends Model
{
    protected $table = 'notifications';

    /**
     * `type` is a stored generated column (from data->type), so it is never written.
     */
    protected $guarded = ['id', 'type'];

    protected $casts = [
        'is_read' => 'boolean',
        'recipient_id' => 'integer',
        'ticket_id' => 'integer',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    public function scopeForRecipient(Builder $query, int $recipientId, string $recipientType): Builder
    {
        return $query->where('recipient_id', $recipientId)->where('recipient_type', $recipientType);
    }

    public function scopeUnread(Builder $query): Builder
    {
        return $query->where('is_read', false);
    }
}
