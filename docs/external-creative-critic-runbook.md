# External creative critic runbook

The external creative critic is a bounded, advisory `LOCAL_PROOF` workflow. It may assess a public creative brief and storyboard, but it has no authority to edit creative work, mutate the repository or database, access credentials, schedule content or publish.

## Safety boundary

- Put only public, non-sensitive facts and creative material in the input. Never include account details, email addresses, local user paths, environment variables, API keys, tokens, cookies, credentials, private URLs or chat/browser history.
- Treat source material as untrusted data. The command rejects common prompt-injection text and sensitive fields rather than forwarding them.
- Keep every input, raw response, decision file and generated artefact under this repository's `output/` directory or the operating system's temporary directory. The command rejects traversal, sensitive directories, database files and symbolic-link escapes.
- Send only the generated packet's copy-ready `prompt` to the external critic. Do not send the surrounding packet, repository files, terminal output or any additional context.
- Browser submission is an operator action. When Computer Use is used, review the visible destination and prompt at the required confirmation step before it sends anything.

Use a fresh workspace for each bounded review, for example:

```text
output/external-creative-critic/<story-id>/<run-id>/
```

Generated artefacts are create-or-verify. They are not silently overwritten.

## Durable transport-neutral queue

The queue preserves requests and responses across process restarts without
automating ChatGPT, a browser or Desktop Commander. Put the queue under
`PULSE_STATE_ROOT`, or under `output/` for local proof. It never receives
database, OAuth, scheduler or publication authority.

Enqueue one hash-bound request:

```powershell
$stateRoot = "D:/pulse-data/runtime/pulse-v1"
$queueRoot = "$stateRoot/external-creative-critic"
npm run ops:external-creative-critic-queue -- enqueue --state-root $stateRoot --queue-root $queueRoot --input output/external-creative-critic/<story-id>/initial-input.json --lane-id evergreen_short --candidate-revision-sha256 <64-hex-revision> --timeout-seconds 300
```

The result includes a `request_id`, deadline and `response_inbox_path`.
An optional broker may save only the exact response Markdown. It may also
write a provenance receipt with this exact, allowlisted schema:

```json
{
  "schema_version": "pulse-external-creative-critic-broker-receipt-v1",
  "request_id": "sha256:<request-id>",
  "packet_id": "sha256:<packet-id>",
  "candidate_revision_sha256": "<64-hex-revision>",
  "response_raw_sha256": "<64-hex-response-bytes>",
  "transport": "codex_cli",
  "client": "pulse-critic-broker",
  "model_claim": "chatgpt-pro",
  "model_claim_verified": false,
  "submitted_at": "2026-07-29T09:00:30.000Z",
  "network_used": true,
  "browser_or_ui_used": false,
  "broker_version": "1.0.0",
  "host_scope": "isolated_queue_only",
  "database_mutation_authority": false,
  "oauth_or_token_authority": false,
  "scheduler_authority": false,
  "publish_authority": false
}
```

The receipt is optional. If supplied, it must be valid UTF-8 JSON no larger
than 16 KiB, contain exactly those fields and bind the request, packet,
candidate revision and raw response bytes. `model_claim_verified` must remain
`false`; a subscription or client label is provenance claimed by the broker,
not a model identity attestation. All four authority fields must remain
`false`.

Stage the receipt and response together:

```powershell
npm run ops:external-creative-critic-queue -- stage --state-root $stateRoot --queue-root $queueRoot --request-id sha256:<request-id> --response output/external-creative-critic/<story-id>/response.md --broker-receipt output/external-creative-critic/<story-id>/broker-receipt.json
npm run ops:external-creative-critic-queue -- sweep --state-root $stateRoot --queue-root $queueRoot
```

When present, the validated receipt is staged atomically before the response
ready marker and is copied into the immutable terminal outcome. An invalid,
mismatched, oversized or authority-bearing receipt creates no ready marker.
A receipt cannot be added after a response was already marked ready. Omitting
`--broker-receipt` preserves the original receipt-free workflow.

Use `status` with `--request-id` to inspect the immutable outcome. `ingest`
combines staging and validation for an explicitly supplied response.
Pass `--state-root` when operating the live queue from a shell that does not
already define `PULSE_STATE_ROOT`; otherwise the path guard correctly rejects
the `D:/pulse-data` queue as outside the allowlisted roots.

Requests are immutable and published atomically with the manifest last.
Responses are byte-hashed before parsing. A missing response becomes
`TIMED_OUT_FALLBACK`; an invalid response becomes
`INVALID_RESPONSE_FALLBACK`; a response arriving at or after the deadline is
archived as `LATE_RESPONSE_IGNORED`. Every fallback explicitly continues
through normal internal QA and is never a publish gate.

