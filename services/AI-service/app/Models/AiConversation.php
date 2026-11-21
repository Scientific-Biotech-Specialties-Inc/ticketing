<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class AiConversation extends Model
{
    use HasFactory;

    protected $table = 'ai_conversations';
    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = [
        'id',
        'user_id',
        'title',
        'status',
        'messages',
        'escalation_data',
    ];

    protected $casts = [
        'messages' => 'array',
        'escalation_data' => 'array',
        'asset_machine_id' => 'integer',
    ];
}
