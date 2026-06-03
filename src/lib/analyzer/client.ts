/**
 * OpenAI-backed Process Analyzer client (Phase 1).
 *
 * `analyzeProcess` sends one v1 process source (plus call-graph context) to
 * OpenAI, parses the JSON response, and validates it against the IR Zod schema.
 * On a validation failure it performs exactly ONE corrective retry that feeds
 * the Zod error back to the model. Token usage is logged per request.
 *
 * Strict TS, no `any`.
 */

import OpenAI from 'openai';

import type { V1ProcessIR } from '@/types/ir';

import {
  buildSystemPrompt,
  buildUserPrompt,
  type CallGraphContext,
} from './prompt';
import { V1ProcessIRSchema } from './schema';

// gpt-4.1 follows the schema/structure instructions far more faithfully than
// gpt-4o on long, deeply-nested processes (gpt-4o dropped nested else branches
// and misclassified statements). Same Chat Completions surface (temperature,
// max_tokens, response_format json_object), so no other changes needed.
const MODEL = 'gpt-4.1-2025-04-14';
// A faithful, fully-expanded IR is large: long processes echo verbatim source
// (incl. multi-line """…""" blocks) into rawText/parameters. 8192 truncated the
// JSON mid-array; gpt-4.1 allows up to 32768 output tokens, so give it headroom.
const MAX_TOKENS = 32768;
const TEMPERATURE = 0.1;

/** Analyzer version, stamped into `metadata.parserVersion`. */
export const ANALYZER_VERSION = '1.0.0';

/** Raised when the analyzer cannot produce valid IR (after the retry). */
export class AnalyzerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalyzerError';
  }
}

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AnalyzerError(
      'OPENAI_API_KEY is not set. Export it before running the analyzer.',
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
    console.log(`[analyzer] ${label} token usage — unavailable`);
    return;
  }
  console.log(
    `[analyzer] ${label} token usage — input: ${usage.prompt_tokens}, output: ${usage.completion_tokens}`,
  );
}

/**
 * Parse + validate one response. Returns the validated IR, or throws a detailed
 * error (used to drive the single corrective retry).
 */
function parseAndValidate(rawText: string): V1ProcessIR {
  const jsonText = extractJson(rawText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new AnalyzerError(`Response was not valid JSON: ${detail}`);
  }

  const result = V1ProcessIRSchema.safeParse(parsed);
  if (!result.success) {
    throw new AnalyzerError(result.error.message);
  }
  return result.data;
}

/**
 * Overwrite `metadata` with deterministic, trustworthy provenance. The model's
 * own metadata is ignored (it hallucinates timestamps and line counts); the
 * source text and parse time are authoritative here.
 */
function stampMetadata(ir: V1ProcessIR, source: string): V1ProcessIR {
  return {
    ...ir,
    metadata: {
      rawSource: source,
      sourceLineCount: source.split('\n').length,
      parsedAt: new Date().toISOString(),
      parserVersion: ANALYZER_VERSION,
    },
  };
}

/**
 * Analyze a single v1 process source into validated IR using OpenAI.
 *
 * @param source  Raw v1 process source text.
 * @param context Call-graph context for HAR ref resolution.
 */
export async function analyzeProcess(
  source: string,
  context: CallGraphContext,
): Promise<V1ProcessIR> {
  const client = getClient();
  const system = buildSystemPrompt();
  const userPrompt = buildUserPrompt(source, context);

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: system },
    { role: 'user', content: userPrompt },
  ];

  const first = await client.chat.completions.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    response_format: { type: 'json_object' },
    messages,
  });
  logUsage('attempt 1', first.usage);

  const firstText = first.choices[0]?.message?.content ?? '';

  try {
    return stampMetadata(parseAndValidate(firstText), source);
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

    const retryText = retry.choices[0]?.message?.content ?? '';
    try {
      return stampMetadata(parseAndValidate(retryText), source);
    } catch (retryErr) {
      const retryDetail =
        retryErr instanceof Error ? retryErr.message : String(retryErr);
      throw new AnalyzerError(
        `Analyzer output failed validation after one retry: ${retryDetail}`,
      );
    }
  }
}
