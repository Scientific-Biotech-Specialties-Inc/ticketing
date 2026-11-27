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

use App\Http\Controllers\EtlSyncController;
use App\Http\Controllers\FeedbackController;
use App\Http\Controllers\PredictiveAnalyticsController;
use App\Http\Controllers\PredictiveInsightsController;

Route::middleware('auth:api')->get('/user', function (Request $request) {
    return $request->user();
});

// Every feedback and stats route needs a verified token (auth.subsystem).
// Direct routes matching Nginx gateway rewrite: /api/ticketing/analytics/(.*) -> /api/$1
Route::middleware('auth.subsystem')->group(function () {
    Route::post('/feedback', [FeedbackController::class, 'store']);
    Route::get('/feedback/ticket/{ticketId}', [FeedbackController::class, 'getByTicket']);
    Route::put('/feedback/ticket/{ticketId}', [FeedbackController::class, 'updateByTicket']);
    Route::delete('/feedback/ticket/{ticketId}', [FeedbackController::class, 'deleteByTicket']);
    Route::get('/csat-stats', [FeedbackController::class, 'csatStats']);
    Route::get('/predictive-metrics', [PredictiveAnalyticsController::class, 'getPredictiveMetrics']);

    // Reporting moved from ticket-service. Registered once each (no alias forms).
    Route::get('/insights/predictive', [PredictiveInsightsController::class, 'show'])->middleware('no-cache');
    Route::post('/etl/sync', [EtlSyncController::class, 'sync'])->middleware('no-cache');

    // Prefix routes matching direct service /api/analytics requests
    Route::prefix('analytics')->group(function () {
        Route::post('/feedback', [FeedbackController::class, 'store']);
        Route::get('/feedback/ticket/{ticketId}', [FeedbackController::class, 'getByTicket']);
        Route::put('/feedback/ticket/{ticketId}', [FeedbackController::class, 'updateByTicket']);
        Route::delete('/feedback/ticket/{ticketId}', [FeedbackController::class, 'deleteByTicket']);
        Route::get('/csat-stats', [FeedbackController::class, 'csatStats']);
        Route::get('/predictive-metrics', [PredictiveAnalyticsController::class, 'getPredictiveMetrics']);
    });
});