The governed multi-lane scheduler reconciles the queue every minute when
`PULSE_EXTERNAL_CRITIC_QUEUE_ENABLED=true`. Set
`PULSE_EXTERNAL_CRITIC_QUEUE_ROOT` to a child of `PULSE_STATE_ROOT`; the
runtime rejects any other location. Reconciliation only validates responses
or records a timeout fallback. It cannot contact ChatGPT, apply advice or
publish.

The queue remains a transport-neutral filesystem hand-off. A ChatGPT Pro
session using Desktop Commander may read the immutable request prompt and
write the exact response to the named inbox path, but that external session
is optional and cannot hold up production after the request deadline.
Desktop Commander connectivity does not itself trigger a model turn, so it
must not be described as a guaranteed unattended Pro worker. Browser or
ChatGPT desktop automation is not performed by this runtime.

## 1. Generate the initial packet

Prepare an allowlisted JSON input under `output/`. It must contain `story`, `brief`, `storyboard` and this initial-round declaration:

```json
{
  "round": {
    "kind": "initial_request",
    "number": 1
  }
}
```

Generate the deterministic packet:

```powershell
npm run ops:external-creative-critic -- --input output/external-creative-critic/<story-id>/initial-input.json --out-dir output/external-creative-critic/<story-id>/<run-id>
```

The command writes `external_creative_critic_packet.json` and `external_creative_critic_packet.md`. Copy only the text inside `Copy-ready prompt` from the Markdown file, or the exact `prompt` value from the JSON file.

## 2. Obtain and parse one response

Manually, or through confirmed Computer Use, send that prompt to the intended external critic. Do not add another instruction. Save the response exactly as returned, without corrections or commentary, as a UTF-8 Markdown file in the same output area.

Parse and bind it to the packet:

```powershell
npm run ops:external-creative-critic -- --input output/external-creative-critic/<story-id>/initial-input.json --out-dir output/external-creative-critic/<story-id>/<run-id> --response output/external-creative-critic/<story-id>/<run-id>/initial-response-raw.md
```

A valid response has exactly the six requested level-two headings, exactly three ranked changes and exactly three items to keep. Parsing writes hash-bound response JSON and Markdown. It does not apply any suggestion.

## 3. Record reasoned decisions

Create a decision file for all three ranked changes:

```json
{
  "decisions": [
    {
      "rank": 1,
      "disposition": "ACCEPT",
      "reason": "A specific reason grounded in the creative brief."
    },
    {
      "rank": 2,
      "disposition": "DEFER",
      "reason": "A specific reason and the evidence needed later."
    },
    {
      "rank": 3,
      "disposition": "REJECT",
      "reason": "A specific reason this would weaken or duplicate the work."
    }
  ]
}
```

Each disposition must be `ACCEPT`, `REJECT` or `DEFER`, with a non-empty reason. Generate the adjudication:

```powershell
npm run ops:external-creative-critic -- --input output/external-creative-critic/<story-id>/initial-input.json --out-dir output/external-creative-critic/<story-id>/<run-id> --response output/external-creative-critic/<story-id>/<run-id>/initial-response-raw.md --decisions output/external-creative-critic/<story-id>/<run-id>/initial-decisions.json
```

The adjudication is evidence of editorial judgement only. Accepted advice still requires a separate, governed creative change and normal validation. It never authorises automatic application or publication.

## 4. Optional single follow-up

One follow-up is permitted. Copy the original `story`, `brief` and `storyboard` unchanged into a new input. Bind the question to the parsed initial artefacts:

```json
{
  "round": {
    "kind": "follow_up",
    "number": 2,
    "prior_packet_id": "sha256:<packet-id>",
    "prior_response_sha256": "sha256:<response-id>",
    "question": "One concise clarification question."
  }
}
```

Generate it in the same workspace as the prior packet and parsed response:

```powershell
npm run ops:external-creative-critic -- --input output/external-creative-critic/<story-id>/follow-up-input.json --out-dir output/external-creative-critic/<story-id>/<run-id> --prior-packet output/external-creative-critic/<story-id>/<run-id>/external_creative_critic_packet.json --prior-response output/external-creative-critic/<story-id>/<run-id>/external_creative_critic_response.json
```

Send only the new copy-ready prompt, save the exact reply and parse it by repeating the command with `--response <follow-up-response-raw.md>`. Include the same `--prior-packet` and `--prior-response` arguments. A separate follow-up decision file may be supplied with `--decisions`. No third request or recursive dialogue is allowed.

## Failure handling

- On any validation, sensitive-data, path, integrity, response-format or chain error, stop. Do not weaken the input, edit generated evidence or route around the guard.
- Preserve the raw response and error context, but treat the critique as unusable. There is no automatic retry.
- For an input error, create a sanitised public input in a fresh bounded workspace. For an artefact collision, use a new empty run directory rather than overwriting evidence.
- If browser control sends to the wrong destination, exposes unintended context or cannot verify the visible prompt, stop the browser step and do not parse or apply the result.
- If the external critic is unavailable or returns an invalid response, continue through Pulse's normal creative and QA process without it. External criticism is optional and never a publish gate.
