# Analyzer Spec — Kognitos v1 Source → IR (LLM-based)

> The source of truth for **Phase 1 (Process Analyzer)**. The analyzer replaces the hand-written parser (see deprecated `05-parser-spec.md`). It converts one v1 process source into a validated `V1ProcessIR` using an LLM with JSON mode + Zod validation.
>
> **Implementation:** `src/lib/analyzer/`
> **Output schema (canonical):** `src/types/ir.ts`

---

## 1. Overview

The analyzer is an LLM-backed static analyzer. Given the raw text of one v1 process (plus minimal call-graph context), it emits a single JSON object conforming to `V1ProcessIR`. There is no tokenizer, grammar, or recursive-descent parser — the model does the structural analysis, and we enforce correctness with a runtime schema.

### Architecture

```
ExtractedProcess.text  ┐
CallGraphContext       ┘
        │
        ▼
  buildSystemPrompt() + buildUserPrompt()   (prompt.ts)
        │
        ▼
  OpenAI Chat Completions (JSON mode)        (client.ts)
        │
        ▼
  extractJson → JSON.parse → Zod validate    (schema.ts)
        │
   ┌────┴────┐
   │ valid?  │── no ──► ONE corrective retry (feeds Zod error back)
   └────┬────┘                     │
        │ yes                      ▼ still invalid → AnalyzerError
        ▼
  stampMetadata() (deterministic provenance)
        │
        ▼
     V1ProcessIR
```

The four pillars:

1. **OpenAI** — `gpt-4o` in JSON mode (`response_format: { type: 'json_object' }`), low temperature for determinism. The analyzer is provider-agnostic in spirit: any model with reliable JSON output and a large enough output budget can be dropped in.
2. **Zod** — the IR Zod schema (`schema.ts`) is the runtime gatekeeper. The model's JSON is rejected unless it matches the discriminated-union structure of `V1ProcessIR`.
3. **Retry** — exactly one corrective retry on validation failure (see §5).
4. **Deterministic metadata stamping** — provenance fields are overwritten by code, never trusted from the model (see §6).

---

## 2. Input

```typescript
analyzeProcess(source: string, context: CallGraphContext): Promise<V1ProcessIR>
```

- **`source`** — `ExtractedProcess.text`: the raw v1 process source for ONE process (the HAR extractor produces one of these per process). Also accepts pasted/uploaded text from the Tier-2 fallback.
- **`context`** — `CallGraphContext`, the minimal bundle context the model needs to resolve HAR `@{…}` subprocess refs to sibling processes:

```typescript
interface CallGraphContext {
  siblingProcedures: { name: string; procedureId: string }[];
  bundleSize: number;
  thisProcessName: string;
}
```

The user prompt lists sibling procedures so the model can match a ref's `value` → a known `procedureId` and its `display` → the sibling name. Resolution against the bundle (setting `resolvableInBundle`) happens downstream — the analyzer just preserves `procedureId` (MR-43).

---

## 3. Output

The analyzer returns `V1ProcessIR` exactly as defined in **`src/types/ir.ts`** — that file remains the canonical schema and is reused verbatim (the Zod schema in `schema.ts` is kept structurally identical via `z.infer` typing so drift is caught at compile time).

Key IR shape (see `ir.ts` for full docs):

- `metadata` — provenance (`rawSource`, `sourceLineCount`, `parsedAt`, `parserVersion`); **stamped by code, not the model**.
- `procedures[]` — every `to …`/`… is`/`… are` procedure, each with `inputs`, `statements`, `triggers`, line spans, and procedure-scoped `flags`.
- `statements[]` — the discriminated union (`data_definition`, `assignment`, `procedure_call`, `conditional`, `loop`, `subprocess_call`, `book_usage`, `exception`, `control`).
- `flags[]` — file-level migration flags.

