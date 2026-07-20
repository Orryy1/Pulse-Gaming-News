# Commercial Evidence Ledger

The weekly commercial scorecard can allocate local primary evidence to published
stories without calling external APIs or mutating the production database.

## Command

```powershell
npm run ops:commercial-scorecard -- `
  --allocation-input C:\evidence\commercial-ledger.json `
  --published-snapshot output\published-commercial-reconciliation\published_commercial_reconciliation.json `
  --evidence-root C:\evidence `
  --out-dir output\commercial-scorecard `
  --json
```

`--published-snapshot` accepts either a raw `platform_posts` snapshot or the
existing published-commercial-reconciliation JSON report.

## Input

```json
{
  "evidence_records": [
    {
      "id": "youtube-july-earnings",
      "record_type": "platform_earnings",
      "amount_status": "verified",
      "amount_gbp": 12.34,
      "evidence": [
        {
          "evidence_id": "youtube-export",
          "evidence_type": "platform_earnings_statement",
          "evidence_class": "primary",
          "source_uri": "platforms/youtube-july.csv",
          "sha256": "optional-precomputed-sha256",
          "confidence": "high"
        }
      ],
      "allocations": [
        {
          "platform": "youtube",
          "external_id": "published-video-id",
          "amount_gbp": 12.34,
          "allocation_basis": "statement_line_item"
        }
      ]
    }
  ]
}
```

Supported `record_type` values:

- `platform_earnings`
- `platform_payout`
- `affiliate_approved_commission`
- `affiliate_payment`
- `sponsor_invoice`
- `sponsor_remittance`
- `provider_invoice`
- `provider_usage`
- `operator_time`

## Accounting Rules

- `amount_status: verified` requires a numeric record amount and numeric
  allocations whose total matches it exactly.
- A verified zero remains numeric `0` only when materialised primary evidence
  supports it.
- `unknown` and `not_provided` remain unavailable and never become zero.
- Every allocation must resolve to exactly one published external ID and its
  canonical story, platform and publication-week cohort.
- Every evidence path must resolve inside `--evidence-root`, be non-empty and
  match its claimed SHA-256 when one is supplied.
- A missing direct cost makes contribution margin unavailable. A missing direct
  or labour/replacement cost makes profit unavailable.
- Revenue, cost and profit are never inferred from views, RPM assumptions,
  planning targets or secondary analytics.

## Outputs

- `allocated_commercial_ledger.json`
- `commercial_evidence_allocation_report.json`
- `weekly_commercial_scorecard.json`
- `weekly_commercial_scorecard.md`
- `commercial_evidence_integrity_report.json`

The allocation report hash-binds the source ledger, publication snapshot,
materialised evidence files and derived ledger.
