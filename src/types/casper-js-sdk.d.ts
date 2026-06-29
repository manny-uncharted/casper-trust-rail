/**
 * Ambient stub for the optional peer dependency `casper-js-sdk`.
 *
 * The SDK is imported only dynamically, inside `casperSdkFacade.ts`, behind a
 * local typed facade. This declaration lets the package type-check when the SDK
 * is not installed; at runtime the real module is loaded (or a clear, actionable
 * error is thrown if it is absent). The concrete shape used is pinned by the
 * local `ClassicSdk` interface in `casperSdkFacade.ts`.
 */
declare module 'casper-js-sdk';
