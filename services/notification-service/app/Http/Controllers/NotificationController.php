<?php

namespace App\Http\Controllers;

use App\Services\NotificationInboxService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * In-app notification bell API (GET list, mark all read, mark one read).
 * Response shapes match the former ticket-service endpoints so the frontend did not change.
 */
class NotificationController extends Controller
{
    public function __construct(private readonly NotificationInboxService $inbox)
    {
    }

    public function index(Request $request): JsonResponse
    {
        [$recipientId, $recipientType] = $this->inbox->recipientFor($request->user());
        if (!$recipientId) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        return response()->json([
            'notifications' => $this->inbox->list($recipientId, $recipientType),
            'unread_count' => $this->inbox->unreadCount($recipientId, $recipientType),
        ]);
    }

    public function markAllRead(Request $request): JsonResponse
    {
        [$recipientId, $recipientType] = $this->inbox->recipientFor($request->user());
        if (!$recipientId) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        $this->inbox->markAllRead($recipientId, $recipientType);

        return response()->json([
            'message' => 'All notifications marked as read.',
            'unread_count' => 0,
        ]);
    }

    public function markRead(Request $request, int $id): JsonResponse
    {
        [$recipientId, $recipientType] = $this->inbox->recipientFor($request->user());
        if (!$recipientId) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        $notification = $this->inbox->markRead($id, $recipientId, $recipientType);

        return response()->json([
            'message' => 'Notification marked as read.',
            'notification' => $notification,
            'unread_count' => $this->inbox->unreadCount($recipientId, $recipientType),
        ]);
    }
}
