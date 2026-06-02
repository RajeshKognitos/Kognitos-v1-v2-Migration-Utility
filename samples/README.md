# Samples Folder

> Add your real (anonymized) Kognitos v1 process samples here. The parser is tested against these.

---

## Why This Matters

The parser's quality depends entirely on having a **diverse, representative test corpus**. Don't start Phase 1 (Parser) without at least 5 real samples.

---

## File Convention

Each sample is **two files**:

```
01-simple-email.txt           # The v1 process source code
01-simple-email.meta.json     # Metadata describing the sample
```

Naming: `NN-short-description.txt` where `NN` is a 2-digit sequence number.

---

## Anonymization Checklist

**Before adding ANY real process:**

- [ ] Replace real customer/company names with placeholders ("ACME Corp")
- [ ] Replace real emails with `example@example.com`
- [ ] Replace real API endpoints with `https://example.com/api/...`
- [ ] Replace real IDs, tokens, secrets with placeholder values
- [ ] Replace company-specific logic with generic equivalents
- [ ] Confirm no PII in literal values
- [ ] Confirm no production credentials in `learn from "..."` URLs

---

## Metadata File Template

For each sample, create a matching `.meta.json`:

```json
{
  "id": "01-simple-email",
  "title": "Send approval email when invoice exceeds threshold",
  "complexity": "simple",
  "constructs": ["procedure_call", "conditional", "book_usage:email"],
  "expectedFlags": [],
  "sourceContext": "from the AP team's invoice approval workflow",
  "businessIntent": "Notify approvers when invoices need review",
  "v1Books": ["email"],
  "expectedV2Integrations": ["Email"],
  "expectedManualReview": false,
  "anonymizedBy": "rahul@company.com",
  "anonymizedDate": "2026-06-02"
}
```

---

## Recommended Initial 5 Samples (for parser dev)

If you can only gather 5 to start, prioritize these for max coverage:

| # | File | What It Tests |
|---|---|---|
| 1 | `01-simple-email.txt` | Basic procedure + email Book + conditional |
| 2 | `02-invoice-loop.txt` | Loop + extract data + conditional + Outlook |
| 3 | `03-salesforce-discovery.txt` | Salesforce action calls (tests Custom Actions) |
| 4 | `04-parallel-subprocess.txt` | `start a run` (forces parallel-no-equivalent flag) |
| 5 | `05-custom-bdk.txt` | `learn from "..."` (forces re-deployment flag) |

These 5 hit the parser's most important edge cases.

---

## Optional: Sample Files Folder

If your test cases need file inputs (PDFs, CSVs, etc.):

```
samples/
├── 01-simple-email.txt
├── 01-simple-email.meta.json
├── files/
│   ├── sample-invoice.pdf
│   ├── sample-csv.csv
│   └── ...
```

Reference these files in the test plan generation.

---

## See Also

- `docs/07-sample-process-template.md` — Full guidance on gathering samples
- `docs/05-parser-spec.md` — What the parser will do with these
- `docs/04-migration-rules-and-edge-cases.md` — Flags to expect
