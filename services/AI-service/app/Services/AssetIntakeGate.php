<?php

namespace App\Services;

/**
 * The AI chat may only offer a ticket once one of the customer's own
 * equipment or software items is identified.
 *
 * Works on the final chat result, whichever path produced it (Gemini, no Knowledge Base match,
 * the safety warning), so no path can offer a ticket without an item. The one exception is the
 * "AI unavailable" fallback: it still sends the customer to the manual form, which
 * requires the item itself.
 */
class AssetIntakeGate
{
    public const MATCHED = 'matched';
    public const AMBIGUOUS = 'ambiguous';
    public const NOT_OWNED = 'not_owned';
    public const MISSING = 'missing';
    public const UNAVAILABLE = 'unavailable';

    /**
     * @param  array       $result      the chat result (content, escalate, ticket_data, asset hints)
     * @param  array|null  $assets      the customer's pickable items, or null when they could not be read
     * @param  int|null    $selectedId  an item the customer tapped (already checked to be in $assets)
     * @param  int|null    $storedId    the item identified earlier in this conversation
     * @param  array       $messages    the conversation so far; the customer's own words are matched against
     *                                  their item names and serials, so an item they already named is not asked for again
     * @return array the result with escalate, content, ticket_data, asset, asset_options and asset_status set
     */
    public function apply(array $result, ?array $assets, ?int $selectedId, ?int $storedId, array $messages = []): array
    {
        $result['asset'] = null;
        $result['asset_options'] = [];

        // AI unavailable, the item list could not be read, or it is empty (nothing to choose from).
        // The manual form enforces the item.
        if (!empty($result['ai_unavailable']) || $assets === null || $assets === []) {
            $result['asset_status'] = self::UNAVAILABLE;
            return $result;
        }

        $byId = [];
        foreach ($assets as $asset) {
            $byId[(int) $asset['machine_ID']] = $asset;
        }

        $hints = $result['asset_hints'] ?? [];
        $resolvedId = null;
        foreach ([$selectedId, $storedId, $hints['asset_id'] ?? null] as $candidate) {
            if ($candidate !== null && isset($byId[(int) $candidate])) {
                $resolvedId = (int) $candidate;
                break;
            }
        }

        // The customer usually names the item in their first message (intake step 1). Gemini does not
        // always return the id, so match their own words against their items before asking again.
        $textMatches = $resolvedId === null ? $this->matchFromMessages($messages, $byId) : [];
        if (count($textMatches) === 1) {
            $resolvedId = $textMatches[0];
        }

        if ($resolvedId !== null) {
            $asset = $byId[$resolvedId];
            $result['asset'] = $this->summary($asset);
            $result['asset_status'] = self::MATCHED;
            if (!empty($result['escalate'])) {
                $result['ticket_data'] = array_merge((array) ($result['ticket_data'] ?? []), [
                    'machine_ID' => $resolvedId,
                    'machine' => $asset['name'],
                    'machine_confidence' => 1.0,
                    'asset_type' => $asset['asset_type'],
                    'category' => $asset['asset_type'] === 'software' ? 'Software' : 'Service',
                    'category_confidence' => 1.0,
                ]);
            }
            return $result;
        }

        $candidates = array_values(array_filter(
            array_map('intval', (array) ($hints['asset_candidates'] ?? [])),
            fn ($id) => isset($byId[$id])
        ));
        if (count($candidates) <= 1 && count($textMatches) > 1) {
            $candidates = $textMatches;
        }
        $mentioned = trim((string) ($hints['asset_mentioned'] ?? ''));

        if (count($candidates) > 1) {
            $status = self::AMBIGUOUS;
            $options = array_map(fn ($id) => $this->summary($byId[$id]), $candidates);
            $prompt = 'I found more than one of your items that could match. Which one is this about? Choose it below.';
        } elseif ($mentioned !== '') {
            $status = self::NOT_OWNED;
            $options = array_map(fn ($a) => $this->summary($a), array_values($byId));
            $prompt = "\"{$mentioned}\" is not registered to your account. Please choose one of your equipment or software below. "
                . 'If it is missing from the list, please contact Customer Service so they can register it.';
        } else {
            $status = self::MISSING;
            $options = array_map(fn ($a) => $this->summary($a), array_values($byId));
            $prompt = 'Before I create a ticket, which of your equipment or software is this about? Choose one below.';
        }

        $result['asset_status'] = $status;

        // Ask for the item whenever a ticket was about to be offered, or the customer named an item
        // that is not theirs, even mid troubleshooting.
        if (!empty($result['escalate']) || $status === self::NOT_OWNED || $status === self::AMBIGUOUS) {
            $result['escalate'] = false;
            $result['asset_options'] = $options;
            $result['content'] = trim(((string) ($result['content'] ?? '')) . "\n\n" . $prompt);
        }

        return $result;
    }

