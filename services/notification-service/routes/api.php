<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
|
| Here is where you can register API routes for your application. These
| routes are loaded by the RouteServiceProvider and all of them will
| be assigned to the "api" middleware group. Make something great!
|
*/

Route::middleware('auth:api')->get('/user', function (Request $request) {
    return $request->user();
});

use App\Http\Controllers\NotificationController;
use App\Http\Controllers\SystemAlertController;

// In-app notification bell (moved from ticket-service). Clients use their Passport token,
// staff their central SSO token; AuthenticateSubsystem accepts either.
Route::middleware('auth.subsystem')->group(function () {
    Route::get('/notifications', [NotificationController::class, 'index']);
    Route::patch('/notifications/read-all', [NotificationController::class, 'markAllRead']);
    Route::patch('/notifications/{id}/read', [NotificationController::class, 'markRead'])->whereNumber('id');
});

Route::post('/internal/system-alerts', [SystemAlertController::class, 'receiveAlert']);
Route::post('/system-alerts', [SystemAlertController::class, 'receiveAlert']);
Route::post('/security-alerts', [SystemAlertController::class, 'receiveAlert']);