The analyzer does **not** populate `v2Mapping` or `resolvableInBundle` — those are filled downstream (the book→integration mapping is folded into the analyzer's prompt context for awareness, but enrichment of `bookUsages[].v2Mapping` and bundle resolution remain post-analyzer concerns).

---

## 4. Prompt Design Principles

The prompt lives in `prompt.ts` and is built from `buildSystemPrompt()` (role + contract + rules) and `buildUserPrompt(source, context)` (the source + bundle context).

1. **Schema inline.** The full IR is embedded in the system prompt as TypeScript (kept in sync with `ir.ts` / `schema.ts`). The model emits JSON to match it exactly: every statement carries the base fields (`line`, `col`, `indent`, `rawText`) and a `kind` discriminator; optional fields are omitted rather than set to `null`.
2. **JSON mode.** `response_format: { type: 'json_object' }` forces syntactically valid JSON. A defensive `extractJson()` still strips stray code fences before parsing.
3. **Completeness over brevity.** The prompt insists on a faithful, fully-expanded structural parse — never a summary. Nesting is preserved exactly (then/else/body), and the model is told to re-scan bottom-up to confirm every `run @{…}`/`invoke @{…}`/`start a run`/`ask koncierge` has a node. This is the single most important behavioral instruction.
4. **Migration rules captured in the prompt.** The relevant rules from `04-migration-rules-and-edge-cases.md` are encoded directly:
   - **MR-2** (ask/get/find semantics) — `get`/`ask` pause on missing (`pausesOnMissing: true`); `find` continues (`false`). Distinct, never interchangeable.
   - **MR-19** (parallel subprocess) — `start a run … / wait for the runs` has no v2 equivalent; emit flag `PARALLEL_SUBPROCESS_NO_EQUIVALENT` (error).
   - **MR-43** (HAR refs) — a `@{…}` ref may point outside the bundle; still populate `procedureId`, never drop the call.
5. **Detection disambiguation.** The prompt hard-codes the easy-to-confuse cases: `ask koncierge` and `extract data from …` are `book_usage` (`bookName: "idp"`), NOT exceptions; only a genuine human question is `exception` type `ask`.

---

## 5. Retry Logic

**Exactly ONE corrective retry on Zod failure.**

1. First call → `extractJson` → `JSON.parse` → `V1ProcessIRSchema.safeParse`.
2. If parse or validation fails, a second call is made with the conversation continued: the original messages, the model's failed output (as an `assistant` turn), and a `user` turn quoting the Zod error message with the instruction to return only valid JSON matching the schema.
3. If the retry still fails validation, the analyzer throws `AnalyzerError` — it does **not** retry again or silently return partial IR.

This caps cost/latency at 2 LLM calls worst-case while recovering from the common "one field wrong" failure mode.

---

## 6. Metadata Stamping (Deterministic)

The model is **not trusted** for provenance — it hallucinates timestamps and line counts. After validation, `stampMetadata()` overwrites `metadata` entirely with code-computed values:

| Field | Source |
|---|---|
| `rawSource` | the exact `source` string passed in |
| `sourceLineCount` | `source.split('\n').length` |
| `parsedAt` | `new Date().toISOString()` at stamp time |
| `parserVersion` | `ANALYZER_VERSION` constant (e.g. `"1.0.0"`) |

This guarantees the IR's provenance is reproducible and audit-safe regardless of what the model returns in its `metadata` block.

---

## 7. Cost Model

At GPT-4o pricing, a typical process costs **~$0.07 per process** (single successful call). A corrective retry roughly doubles that for the affected process. Drivers:

- Input: system prompt (inline schema + rules, fixed) + the process source + bundle context.
- Output: a fully-expanded IR — long processes echo verbatim source into `rawText`/`parameters`, so output tokens dominate. A generous output budget is configured to avoid mid-array truncation.

Token usage is logged per request (`[analyzer] … token usage — input/output`) for cost tracking, which flows into the migration report.

---

## 8. Limitations

- **Depends on an LLM.** No offline/deterministic path; output can drift between model versions. Mitigated by Zod validation + integration tests on golden fixtures.
- **Requires an API key.** `OPENAI_API_KEY` must be set or the analyzer throws immediately.
- **Latency ~10s per process** (longer with a retry or for large processes). Acceptable for the current batch-oriented, human-supervised migration flow.
- **Non-deterministic at the margin.** Low temperature reduces but does not eliminate variation; the schema constrains structure, not every value.

---

## 9. When to Revisit

The LLM analyzer is the chosen approach for the current scale (tens to low-hundreds of processes per migration, human-supervised). Reconsider a deterministic parser if:

- **Scale exceeds ~1000 processes/day** — per-process cost and latency become material; a deterministic parser (the design preserved in `05-parser-spec.md`) would be cheaper and faster at that volume.
- **Output drift becomes unmanageable** — if golden-fixture tests start failing across model updates faster than they can be re-tuned.

If the analyzer proves insufficient, **surface the issue and propose iteration** (prompt tuning, model change, hybrid validation) — `05-parser-spec.md` is retained as the fallback design, but switching back to a hand-written parser is an explicit, deliberate decision, not a silent fallback.

---

## 10. Testing Requirements

- **Schema conformance.** Every analyzer output validates against `V1ProcessIRSchema` (the validation is in-band; tests assert no `AnalyzerError`).
- **Integration tests on golden fixtures.** Analyze each sample v1 process and assert the IR matches an expected snapshot (structure + key flags), tolerant of incidental value variation.
- **Metadata determinism.** Assert `metadata` is code-stamped (line count matches source, `parserVersion` equals `ANALYZER_VERSION`) regardless of model output.
- **Retry path.** Simulate an invalid first response and assert exactly one corrective retry occurs, and that a still-invalid retry throws `AnalyzerError`.
- **Detection edge cases.** Cover the MR-2 ask/get/find distinction, MR-19 parallel-subprocess flagging, MR-43 ref preservation, and `ask koncierge`/`extract data` → `book_usage` (not `exception`).

---

## 11. What the Analyzer Does NOT Do

- Does NOT execute v1 processes.
- Does NOT generate v2 SOPs or test plans (Phase 3).
- Does NOT enrich `v2Mapping` or resolve `resolvableInBundle` (downstream).
- Does NOT persist anything.
- Does NOT call the Kognitos API.