    /**
     * The one item already known for this chat, before Gemini is called: tapped, remembered from
     * an earlier turn, or named by the customer. Null when none (or more than one) fits.
     */
    public function identify(?array $assets, ?int $selectedId, ?int $storedId, array $messages): ?array
    {
        if (empty($assets)) {
            return null;
        }
        $byId = [];
        foreach ($assets as $asset) {
            $byId[(int) $asset['machine_ID']] = $asset;
        }
        foreach ([$selectedId, $storedId] as $candidate) {
            if ($candidate !== null && isset($byId[$candidate])) {
                return $byId[$candidate];
            }
        }
        $matches = $this->matchFromMessages($messages, $byId);

        return count($matches) === 1 ? $byId[$matches[0]] : null;
    }

    /**
     * Ids of the customer's items named in their own messages: by full name, name without its
     * parenthetical, the parenthetical acronym (e.g. "LIS"), serial number, or a model number
     * such as "5390" / "BC-5390".
     *
     * @param  array  $messages  chat messages ({role, content})
     * @param  array  $byId      the customer's items keyed by machine_ID
     * @return int[]
     */
    private function matchFromMessages(array $messages, array $byId): array
    {
        $userText = '';
        foreach ($messages as $msg) {
            if (($msg['role'] ?? '') === 'user' && is_string($msg['content'] ?? null)) {
                $userText .= ' ' . $msg['content'];
            }
        }
        $text = ' ' . $this->normalize($userText) . ' ';
        if (trim($text) === '') {
            return [];
        }
        $compact = str_replace(' ', '', $text);

        $matches = [];
        foreach ($byId as $id => $asset) {
            $name = (string) ($asset['name'] ?? '');
            $words = [$this->normalize($name), $this->normalize(preg_replace('/\([^)]*\)/', '', $name))];
            if (preg_match('/\(([^)]+)\)/', $name, $m)) {
                $words[] = $this->normalize($m[1]);
            }
            if (!empty($asset['serial_number'])) {
                $words[] = $this->normalize((string) $asset['serial_number']);
            }

            $tokens = explode(' ', $this->normalize($name));
            $compactKeys = [];
            foreach ($tokens as $i => $token) {
                // Model numbers carry a digit; short ones like "2" are too generic to trust.
                if (preg_match('/\d/', $token) && strlen($token) >= 3) {
                    $words[] = $token;
                    if ($i > 0) {
                        $compactKeys[] = $tokens[$i - 1] . $token; // "bc5390" typed without the hyphen
                    }
                }
            }

            $hit = false;
            foreach (array_filter($words, fn ($w) => strlen($w) >= 2) as $word) {
                if (str_contains($text, ' ' . $word . ' ')) {
                    $hit = true;
                    break;
                }
            }
            if (!$hit) {
                foreach ($compactKeys as $key) {
                    if (str_contains($compact, $key)) {
                        $hit = true;
                        break;
                    }
                }
            }
            if ($hit) {
                $matches[] = (int) $id;
            }
        }

        return $matches;
    }

    private function normalize(string $value): string
    {
        return trim(preg_replace('/\s+/', ' ', preg_replace('/[^a-z0-9]+/', ' ', strtolower($value))));
    }

    private function summary(array $asset): array
    {
        return [
            'machine_ID' => (int) $asset['machine_ID'],
            'name' => (string) $asset['name'],
            'asset_type' => (string) ($asset['asset_type'] ?? 'equipment'),
            'label' => (string) ($asset['label'] ?? $asset['name']),
        ];
    }
}
