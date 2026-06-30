/**
 * Ambient stub for the optional peer dependency `@google/genai`.
 *
 * The SDK is imported only dynamically, inside `llm/gemini.ts`, behind a local
 * typed facade. This declaration lets the package type-check when the SDK is not
 * installed; at runtime the real module is loaded (or the caller falls back to
 * the heuristic risk assessor).
 */
declare module '@google/genai';
