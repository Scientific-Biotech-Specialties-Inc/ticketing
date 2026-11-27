<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::disableForeignKeyConstraints();
        Schema::create('machines', function (Blueprint $table) {
            $table->bigIncrements('machine_ID');
            $table->foreignId('category_ID')->constrained('machine_categories', 'category_ID');
            $table->foreignId('client_ID')->constrained('clients', 'id')->cascadeOnDelete();
            $table->string('machine_name');
            $table->string('serial_number')->unique();
            $table->string('model')->nullable();
            $table->string('brand')->nullable();
            $table->string('status')->nullable();
            $table->dateTime('purchase_date')->nullable();
            $table->dateTime('last_maintenance_date')->nullable();
            $table->timestamps();
        });
        Schema::enableForeignKeyConstraints();
    }

    public function down(): void
    {
        Schema::dropIfExists('machines');
    }
};