# On-device AI assistant for Next168: research

Epic: [#3](https://github.com/crexative/next168/issues/3) · Written 2026-10-24 (research accessed 2026-10-23/24) · Branch `chore/#3-research-on-device-ai`

**Evidence limits of this run (read first).** The sandbox network allows GitHub, raw.githubusercontent.com and the npm registry only. `developer.chrome.com`, `ai.google.dev`, `huggingface.co`, `web.dev`, `blog.google` and `opensource.googleblog.com` could not be fetched (DNS failure, retried with two tools). So: npm and GitHub facts below are **verified first-hand**; claims about Chrome's Prompt API status, Gemma 4 licence/sizes and WebGPU browser tables are **secondary** (web-search summaries of those pages) and are labelled so. Nothing about speed, Spanish quality or first-load time was measured here.

## 1. Summary and recommendation

**Recommendation: WebLLM (`@mlc-ai/web-llm`) running in a dedicated Web Worker, with Gemma 4 E2B (q4f16_1) as the default model, behind a Next168-owned `AssistantProvider` interface.** Proposals are produced with JSON-schema-constrained decoding (XGrammar) and are never applied without user review.

Why:
- Apache-2.0, actively released (v0.2.86 on 2026-10-11, verified on npm), works on any WebGPU browser, and ships the pieces we need: Worker engine, JSON-schema/grammar-constrained generation (added v0.2.81), Cache API/IndexedDB/OPFS caching, download-progress callback, `hasModelInCache()`.
- It has a prebuilt Gemma 4 E2B entry (added in v0.2.86) with `vram_required_MB` 3387 (f16) / 3863 (f32 fallback for GPUs without `shader-f16`). Verified from `src/config.ts` and from the installed package.
- Gemma 4 is reported (secondary) to be Apache-2.0, which removes the Gemma Terms of Use question for a free public app (see section 3).

**Fallback chain (never block the planner):**
1. **Low-resource tier (same engine, smaller model)**: `Llama-3.2-1B-Instruct-q4f16_1-MLC` (879 MB VRAM) or `Qwen3-1.7B-q4f16_1-MLC` (2037 MB VRAM), chosen when the GPU adapter limits or `navigator.deviceMemory` are low. Spanish quality of these is UNKNOWN.
2. **Opportunistic provider**: Chrome/Edge built-in Prompt API (Gemini Nano) when `LanguageModel.availability()` says it is usable. Zero extra download for us, but Chrome-only and not a standard (Mozilla position: negative, see below), so it is an optional second provider, not the base.
3. **No-model mode (always available)**: deterministic, non-LLM helpers over the store (hour totals per category, "what is left" queries via fixed intents, manual edit of proposals). The planner and its UI do not depend on any model being present.

Alternative worth a spike if WebLLM disappoints: **Transformers.js 4.3.x** (v4.3.0, 2026-09-16 on the GitHub releases page, adds an experimental structured-output package and Safari 26 WebGPU).

**What changed in the last 3 months (2026-07-23 → 2026-10-23)**, from verified release pages/registries:
- WebLLM: v0.2.85 (Sep 08) and v0.2.86 (Oct 11, **Gemma 4 E2B q4f16_1/q4f32_1 prebuilt**, 224 rebuilt WebGPU libs). Structured generation + function calling had landed earlier (v0.2.81, Feb 18).
- Transformers.js: **v4.3.0 (Sep 16: structured output package, Safari 26 WebGPU)**, v4.3.1 (Oct 07: EmbeddingGemma 2). Gemma 4 support came earlier (4.0.1/4.1.0, Apr 23). Years are not shown on the release page; consistent with npm publish time 2026-10-06 for 4.3.1.
- LiteRT-LM (Google): v0.17.0 (Sep 09, Gemma 4 12B multimodal/MTP), v0.17.1 (Sep 16), v0.18.0 (Oct 06), v0.18.1 (Oct 20). Web/JS is "Early Preview" in its README. Gemma 4 web support in LiteRT-LM.js appeared in v0.15.0 (Aug 04, from the release listing).
- `@mediapipe/tasks-genai` 0.10.29 published 2026-07-08 (just outside the window); search results state the MediaPipe LLM Inference API is now in **maintenance-only mode** in favour of LiteRT-LM (secondary, official page unreachable).
- ONNX Runtime Web 1.30.0 (2026-09-14). wllama 3.8.1 (2026-10-02).
- Chrome Prompt API: secondary sources conflict (see section 2). Mozilla closed its Prompt API standards-position as **negative** on 2026-05-05 (outside the window, but relevant).

## 2. Option table

"V" = verified first-hand this run; "S" = secondary/search summary; UNKNOWN = not found, not guessed.

| Option | Latest release (V) | Browser / WebGPU | Download / memory | Structured output / tools | Caching | Licence | Notes |
|---|---|---|---|---|---|---|---|
| **WebLLM** `@mlc-ai/web-llm` | 0.2.86, 2026-10-11 (npm) | Needs WebGPU; Gemma 4 q4f16 entry requires `shader-f16` (V, config.ts) | Gemma 4 E2B q4f16: 3387 MB VRAM, q4f32: 3863 MB (V). Download size in MB: UNKNOWN (HF unreachable) | JSON schema / grammar via XGrammar (V, release notes v0.2.81); function calling "WIP" per README (V) | Cache API (default), IndexedDB, OPFS (V, README) | Apache-2.0 (V) | Worker + ServiceWorker engines (V). **Recommended** |
| **Transformers.js 4.x** `@huggingface/transformers` | 4.3.1, 2026-10-06 | WebGPU or WASM; Safari 26 WebGPU enabled in 4.3.0 (V) | Model-dependent; UNKNOWN for a Gemma 4 E2B ONNX build | Experimental `@huggingface/transformers-structured-output` (JSON schema/regex, single sequence) (V); tool calling in 4.2.0 (V) | Browser Cache API (library default; not re-verified) | Apache-2.0 (V) | Gemma 4 supported since 4.0.1/4.1.0. Reported ~60 tok/s for GPT-OSS 20B on an M4 Pro Max (S, a launch write-up; not our model or hardware) |
| **Chrome/Edge Prompt API** (Gemini Nano) | n/a (browser feature) | Chromium only; Firefox/WebKit not shipping: Mozilla standards-position **negative**, closed 2026-05-05 (V, mozilla/standards-positions #1213) | Browser manages a model download; exact bytes are not exposed to pages (V, spec explainer); press reports ~4 GB silent download (S) | `responseConstraint` JSON schema or RegExp in the API (V, W3C CG explainer) | Browser-managed, shared across sites | Gemini Nano terms: UNKNOWN | Status conflicts in secondary sources: "Chrome 148 stable" (S, low reliability) vs experimental (V: explainer says Chromium prototyping behind a flag). Treat as UNKNOWN until checked on developer.chrome.com |
| **MediaPipe LLM Inference (Web)** `@mediapipe/tasks-genai` | 0.10.29, 2026-07-08 | WebGPU | 83 MB npm unpacked (V); models are separate (Gemma 3n E2B/E4B `-Web` files per S) | No constrained decoding documented in what we could read | App-managed | Apache-2.0 code (V); model terms depend on model | **Maintenance-only**, superseded by LiteRT-LM (S) |
| **LiteRT-LM (JS)** | v0.18.1, 2026-10-20 (GitHub) | JS/web "Early Preview" (V, README); WebGPU requirement not stated in what we read | Gemma 3n E2B, Gemma 4 E4B listed (V) | "Function calling" listed; constrained decoding not documented (V) | UNKNOWN | Apache-2.0 (V) | No npm package found under the names `@litertlm/web` / `@google-ai-edge/litert-lm` (V: 404). Not ready for production use here |
| **ONNX Runtime Web** | 1.30.0, 2026-09-14 | WebGPU/WASM/WebNN EPs | Model-dependent | None built in (you build it) | App-managed | MIT (V) | Low-level; Transformers.js sits on top of it |
| **wllama** (llama.cpp WASM) | 3.8.1, 2026-10-02 | WASM CPU; WebGPU since v3.1 but Firefox/Safari need a compat mode that "significantly degrades performance" (V, README) | GGUF, 2 GB/file limit, split files (V) | Tool calling listed; grammar/JSON schema **not** mentioned (V) | Not stated | MIT (V) | Best "no WebGPU" CPU path; slow for 2B+ models (speed UNKNOWN) |
| **WebNN** | n/a | Not shipped broadly; no first-hand status obtained | n/a | n/a | n/a | n/a | UNKNOWN. Out of scope until an engine exposes it |

**Browser/OS matrix (WebGPU), secondary (web.dev and others unreachable):** desktop Chrome/Edge 113+; Android Chrome 121+ on Android 12+ with Qualcomm/ARM GPUs; Safari 26 / iOS 26 enabled by default; Firefox Windows from 141, Android and Linux unconfirmed. Treat the exact versions as UNKNOWN; feature-detect `navigator.gpu` and `requestAdapter()` instead of sniffing versions.

**Gemma versions and licence for a free public app.**
- Gemma 4 sizes seen in secondary sources: E2B, E4B, 26B MoE, 31B dense; a LiteRT-LM release note also mentions a 12B. These disagree and are UNKNOWN as a set. E2B/E4B are the browser-relevant ones. WebLLM only ships E2B.
- **Licence: Gemma 4 is reported as Apache-2.0 by Google's open-source blog (S: search result title/summary, 2026-03; page not fetchable).** Prior Gemma generations (1 to 3n) used the custom Gemma Terms of Use plus a Prohibited Use Policy (background knowledge, not re-verified now). Action: before shipping, fetch the model card/licence file of the exact weights we download (`mlc-ai/gemma-4-E2B-it-q4f16_1-MLC` inherits from Google's weights; verify the MLC repo's licence field too).
- Under either licence a free public app can use the weights; the Terms of Use would add pass-through obligations (prohibited-use policy, notice), Apache-2.0 only a licence and notice file.

## 3. What the planner assistant needs, and who can deliver

Tasks: (a) read the week (categories, blocks, tasks), (b) answer questions such as "how many hours of deep work this week?", (c) propose changes as JSON for user review.

- **Do not make the model do arithmetic.** Compute totals deterministically from the store (`categoryStats`, `totalScheduledHours`) and pass a compact JSON snapshot to the model; the model only picks which stat to explain. A 2B model is unreliable at summing durations.
- **Proposals** must validate against a JSON schema and then pass `ValidationService` (overlaps, category limits) before being shown as a diff. The user clicks apply; nothing is auto-applied.
- **Constrained decoding:** WebLLM (XGrammar, JSON schema, structural tags) is the only web option where this is first-party and documented in release notes. Chrome's Prompt API has `responseConstraint`. Transformers.js has an experimental package. wllama does not document it.
- **Reliability at small size: UNKNOWN.** No measurements of E2B on a plan-editing task were possible (no GPU, HF unreachable). Constrained decoding guarantees syntax, not semantics, so keep the schema small (3 to 4 operations, enum categories by id) and validate.
- **Spanish quality: UNKNOWN.** No benchmark found; Gemma 4 is stated by Google as multilingual (S). Must be tested with real es/fr/pt/de prompts before launch.

## 4. Fallback strategy

Capability probe at runtime, never at load: `navigator.gpu` → `requestAdapter()` → `adapter.features.has('shader-f16')`, `adapter.limits.maxBufferSize`, `navigator.deviceMemory` (Chromium-only; absent means unknown), `navigator.storage.estimate()` for quota.

| Probe result | Behaviour |
|---|---|
| No WebGPU (older iOS < 26, Firefox without it, headless) | Assistant tab shows "not available on this device"; no-model helpers still work. (Optional later: wllama CPU with a tiny model.) |
| WebGPU, no `shader-f16` | WebLLM `q4f32_1` entry (3863 MB VRAM) or the small model |
| WebGPU but low memory / quota | Small model (Llama-3.2-1B 879 MB VRAM) or offer nothing |
| Chrome Prompt API reports `available`/`downloadable` | Offer as an extra provider |
| Model load fails mid-way (OOM, device lost) | Catch, mark provider unavailable for the session, show a one-line message, keep the planner usable |

iOS: WebGPU is on by default only from iOS/iPadOS 26 (S). Memory limits for Safari tabs make a ~3.4 GB model risky; whether Gemma 4 E2B loads on iPhones is UNKNOWN and must be tested on a device. Default to the 1B tier there.

## 5. Privacy and UX

- **Opt-in, off by default.** A settings screen explains: "Runs entirely on this device. Downloads ~X GB once. Nothing about your plans leaves your device." Show the size **before** download (we can read it from the model manifest or hard-code per model after checking; WebLLM lists `vram_required_MB`, which is memory, not download size). Allow Wi-Fi-only warning via `navigator.connection` where available, and a delete-model button (`deleteModelAllInfoInCache`).
- **Progress and cancel:** `initProgressCallback` for a progress bar; the Prompt API gives `downloadprogress` (0..1, no bytes).
- **Offline:** after the first download the model comes from Cache API/IndexedDB/OPFS; call `hasModelInCache()` to show "ready offline". The model files are fetched from Hugging Face and the WASM libs from GitHub raw by default (see `prebuiltAppConfig`): the first load needs network access to those hosts. For a strict local-first claim, self-host them (GitHub Pages file-size/bandwidth limits make this non-trivial, UNKNOWN) or state the one-time download plainly.
- **Responsiveness:** run the engine in a dedicated Web Worker (`WebWorkerMLCEngineHandler` / `CreateWebWorkerMLCEngine`); the main thread only sends messages and renders streamed text.
- **Persistent storage:** call `navigator.storage.persist()` after consent so the multi-GB cache is not evicted.
- **No telemetry** of prompts. The snapshot sent to the model is built from local data only.

## 6. Minimal integration sketch

Module boundary: `src/ai/` knows nothing about Vue or Pinia. A thin composable wires it to the store.

```ts
// src/ai/AssistantProvider.ts: the only thing the app depends on
export type Availability = 'unsupported' | 'needs-download' | 'ready' | 'loading' | 'error';
export interface WeekSnapshot { /* categories, blocks, computed stats; plain JSON */ }
export interface Proposal { changes: Array<
  | { op: 'add_block'; title: string; categoryId: string; day: number; start: string; end: string }
  | { op: 'move_block'; id: string; day: number; start: string; end: string }
  | { op: 'delete_block'; id: string }>; rationale: string }
export interface AssistantProvider {
  readonly id: string;
  probe(): Promise<{ availability: Availability; downloadMB?: number; reason?: string }>;
  load(onProgress: (p: number, text: string) => void, signal?: AbortSignal): Promise<void>;
  ask(question: string, week: WeekSnapshot, signal?: AbortSignal): AsyncIterable<string>;
  propose(request: string, week: WeekSnapshot, signal?: AbortSignal): Promise<Proposal>; // schema-constrained
  unload(): Promise<void>;
  deleteModel(): Promise<void>;
}
```

```ts
// src/ai/worker.ts: dedicated worker (Vite: new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }))
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (m) => handler.onmessage(m);
```

```ts
// src/ai/WebLlmProvider.ts (excerpt)
import { CreateWebWorkerMLCEngine, hasModelInCache } from '@mlc-ai/web-llm';
const MODEL = 'gemma-4-E2B-it-q4f16_1-MLC';
// load(): engine = await CreateWebWorkerMLCEngine(worker, MODEL, { initProgressCallback });
// propose():
const out = await engine.chat.completions.create({
  messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify({ week, request }) }],
  temperature: 0,
  response_format: { type: 'json_object', schema: PROPOSAL_JSON_SCHEMA },
});
const proposal = JSON.parse(out.choices[0].message.content ?? '{}');
// then: validate against ValidationService; show diff; apply only on user click
```

Selection (`src/ai/selectProvider.ts`): probe providers in order WebLLM (model tier by capability) → Prompt API → `NoModelProvider`, which implements the same interface with deterministic answers and an empty proposal list. Lazy-load the AI chunk (`import()`) so the base bundle does not grow (`@mlc-ai/web-llm` is ~14 MB unpacked on npm; the shipped chunk size is UNKNOWN until built).

## 7. Feasibility check (what was run, what it proves)

Run in an empty scratch directory outside the repo (no repo files changed):
1. `npm i @mlc-ai/web-llm@0.2.86 typescript@5`.
2. Wrote a ~20-line TypeScript file importing `CreateWebWorkerMLCEngine`, `WebWorkerMLCEngineHandler`, `hasModelInCache`, `prebuiltAppConfig`, and calling `chat.completions.create` with `response_format: { type: 'json_object', schema }`, under `strict: true`. `tsc --noEmit` → **passed**.
3. Imported the package in Node and listed `prebuiltAppConfig.model_list`: 165 models; `gemma-4-E2B-it-q4f16_1-MLC` (3387.37 MB, requires `shader-f16`), `gemma-4-E2B-it-q4f32_1-MLC` (3862.72 MB), `Qwen3-1.7B-q4f16_1-MLC` (2036.66), `Qwen2.5-1.5B-Instruct-q4f16_1-MLC` (1629.75), `Llama-3.2-1B-Instruct-q4f16_1-MLC` (879.04) are present.
4. `typeof navigator.gpu` in Node 22 → `undefined`.

**Proves:** the pinned package installs, its public types accept the worker + JSON-schema call shape used in the sketch, and the Gemma 4 E2B prebuilt entries ship in that version.
**Does not prove:** that any model loads or runs (no GPU, no WebGPU, no Hugging Face access here), generation speed, memory on real devices, JSON quality, Spanish quality, bundle size, or Vite worker bundling.

## 8. Risks

- **Download size and memory** (~3.4 GB VRAM for the default) exclude many phones/laptops; tier selection and no-model mode are mandatory.
- **WebLLM function calling is "WIP"**; rely on schema-constrained JSON rather than tool calls.
- **Dependence on Hugging Face and GitHub raw** for weights/libs at first load; availability and bandwidth terms are outside our control.
- **Small-model reliability**: valid JSON can still be a bad plan; always validate and show a diff.
- **Licence drift**: confirm the exact weights' licence at integration time; Apache-2.0 for Gemma 4 is secondary-sourced here.
- **Prompt API instability** and the negative Mozilla position make it unsuitable as the only path.
- **MediaPipe LLM Inference in maintenance**; LiteRT-LM JS is an early preview with no npm package we could find. Revisit in ~3 months.
- **GitHub Pages hosting**: no custom headers, so wllama multi-thread (needs COOP/COEP) is unavailable on the current host.

## 9. UNKNOWNs

- Chrome Prompt API stable/preview status, exact Chrome version, hardware thresholds, model licence. Reason: developer.chrome.com unreachable; secondary sources conflict.
- Gemma 4 official licence text, full model-size list, official memory figures. Reason: ai.google.dev / Hugging Face unreachable. Third-party numbers (≈4 GB RAM at 4-bit for E2B, 128K context) not adopted.
- Download size (MB) of the WebLLM Gemma 4 E2B q4f16 weights. Reason: HF unreachable.
- Tokens/s on typical hardware for Gemma 4 E2B in WebLLM/Transformers.js. Reason: no GPU, no published figure found for this model.
- First-load time, Spanish/fr/pt/de quality, plan-editing reliability. Reason: not measured, no benchmark found.
- Whether Gemma 4 E2B loads on iOS 26 devices. Reason: no device.
- Firefox (Android/Linux) WebGPU status and WebNN status. Reason: no primary source reachable.
- Self-hosting weights on GitHub Pages feasibility (file size/bandwidth). Reason: not checked.

## 10. Sources (accessed 2026-10-23/24; dates are release/publish dates shown by the source)

Verified first-hand:
- npm registry, `@mlc-ai/web-llm` 0.2.86, published 2026-10-11: https://www.npmjs.com/package/@mlc-ai/web-llm (queried via registry.npmjs.org)
- npm `@huggingface/transformers` 4.3.1 (2026-10-06); `@huggingface/transformers-structured-output` 4.3.1 (2026-10-06); `@mediapipe/tasks-genai` 0.10.29 (2026-07-08); `onnxruntime-web` 1.30.0 (2026-09-14); `@wllama/wllama` 3.8.1 (2026-10-02)
- WebLLM releases (v0.2.81 to v0.2.86; day/month only on page): https://github.com/mlc-ai/web-llm/releases
- WebLLM README: https://github.com/mlc-ai/web-llm
- WebLLM `src/config.ts` model list: https://raw.githubusercontent.com/mlc-ai/web-llm/main/src/config.ts
- Transformers.js releases (4.0.0 Mar 30 … 4.3.1 Oct 07; day/month only): https://github.com/huggingface/transformers.js/releases
- LiteRT-LM repo and releases (v0.15.0 Aug 04 … v0.18.1 Oct 20): https://github.com/google-ai-edge/LiteRT-LM , https://github.com/google-ai-edge/LiteRT-LM/releases
- wllama README: https://github.com/ngxson/wllama
- Prompt API explainer (W3C WebML CG): https://raw.githubusercontent.com/webmachinelearning/prompt-api/main/README.md
- Mozilla standards position #1213 (Prompt API, negative, closed 2026-05-05): https://github.com/mozilla/standards-positions/issues/1213
- GoogleChromeLabs demos: https://github.com/GoogleChromeLabs/web-ai-demos
- google-deepmind/gemma README (Gemma 4 E4B named; repo licence Apache-2.0, not necessarily the weights): https://github.com/google-deepmind/gemma

Secondary (search summaries; original pages not fetchable here):
- Gemma 4 under Apache 2.0, Google Open Source Blog (2026-03): https://opensource.googleblog.com/2026/03/gemma-4-expanding-the-gemmaverse-with-apache-20.html
- Gemma 4 announcement: https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/
- MediaPipe LLM Inference guides (maintenance mode note): https://ai.google.dev/edge/mediapipe/solutions/genai/llm_inference , https://ai.google.dev/edge/mediapipe/solutions/genai/llm_inference/web_js
- WebGPU in major browsers: https://web.dev/blog/webgpu-supported-major-browsers
- Chrome Prompt API coverage (conflicting, low reliability): https://adsm.dev/posts/prompt-api/ , https://pasqualepillitteri.it/en/news/3145/gemini-nano-chrome-built-in-ai-client-side-en
- XGrammar-2 (2026-05-04): https://blog.mlc.ai/2026/05/04/xgrammar-2-fast-customizable-structured-generation
- Third-party Gemma 4 memory figures (not adopted): https://unsloth.ai/docs/models/gemma-4
