# Sample Test Data & HAR Bundle Guide

> Guide for gathering test data. The parser AND HAR extractor quality depend entirely on having a diverse, representative test corpus.

---

## Goal

Collect:
1. **Real HAR captures** from v1 Kognitos agents (primary test data)
2. **Individual `.txt` process samples** (for parser-only testing)
3. **Expected outputs** (golden IRs, SOPs, test plans)

These become regression test fixtures for the entire pipeline.

---

## Folder Layout

```
samples/
├── agent-bundles/                # Sanitized HAR files (Tier 1 input)
│   ├── 01-vendor-helpdesk.har    # Real anonymized HAR
│   ├── 01-vendor-helpdesk.meta.json
│   ├── 02-invoice-approval.har
│   └── 02-invoice-approval.meta.json
├── extracted/                    # Expected outputs from HAR extractor
│   ├── 01-vendor-helpdesk.extracted.json   # ExtractedAgentBundle
│   └── 02-invoice-approval.extracted.json
├── processes/                    # Individual .txt (Tier 2 / parser unit tests)
│   ├── 01-simple-email.txt
│   ├── 01-simple-email.meta.json
│   └── ...
├── irs/                          # Expected IR JSON per process
│   ├── 01-simple-email.ir.json
│   └── ...
└── sops/                         # Golden SOP outputs
    ├── 01-simple-email.sop.md
    └── 01-simple-email.testplan.json
```

---

## Capturing a HAR Bundle (Tier 1)

The verified-working capture flow:

1. **Open Chrome** (other browsers may work but Chrome is most reliable)
2. **Open v1 Kognitos UI** to your target agent
3. **Open DevTools** (F12) → **Network** tab
4. Check ☑ **Preserve log** and ☑ **Disable cache**
5. Click 🔴 record button if not active
6. **Click into every process** in the agent — wait for each editor to fully load
   - Don't just hover over them in the list — you must open them
   - Subprocess children also need to be opened individually
7. Right-click in Network tab → **Save all as HAR with content**
8. Anonymize before adding to samples (see below)
9. Save as `samples/agent-bundles/NN-name.har`

### What a successful HAR contains
After running the extractor, you should see:
- N procedures with full text (N = number of processes you opened)
- All subprocess refs resolvable (no `MISSING_SUBPROCESS_IN_HAR` warnings)
- Books detected via naive heuristic

---

## Anonymization Checklist

**Before adding ANY real HAR or process:**

- [ ] **Auth headers stripped from HAR** (the sanitizer does this — verify before storing)
- [ ] Replace real customer/company names → "ACME Corp"
- [ ] Replace real emails → `example@example.com`
- [ ] Replace real API endpoints → `https://example.com/api/...`
- [ ] Replace real IDs/tokens/secrets → placeholder values
- [ ] Replace company-specific logic → generic equivalents
- [ ] Confirm no PII in literal values
- [ ] Confirm no production credentials in `learn from "..."` URLs
- [ ] For HAR: confirm no auth headers survived sanitization

### Quick HAR sanity check before committing
```bash
# Should return zero auth headers in any saved HAR
grep -i 'authorization\|x-api-key\|cookie' samples/agent-bundles/*.har | head -5
```

---

## Coverage Matrix

Aim for at least one sample (HAR or `.txt`) covering each row:

| Complexity | Construct | Why It Matters |
|---|---|---|
| Simple | Single procedure, sequential steps, no books | Baseline parser correctness |
| Simple | Single procedure with one Book usage (e.g., Email) | Book detection + mapping |
| Medium | Conditionals (if/then/else, nested) | Branch parsing |
| Medium | Loops (`process each X as follows`) | Indented block parsing |
| Medium | Data definitions + references (`the above`) | Reference resolution |
| Medium | Multiple Books in one process | Mapping accuracy |
| Complex | Subprocess calls (`run` + return value) | Subprocess capture |
| Complex | Parallel subprocess (`start a run` + `wait for the runs`) | Tests MR-19 (no v2 equivalent) |
| Complex | Custom BDK book usage (`learn from "..."`) | Tests MR-12 |
| Complex | `ask` with `the choices are` | Exception parsing |
| Complex | `get` vs `find` distinction | Tests MR-2 |
| Complex | SAP / NetSuite / Salesforce action calls | Tests Custom Actions handling |
| Complex | Scheduled trigger + required inputs | Tests MR-15 (must be redesigned) |
| Edge case | Mixed tabs/spaces indentation | Tokenizer robustness |
| Edge case | Comments scattered throughout | Comment stripping |
| Edge case | Multi-process HAR (parent + children) | Call graph reconstruction |
| Edge case | Recursive process call | Tests MR-37 + cycle detection |
| HAR-specific | Inline `@{...}` subprocess refs | Tests MR-43 + procedure ID extraction |
| HAR-specific | Partial HAR (some processes not opened) | Tests MR-45 |

---

## HAR Bundle Metadata Template

For each HAR sample, create a `.meta.json`:

```json
{
  "id": "01-vendor-helpdesk",
  "title": "Vendor query helpdesk multi-process workflow",
  "department_id": "a0jbrrmjasqluvr2qlnh0dsnw",
  "complexity": "complex",
  "process_count": 7,
  "constructs_covered": [
    "subprocess_invoke",
    "subprocess_run",
    "loop",
    "conditional",
    "extract_data",
    "ask_koncierge"
  ],
  "books_used": ["servicenow", "email", "idp", "base64"],
  "expected_flags": [
    "GET_SEMANTIC_PAUSE",
    "CUSTOM_ACTIONS_REQUIRED"
  ],
  "anonymized_by": "rahul@company.com",
  "anonymized_date": "2026-06-02",
  "source_context": "FDE captured from production vendor helpdesk agent",
  "business_intent": "Auto-process vendor inquiry emails via ServiceNow ticketing"
}
```

---

## Process-Only Metadata Template

For individual `.txt` samples:

```json
{
  "id": "01-simple-email",
  "title": "Send approval email when invoice exceeds threshold",
  "complexity": "simple",
  "constructs": ["procedure_call", "conditional", "book_usage:email"],
  "expected_flags": [],
  "source_context": "from the AP team's invoice approval workflow",
  "business_intent": "Notify approvers when invoices need review",
  "v1_books": ["email"],
  "expected_v2_integrations": ["Email"],
  "expected_manual_review": false,
  "anonymized_by": "rahul@company.com",
  "anonymized_date": "2026-06-02"
}
```

---

## Initial Recommended Samples (to start parser dev)

**Best case: One real HAR**
1. `samples/agent-bundles/01-vendor-helpdesk.har` — 7 processes, full call graph, multiple books → exercises HAR extractor + parser + mapping in one shot

**If only adding processes individually:**
1. `01-simple-email.txt` — basic procedure + email Book + conditional
2. `02-invoice-loop.txt` — loop + extract data + conditional + Outlook
3. `03-salesforce-discovery.txt` — Salesforce action calls (tests Custom Actions)
4. `04-parallel-subprocess.txt` — `start a run` (forces parallel-no-equivalent flag)
5. `05-custom-bdk.txt` — `learn from "..."` (forces re-deployment flag)

---

## Validating Samples After Pipeline

Once each phase is built, every sample should produce:

| Phase | Expected output |
|---|---|
| 0.5 — HAR Extract | ExtractedAgentBundle in `samples/extracted/` |
| 1 — Parser | V1ProcessIR in `samples/irs/` (one per process) |
| 2 — Mapping | Enriched IR with all books mapped or flagged |
| 3 — SOP Gen | SOP markdown + TestPlan JSON in `samples/sops/` |
| 5 — Agent | (manual test against test workspace) |

Run the full sample suite as a regression test on every change.
