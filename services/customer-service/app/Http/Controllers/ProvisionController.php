<?php

namespace App\Http\Controllers;

use App\Models\Client;
use App\Models\ClientCredential;
use App\Models\CustomerOrganization;
use App\Mail\CustomerProvisionedMail;
use App\Services\Mail\ConfigServiceMailer;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class ProvisionController extends Controller
{
    public function provision(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'client_name'    => 'required|string|max:255',
            'email'          => 'required|email|max:255',
            // Optional: the CRMS machine sync only knows a customer's name and email.
            'address'        => 'nullable|string|max:500',
            'contact_number' => 'nullable|string|max:50',
            // Spec 3.1: the CMS equipment sync creates accounts silently (false). Default true keeps
            // every other caller's welcome email with the temporary password.
            'send_welcome_email' => 'sometimes|boolean',
            // The hospital to link the new login to. Without it the hospital is found, or created,
            // by the normalized client_name, so every caller groups logins by hospital.
            'organization_id' => 'nullable|integer|exists:customer_organizations,id',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'message' => 'Validation failed.',
                'errors'  => $validator->errors()
            ], 422);
        }

        $validated = $validator->validated();

        // Check if customer exists by email
        $client = Client::where('email', $validated['email'])->first();

        if ($client) {
            return response()->json([
                'id'      => $client->id,
                'message' => 'Customer already exists.',
                'status'  => 'exists',
                'organization_id' => $client->organization_id,
            ], 200);
        }

        // Generate a temporary password
        $temporaryPassword = Str::random(12);

        DB::beginTransaction();
        try {
            $organization = !empty($validated['organization_id'])
                ? CustomerOrganization::find($validated['organization_id'])
                : CustomerOrganization::resolveByName($validated['client_name']);

            $client = Client::create([
                // The hospital's display name, so every login of one hospital reads the same.
                'client_name'    => $organization?->name ?? $validated['client_name'],
                'organization_id' => $organization?->id,
                'email'          => $validated['email'],
                'address'        => $validated['address'] ?? '',
                'contact_number' => $validated['contact_number'] ?? '',
                'status'         => true,
            ]);

            ClientCredential::create([
                'client_id'          => $client->id,
                'password_hash'      => Hash::make($temporaryPassword),
                'failed_login_count' => 0,
                'locked_until'       => null,
                'last_login_at'      => null,
                'password_change_at' => now(), // OTP first-login flow is disabled; stamp it immediately
            ]);

            DB::commit();
        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Customer provisioning failed: ' . $e->getMessage());
            return response()->json([
                'message' => 'Failed to provision customer account.',
                'error'   => $e->getMessage()
            ], 500);
        }

        // Spec 3.1: no welcome email when the caller opts out. The customer gets in later through
        // Forgot Password (an OTP to their own email), which replaces the unsent temporary password.
        if (!filter_var($validated['send_welcome_email'] ?? true, FILTER_VALIDATE_BOOLEAN)) {
            Log::info('Customer provisioned without a welcome email', ['client_id' => $client->id]);

            return response()->json([
                'id'      => $client->id,
                'message' => 'Customer provisioned successfully.',
                'status'  => 'created',
                'welcome_email_sent' => false,
                'organization_id' => $client->organization_id,
            ], 201);
        }

        // Send Email notification
        try {
            // Spec 0040: configuration-service (Brevo API) first, Brevo SMTP relay as backup.
            app(ConfigServiceMailer::class)->send(
                $client->email,
                new CustomerProvisionedMail($client, $temporaryPassword),
                null,
                ConfigServiceMailer::CATEGORY_SECURITY
            );
        } catch (\Throwable $e) {
            Log::error('Failed to send provision email: ' . $e->getMessage());
        }

        return response()->json([
            'id'      => $client->id,
            'message' => 'Customer provisioned successfully.',
            'status'  => 'created',
            'organization_id' => $client->organization_id,
        ], 201);
    }
}
