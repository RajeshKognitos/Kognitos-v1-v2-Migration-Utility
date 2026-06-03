/**
 * OpenAI-backed SOP + Test-Plan generator client (Phase 3).
 *
 * `generateSopAndTestPlan` sends one analyzed `V1ProcessIR` (plus optional
 * bundle context) to OpenAI, parses the JSON response, and validates it against
 * the SOP model-output Zod schema. On a validation failure it performs exactly
 * ONE corrective retry that feeds the Zod error back to the model. Token usage
 * is logged per request and returned in the result's metadata.
 *
 * This mirrors `src/lib/analyzer/client.ts` exactly (same Chat Completions
 * surface, JSON mode, retry, deterministic metadata stamping). Per the Phase 3
 * task, OpenAI is used here for parity with Phase 1 (the project brief's earlier
 * "Claude for SOP" note is superseded by that instruction).
 *
 * Strict TS, no `any`.
 */

import OpenAI from 'openai';

import type { V1ProcessIR } from '@/types/ir';
import type { SopGenerationResult } from '@/types/sop';

import { buildSopSystemPrompt, buildSopUserPrompt, type SopContext } from './prompt';
import { SopModelOutputSchema } from './schema';

// Same model as the analyzer: gpt-4.1 follows long, schema-heavy instructions
// far more faithfully than gpt-4o.
const MODEL = 'gpt-4.1-2025-04-14';
// SOP prose + a multi-case test plan can be large; give generous headroom.
const MAX_TOKENS = 16384;
const TEMPERATURE = 0.2;

/** SOP generator version, stamped into `metadata.sopGeneratorVersion`. */
export const SOP_GENERATOR_VERSION = '1.0.0';

/** Token counts consumed by one generation (summed across the optional retry). */
export interface SopTokenUsage {
  /** Total prompt (input) tokens across attempt 1 and the optional retry. */
  input: number;
  /** Total completion (output) tokens across attempt 1 and the optional retry. */
  output: number;
}

/** Raised when the generator cannot produce a valid SOP result (after the retry). */
export class SopGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SopGenerationError';
  }
}

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new SopGenerationError(
      'OPENAI_API_KEY is not set. Export it before running the SOP generator.',
    );
  }
  return new OpenAI({ apiKey });
}

/**
 * Best-effort JSON extraction. `response_format: json_object` should yield raw
 * JSON, but we defensively strip ``` / ```json fences and grab the outermost
 * braces so a stray wrapper doesn't force an avoidable retry.
 */
function extractJson(raw: string): string {
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
  }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    return text.slice(first, last + 1);
  }
  return text;
}

function logUsage(
  label: string,
  usage: OpenAI.Completions.CompletionUsage | undefined,
): void {
  if (!usage) {
    console.log(`[sop] ${label} token usage — unavailable`);
    return;
  }
  console.log(
    `[sop] ${label} token usage — input: ${usage.prompt_tokens}, output: ${usage.completion_tokens}`,
  );
}

function addUsage(
  acc: SopTokenUsage,
  usage: OpenAI.Completions.CompletionUsage | undefined,
): void {
  if (!usage) return;
  acc.input += usage.prompt_tokens;
  acc.output += usage.completion_tokens;
}

/** Parsed + validated model output (the model fills sop/testPlan/connections). */
type SopModelOutput = Pick<
  SopGenerationResult,
  'sop' | 'testPlan' | 'connectionRequirements'
>;

/**
 * Parse + validate one response. Returns the validated model output, or throws
 * a detailed error (used to drive the single corrective retry).
 */
function parseAndValidate(rawText: string): SopModelOutput {
  const jsonText = extractJson(rawText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new SopGenerationError(`Response was not valid JSON: ${detail}`);
  }

  const result = SopModelOutputSchema.safeParse(parsed);
  if (!result.success) {
    throw new SopGenerationError(result.error.message);
  }
  return result.data;
}

/**
 * Assemble the final result by stamping deterministic, trustworthy provenance.
 * The model is not trusted for `metadata` (it hallucinates timestamps); only the
 * generation time, version, and measured token usage are authoritative.
 */
function stampMetadata(
  output: SopModelOutput,
  tokens: SopTokenUsage,
): SopGenerationResult {
  return {
    ...output,
    metadata: {
      generatedAt: new Date().toISOString(),
      sopGeneratorVersion: SOP_GENERATOR_VERSION,
      tokensUsed: { input: tokens.input, output: tokens.output },
    },
  };
}

/**
 * Generate a v2 SOP + test plan + connection requirements for one analyzed
 * process IR using OpenAI.
 *
 * @param ir      The analyzed `V1ProcessIR` (from Phase 1).
 * @param context Optional bundle context (sibling summary for SOP narrative).
 */
export async function generateSopAndTestPlan(
  ir: V1ProcessIR,
  context: SopContext = { bundleSummary: 'a standalone process.' },
): Promise<SopGenerationResult> {
  const client = getClient();
  const system = buildSopSystemPrompt();
  const userPrompt = buildSopUserPrompt(ir, context);

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: system },
    { role: 'user', content: userPrompt },
  ];

  const tokens: SopTokenUsage = { input: 0, output: 0 };

  const first = await client.chat.completions.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    response_format: { type: 'json_object' },
    messages,
  });
  logUsage('attempt 1', first.usage);
  addUsage(tokens, first.usage);

  const firstText = first.choices[0]?.message?.content ?? '';

  try {
    return stampMetadata(parseAndValidate(firstText), tokens);
  } catch (err) {
    const validationDetail = err instanceof Error ? err.message : String(err);

    // ONE corrective retry: feed the failure back to the model.
    const retry = await client.chat.completions.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      response_format: { type: 'json_object' },
      messages: [
        ...messages,
        { role: 'assistant', content: firstText },
        {
          role: 'user',
          content: `Your previous output failed validation: ${validationDetail}. Return ONLY valid JSON matching the schema. No markdown fences, no commentary.`,
        },
      ],
    });
    logUsage('attempt 2 (retry)', retry.usage);
    addUsage(tokens, retry.usage);

    const retryText = retry.choices[0]?.message?.content ?? '';
    try {
      return stampMetadata(parseAndValidate(retryText), tokens);
    } catch (retryErr) {
      const retryDetail =
        retryErr instanceof Error ? retryErr.message : String(retryErr);
      throw new SopGenerationError(
        `SOP generation output failed validation after one retry: ${retryDetail}`,
      );
    }
  }
}
