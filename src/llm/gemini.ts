/**
 * Google Gemini provider for the agent's risk-assessment brain.
 *
 * Returns an {@link LlmComplete} that {@link LlmRiskAssessor} layers over the
 * deterministic heuristic floor. The LLM can only *raise* risk severity, never
 * lower it — so the model adds judgment (spotting a spoofed source, an
 * implausible move, a stale feed) without ever being able to talk the agent into
 * posting something the rules rejected.
 *
 * `@google/genai` is an **optional peer dependency**, imported lazily — the rest
 * of the package (and the whole test suite) builds and runs without it. When no
 * key/SDK is present, callers fall back to the heuristic assessor.
 */

import type { LlmComplete } from '../oracle/RiskAssessor.js';

export interface GeminiOptions {
  /** Defaults to `process.env.GEMINI_API_KEY`. */
  readonly apiKey?: string;
  /** Defaults to `process.env.GEMINI_MODEL` or `"gemini-2.5-flash"`. */
  readonly model?: string;
}

/** Minimal view of `@google/genai` used here. */
interface GenAiModule {
  GoogleGenAI: new (opts: { apiKey: string }) => {
    models: {
      generateContent(req: { model: string; contents: string }): Promise<{ text?: string }>;
    };
  };
}

/**
 * Build an {@link LlmComplete} backed by Gemini. Throws if no API key is
 * available; the SDK itself is loaded lazily on first call.
 */
export function createGeminiComplete(options: GeminiOptions = {}): LlmComplete {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('createGeminiComplete: no API key (set GEMINI_API_KEY or pass options.apiKey)');
  }
  const model = options.model ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

  let clientPromise: Promise<GenAiModule['GoogleGenAI']['prototype']> | undefined;
  const client = (): Promise<GenAiModule['GoogleGenAI']['prototype']> => {
    if (!clientPromise) {
      clientPromise = (async () => {
        const mod = (await import('@google/genai')) as unknown as GenAiModule;
        return new mod.GoogleGenAI({ apiKey });
      })();
    }
    return clientPromise;
  };

  return async (prompt: string): Promise<string> => {
    const ai = await client();
    const response = await ai.models.generateContent({ model, contents: prompt });
    return response.text ?? '';
  };
}

/** True when a Gemini key is configured (so callers can pick assessor at runtime). */
export function geminiAvailable(apiKey = process.env.GEMINI_API_KEY): boolean {
  return Boolean(apiKey);
}
