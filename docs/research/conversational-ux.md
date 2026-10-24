# Next168: conversational UX, on-device voice, and speech-to-structure research brief

Prepared 2026-10-24 (all "accessed" dates below are 2026-10-24 unless a source date is shown).
Scope: four questions from the Next168 owner request. No repository was modified and nothing was posted anywhere.
Method notes: web fetch/search tools, the public npm registry, the Hugging Face file-tree API, the MDN browser-compat-data repo, and three throwaway local experiments (chrono-node, a Spanish grammar prototype, a bundle read of the Shake site) kept in the session scratchpad. Claims are tagged `[S#]`; the source table at the end gives URL and date for each. Facts I could not verify are marked **UNKNOWN** with the reason.

---

## 0. Executive summary

1. **Shake is not a real chat.** Static reading of its production bundle shows a one-question-per-screen stepper with a chat-flavored prompt (one avatar bubble at a time), a docked input bar with a circular "continue" button, quick-reply chips for closed choices, "Skip" links for optional fields, a 9-pip progress indicator, a back chevron, and a faded stack of previous answers that you can tap to jump back and edit. There is no typing indicator and no accumulating transcript `[S2]`. I could not watch it run (the page is a JS shell for non-browser fetchers), so timings and animations are unverified.
2. **Chat is the right skin for 2-3 open questions and the wrong container for dense structured editing.** The sourced evidence supports a *hybrid*: conversational stepper for onboarding and "describe your week" capture, with an always-visible editable grid/list as the source of truth `[S3][S4][S5][S13][S14]`.
3. **Voice that "never leaves the device" is only guaranteed in two cases today:** (a) Chrome/Edge *desktop* with `processLocally = true` after the language pack is installed; (b) an in-browser model (Whisper / Moonshine via WebGPU/WASM) that you self-host. Chrome Android and Safari iOS have **no** supported on-device Web Speech path, so default `SpeechRecognition` there must be treated as "audio may leave your device" `[S18][S20][S23][S25]`.
4. **For turning speech into blocks, a deterministic Spanish grammar must be the primary parser; a 1B-3B LLM is a helper for labels and clarifying questions only.** I tested chrono-node 2.10.3 (Spanish): it got single dates and "weekday + time" right but mangled the owner's own example ("de lunes a viernes de 9 a 5") and several afternoon/night phrases. A 60-line throwaway grammar handled the example and the shared-meridiem cases. Small-model tool-use benchmarks (Llama 3.2 1B BFCL V2 25.7 vs 3B 67.0) say a 1B model should not own times `[S42]`.

---

## 1. Shake app (shakeapp.today/auth): onboarding and interaction model

### What I could and could not observe
- `WebFetch` of `https://www.shakeapp.today/auth` and `/` returned only the title "SHAKE - Find spontaneous activities with friends" (a single-page-app shell: `<div id="root">` plus one module script) `[S1]`.
- No public App Store/Play listing could be matched to this site: search returned several unrelated "Shake" apps, so the store listing is **UNKNOWN** `[S50]`. No public product post or video was found.
- Substitute method: I downloaded the public production bundle (`/assets/index-D2FLqyzR.js`, 3.4 MB, 2026-10-24) and read the auth component's source and copy. This is what any browser downloads; it shows *structure, copy and logic*, not runtime feel (animation timing, haptics, keyboard behavior on device are **UNKNOWN**) `[S2]`.
- The product is a social/plans app (meet people, join activities, 18+ gate); the bundle also contains native-app deep-link redirect URIs, so a native shell exists `[S2]`. That context matters: Shake collects *profile data*, a different job from Next168's *schedule data*.

### Flow (from the bundle `[S2]`)
Sequence of screens, in order:
1. **Language** ("Choose your language", "You can always change this later in your profile"), skipped if a language is already stored locally.
2. **Method** ("Welcome", "Log In or create your account"): Google, Apple, "Login with email", "Create Account". Email path uses a magic link ("Check your email for a link to sign in", "Verify your email") with optional password set later.
3. **Confirmation** screen after email send (a decorative falling-star animation).
4. **Profile stepper** (this is the chat-like part). Nine ordered steps: `name`, `birthday`, `phone`, `gender`, `nationality`, `occupation`, `interests`, `social`, `avatar`. Prompts are first-person-bot copy with emoji: "What's your name? 👋", "When's your birthday? 🎂", "What's your phone number? 📱", "How do you identify?", "Where are you from? 🌍", "What do you do? 💼", "What are you into? ✨", "Drop your socials 📸", "Last step - pick an avatar or a photo!".
5. Done: "Complete Setup" button ("Saving…" while writing). Completion is stored server-side (`profiles.onboarding_completed_at`); if a returning user's profile is incomplete the stepper restarts at `name`, so it is **resumable** across sessions.

### Interaction model, concretely
| Aspect | What the code shows `[S2]` |
|---|---|
| Layout | Full-screen overlay: header (back chevron, logo, 9 progress pips), scrollable body, input bar docked at bottom (safe-area aware, blurred background). |
| "Bubble" | Exactly **one** bot bubble per step: round avatar (😎 on a per-step pastel color) + muted rounded bubble (square top-left corner) with large prompt and optional small subtext ("You must be 18 or older to join", "Optional - tap Skip to continue"). Enters with a fade + slide-up (~300 ms, Tailwind `animate-in`). No user-side bubbles. |
| History | Previous answers are **not** bubbles. They stack above as faded recap rows: small gray question label + bold answer, with opacity and font size decaying with distance (80/70/60%). Skipped optional fields read "Skipped". |
| Editing earlier answers | Every recap row is a button; tapping it sets the step back to that field. Per-field state is held separately, so answers appear to be retained (reading only; not exercised at runtime). |
| Back | Header chevron moves to the previous step (from the first step it returns to the method screen). |
| Input types | Free text (name, occupation, socials, phone), date picker (birthday, max date = today minus 18 years), searchable select (nationality), **chips with auto-advance** for 3 closed options (gender: tap, 180 ms, next step), two-level chips (interests: topic chips reveal a horizontally scrolling tray of sub-interest chips, multi-select with counts), avatar grid + upload + camera capture. |
| Progression | Circular arrow button (aria-label "Continue"), disabled until valid; Enter also submits; first input `autoFocus`; body auto-scrolls to bottom on step change. |
| Optional fields | Underlined "Skip" / "Skip for now" links on phone, occupation, interests, socials. |
| Validation and errors | Mostly **toasts** ("Please enter your name", "You must be 18 or older to use Shake"); inline red helper text for nationality and occupation (2-50 chars, allowed character set). Network failures are normalized into friendly toasts ("Unable to create account. Please check your connection and try again."); rate limit ("Too many requests - please try again in an hour."); one automatic retry with an info toast ("Retrying... please wait") on retryable email-send errors. |
| Typing indicator | **None** (no such string or component in the bundle). No streaming text. |
| Accessibility signals | Back and Continue buttons carry `aria-label`; no `role="log"`/`aria-live` on the bubble or recap; entry animation has no `motion-reduce` variant in the app CSS (the stylesheet contains 9 `prefers-reduced-motion` rules but I did not attribute them to this screen: **UNKNOWN** whether the bubble is suppressed). |

### Takeaways for Next168
- What makes it feel conversational is cheap: a persona bubble, one question at a time, a persistent composer, tap chips for closed answers, and a visible, tappable recap. It is **not** NLP.
- Shake's weak spots to avoid: errors as transient toasts (easy to miss, not tied to the field), no live-region semantics, no fake or real typing state, and heavy reliance on emoji tone. For Next168, Spanish copy and an editable summary at the end are worth adding.

---

## 2. Conversational UI patterns for structured data capture

### Evidence on when conversational capture helps
- **Engagement/quality gains exist in survey settings.** In a ~600-participant field experiment, an AI chatbot survey yielded more informative, relevant, specific and clear free-text answers than a conventional web survey `[S13]`; a CHI 2019 comparison found chatbot respondents less prone to satisficing than web respondents, and a casual style helped only in the chatbot condition `[S14]`. Caveat: these tested *open-ended survey answers*, not constrained schedule entry, so transfer is plausible but unproven.
- **Vendor completion-rate claims are unverified.** Typeform's "up to 3.5x" and "59% completion" figures have no published baseline `[S17]`. Do not plan on them.

### Best practices that sources support
1. **Text and buttons together.** NN/g's chatbot study (8 users, Nov 2018) found both input modes needed; users complained when forced to *type a date*; button-only bots feel like websites `[S3]`. NN/g (Aug 2024) adds that one-click prompt controls reduce interaction cost and help discoverability `[S4]`. Apple: "when possible, offer choices instead of requiring text entry" `[S7]`.
2. **Prefill and don't re-ask.** Apple: pre-gather information, get it from the system, offer defaults `[S7]`. NN/g observed a bot re-asking for an address already given `[S3]`; WCAG 2.2 SC 3.3.7 Redundant Entry (Level A) requires already-entered info to be auto-filled or selectable in the same process `[S9]`.
3. **Flexible flow, back and forward.** NN/g: infer context and let users move forward and backward; linear scripts break when users deviate; bots that "simply stopped and forced her to start over" were punished `[S3]`.
4. **Validate early, near the field.** Apple: dynamically validate and give feedback as soon as a problem is detected `[S7]`; NN/g: error messages near the triggering action `[S4]`.
5. **Own failures, offer an escape hatch.** Users preferred honest failure plus a way out `[S3]` (for Next168: "I couldn't read that. Edit it yourself" opening the manual editor).
6. **Short, skippable onboarding, permissions in context, postpone non-essentials.** Apple HIG: onboarding should be "fast, fun, and optional", provide reasonable defaults, and postpone nonessential setup; permission requests may be folded into onboarding only when the app cannot function without that data `[S6]`. The microphone is feature-triggered, so ask when the user first taps the mic (judgment).
7. **Disclose scope.** Users could not tell what bots could do (WebMD example) `[S3]`; show example prompts (NN/g conversation starters) `[S4]`.
8. **Don't over-stage.** NN/g: more than ~2 disclosure levels hurts; too many wizard steps force excess navigation; staged flows fail when steps depend on each other `[S5]`.

### Accessibility
- **Message list:** W3C technique ARIA23: `role="log"` for chat history gives implicit `aria-live="polite"`, `aria-atomic="false"`; new messages are announced without moving focus; supports SC 4.1.3 Status Messages; page updated 2026-06-01 `[S8]`.
- **Focus (engineering judgment, not from a cited normative source):** after a step change, move focus to the new input and tie the question to it with `aria-labelledby`/`aria-describedby`, rather than relying only on the live region; keep chips as real `<button>`s in tab order; do not make a typing indicator focusable (Telerik's chat docs do the same, vendor guidance only).
- **Motion:** honor `prefers-reduced-motion` (MDN: widely available since Jan 2020; override defaults inside a `reduce` query) `[S11]`. WCAG 2.3.3 (AAA) requires interaction-triggered motion to be disableable `[S10]`. On-device responses are instant, so a *fake* typing delay is optional decoration: skip it or make it opt-out (judgment).
- **Targets and errors:** use inline text errors tied to the field (not toast-only) so screen-reader and low-vision users can find them (judgment, consistent with `[S4][S7]`).

### Letting users edit previous answers (patterns)
- Shake's tappable recap rows `[S2]` (cheap, works for ordered steps).
- Better for Next168: an **editable summary card** after each multi-field capture ("Work, Mon-Fri 09:00-17:00 [edit] [remove]"), plus an "Undo" toast for the last committed proposal. Re-asking should *prefill* the old value (SC 3.3.7 `[S9]`).
- Keep the schedule grid visible or one tap away: chat transcripts are poor at showing "what changed" (NN/g notes limited display space in chat `[S3]`).

### When chat is worse than a form
- **Predictable, multi-field input (roughly 4+ fields), repeated entry, bulk edits, comparison/overview tasks, and returning users.** Sources: NN/g (chat has "very small" display area; improving the app beats duplicating it in a bot) `[S3]`; Baymard's checkout research finds *field count* matters more than step count (different domain, directional only) `[S12]`; practitioner opinion pieces argue forms win when inputs are known in advance (SAP Emarsys UX article, search snippet only, direct fetch returned 403) `[S15]`; Intercom's "forms aren't dead" post argues similarly but I could only see the title/snippet `[S16]`.
- **Dense calendar editing** (dragging a block, resizing) is inherently spatial: keep the grid. Use chat for *capture* and *explanation*, not for *arrangement*.
- Rule of thumb that survives the evidence: conversational for first-run and for natural-language bulk entry; form/grid for everything the user will touch weekly.

---

## 3. Voice input in a PWA that stays on-device by default

### (a) Web Speech API `SpeechRecognition`
| Platform | Status | Does audio leave the device? |
|---|---|---|
| Any browser, default (`processLocally` false/unset) | Chrome exposes `webkitSpeechRecognition` since 33; Safari since 14.1 `[S20]` | MDN: in Chrome "your audio is sent to a web service", so it also fails offline `[S18][S19]` |
| Chrome/Edge **desktop**, `processLocally = true` | MDN BCD: Chrome 139+; marked experimental/standards-track `[S20]`. Intent to Ship (2025-01-06) said Chrome 135 on Windows/Mac/Linux, ~60 MB per language pack `[S22]`; Chrome 139 release post (2025-08-05) announces it `[S21]`. Chromestatus lists "On-device Web Speech API" at 139 desktop but its status text still says "in developer trial (behind a flag)" while marked released: **UNKNOWN** whether it is on by default in stable `[S23]` (so always call `available()` at runtime). | Spec/MDN: forces local recognition, "neither the audio nor the transcribed speech are sent to a third-party service" `[S18]`. Fingerprinting mitigations still under discussion `[S22][S25]`. |
| Chrome **Android** | BCD: `processLocally`, `available()`, `install()` all `version_added: false`; chromestatus lists no Android milestone `[S20][S23]` | Default path uses Google's service; **no on-device option** |
| Edge desktop | On-device model in Edge Canary/Dev 150.0.4076+, behind flag "Speech Recognition with on-device model"; docs updated 2026-10-19 `[S24]` | Edge docs: "speech input ... never leaves the device, and isn't collected to train AI models" `[S24]` |
| **Safari iOS/macOS** | `webkitSpeechRecognition` since 14.1; no `processLocally`/`available()`/`install()` (BCD false) `[S20]`. WebKit standards-position #443 has privacy concerns open (since 2025-04-11): tracking vector from on-device vs cloud choice, language-pack fingerprinting `[S25]` | Not guaranteed. A developer thread (Mar 2025) shows WebKit code setting `requiresOnDeviceRecognition` yet observed cloud fallback and offline failure `[S26]`; a macOS 26 test reports a permission prompt before data goes to Apple and failure offline `[S27]`. Treat as **cloud**. Behavior of the API inside an installed iOS PWA: **UNKNOWN** (not tested; no primary source found). |
| Firefox | BCD shows `preview` only `[S20]`; caniuse says disabled by default `[S52]` | n/a |

**Languages.** Edge documents on-device `en-US, de-DE, it-IT, pt-PT, es-ES, ko-KR` `[S24]`. Chrome's list is not in any page I could open: **UNKNOWN**. Note that `es-ES` is Castilian; whether `es-CO`/`es-MX` packs exist is **UNKNOWN** (use `available({langs:['es-CO'], processLocally:true})`). `quality` option and contextual biasing are proposed (chromestatus Chrome 142/150 entries) `[S23]`.

**API shape (MDN example):** `SpeechRecognition.available({langs, processLocally:true})` -> `available | downloadable | downloading | unavailable`; `install()` downloads the pack; `start()` with `processLocally=true` and no pack throws `language-not-supported`; gated by Permissions-Policy `on-device-speech-recognition` `[S18]`.

**Privacy statements each state allows**
- Default path (any browser): "Your browser may send audio to its speech service." Do not claim on-device.
- Chrome/Edge desktop, `available()==='available'` and `processLocally=true`: "Speech is transcribed on your device and not sent to a speech service." (A one-time language-pack download occurs.)
- Safari iOS: no on-device claim.

### (b) In-browser models (transformers.js / onnxruntime-web, WebGPU or WASM)
Current stack versions (npm registry, 2026-10-24): `@huggingface/transformers` 4.3.1 (2026-10-06), `onnxruntime-web` 1.30.0 (2026-09-18), `@mlc-ai/web-llm` 0.2.86 (2026-10-11) `[S39]`. WebGPU: Chrome Android 121+, Safari 26+ (and iOS by mirror), Firefox desktop partial `[S29]`; transformers.js v4 (2026-02-09) rewrote the WebGPU runtime `[S40]`.

**Download sizes** (summing the int8 encoder + merged decoder files from Hugging Face; lower precision variants are smaller) `[S30]`:
| Model | Params | Approx. int8 download | Spanish WER, FLEURS `[S31]` |
|---|---|---|---|
| Whisper tiny | 39M | ~41 MB (10.1 + 30.7) | 15.9 |
| Whisper base | 74M | ~77 MB (23.2 + 53.7) | 9.9 |
| Whisper small | 244M | ~249 MB (92.3 + 156.8) | 5.6 |
| Whisper large-v3-turbo | large | q4f16 encoder + merged decoder sum to ~564 MB (370.0 + 193.5) | not measured here |
| Distil-Whisper | | `distil-small.en` is English-only `[S30][S33]` | n/a |
| Moonshine Base (English) | 58M | ~63 MB int8 (20.5 + 42.4) `[S30]` | n/a |
| Moonshine Base (**Spanish**) | 58M | UNKNOWN (docs list only English sizes) | 4.33% (vendor-reported, FLEURS) `[S36]` |

Notes: tiny/base Whisper Spanish WERs are high for free speech (15.9% and 9.9%); small (5.6%) is the first usable size but ~250 MB. Moonshine's own table reports Spanish Base at 4.33% FLEURS (better than Whisper small on paper) but it is **self-reported**, **non-streaming**, and its license for non-English legacy models is the non-commercial/small-business "Moonshine Community License" (the README says MIT by default except legacy non-English models, while MoonshineJS says Spanish is under the community license for <$1M revenue orgs: conflicting statements, **verify LICENSE before shipping in an MIT repo**) `[S35][S36][S38]`. The `@moonshine-ai/moonshine-js` package was last published 2025-07-03 and is marked beta; the newer "moonshine-voice" lists JavaScript/WASM as a platform but I could not confirm Spanish in a browser build: **UNKNOWN** `[S35][S38][S39]`. Newer browser-demo speech models exist (Voxtral Realtime, Cohere Transcribe, Granite 4.0 1B Speech on WebGPU in the transformers.js v4 demo collection) but sizes, Spanish quality and mobile feasibility are **UNKNOWN** `[S40]`.

**Latency on a mid-range Android phone: UNKNOWN (no measured source).** Closest proxies:
- whisper-tiny.en via transformers.js on an Apple M1 desktop: 13.1x real-time, WER 4.3% on six synthetic-voice clips; the author warns mid-range Android "may be several times slower" `[S32]` (2026-08-19).
- A repo measured whisper-tiny.en/WASM at ~0.2-0.3 s of compute per audio second on a single CPU core (desktop proxy) `[S34]` (snippet; date UNKNOWN).
- Moonshine docs report phone latencies only for *English streaming* models on native runtimes (Pixel 10a: tiny streaming 92 ms, small 234 ms) `[S37]`; not a browser/Spanish measurement.
- An aggregator article gives "10-15x real-time for tiny on WebGPU" but states no hardware or method; treat as unverified `[S33]`.
Therefore: **plan a device benchmark** (cold load, warm load, 10 s utterance, WebGPU vs WASM, tiny/base/small, es-CO sample set) before promising anything.

**Privacy statement allowed:** "Audio is processed in your browser and never uploaded" is accurate if (1) the model files are self-hosted same-origin (or cached) and (2) no analytics see audio. Model download itself reveals only that a download happened. This is the **strongest** claim available on iOS and Android.

### (c) OS-level options a PWA can use
- **Keyboard dictation in ordinary `<input>`/`<textarea>`.** No API needed; the OS keyboard supplies a mic button. Privacy depends on the OS: iOS Dictation is described by secondary sources as on-device for supported languages with server fallback and an optional "Improve Siri & Dictation" opt-in; I could not retrieve Apple's primary page, so the exact language list is **UNKNOWN** `[S48]`. Gboard: Google documents "Assistant voice typing" keeping text on device on Pixel 6+/Android 12+ `[S47]`; offline packs for other devices/languages are secondary-source only (Spanish **UNKNOWN**). The app cannot detect or control which mode is used.
- **Privacy statement allowed:** "Voice typing uses your device keyboard. Where it is processed depends on your phone's settings," i.e. no "never leaves" claim.
- No OS-level speech-to-text API exists for PWAs beyond Web Speech (Android `SpeechRecognizer`/Apple `SFSpeechRecognizer` are native-only). The Chrome built-in Prompt API (Gemini Nano) lists audio input but is desktop-only (see Q4) `[S41]`.

### What changed in the last three months (about 2026-07-24 to 2026-10-24) for Q3
Dated items I could verify:
- **Edge 150 on-device speech model** (Canary/Dev, flag), docs updated 2026-10-19: Edge (Chromium) documents a *built-in on-device model with an explicit privacy statement and language list*; it is behind a flag in pre-release channels only `[S24]`.
- **Chromestatus** now carries separate entries for on-device recognition *quality* (desktop 150), unspoken punctuation (151) and contextual biasing (142), all desktop-only, status "Proposed" `[S23]`; I could not date-stamp when each was added.
- **Library churn:** transformers.js 4.3.1 (2026-10-06), onnxruntime-web 1.30.0 (2026-09-18), WebLLM 0.2.86 (2026-10-11) `[S39]`; a public Whisper-tiny browser benchmark dated 2026-08-19 `[S32]`.
- **Not changed (negative findings, as of today's BCD main branch):** no on-device Web Speech on Chrome Android; no `processLocally` in Safari; Firefox only "preview" `[S20]`. WebKit's feature-blog index (Safari 27.0/27.1 posts) showed no Web Speech mention in titles/teasers, but I did not read the full release notes: **UNKNOWN** `[S51]`.
- Firefox "preview", and exact Chrome 150/151 dates: **UNKNOWN** (no dated source retrieved).

---

## 4. From free speech/text to structured blocks, on-device

### What I tested (local, 2026-10-24)
**chrono-node 2.10.3** (npm, modified 2026-10-12; README: Spanish "partial support") `[S46][S39]`, reference date Sat 2026-10-24, `forwardDate:true`, using the `es` parser:

| Input | Result |
|---|---|
| `entregar informe el 3 de noviembre` | Correct: 2026-11-03 |
| `el próximo lunes a las 9` | Correct: Mon 2026-10-26 09:00 |
| `dentista el viernes a las 5pm` | Correct: Fri 17:00 |
| `voy al gimnasio martes y jueves a las 7` | Two separate matches, "martes" (no time) and "jueves a las 7" (time attached to Thursday only); no 07:00 on Tuesday |
| `trabajo de lunes a viernes de 9 a 5` | "lunes" and "viernes de 9 a" split; end time lost, weekday range not expanded |
| `de 9 a 5` | "de 9 a" -> 09:00 only, end lost |
| `reunión mañana de 3 a 4 de la tarde` | Parsed as **03:00** tomorrow (wrong) and a separate "tarde" |
| `cena a las 8 de la noche` | **08:00** (wrong) |
| `tengo clase de inglés los miércoles de 6 a 8 pm` | 06:00 Wed + separate 20:00 (wrong, range broken) |
| `todos los días a las 6 am` | single date, recurrence ignored |
The `en` parser returned no match or wrong matches on Spanish, as expected. Conclusion: chrono-node is a good *absolute-date* extractor for Spanish and the wrong tool for *weekly recurrence* and *time ranges*.

**Throwaway deterministic grammar** (about 60 lines of JS, `proto.js` in the scratchpad; not a library recommendation). It expands "de X a Y" weekday ranges and "X y Z" day lists, parses "de H a H" and "a las H" times, applies shared meridiem ("6 a 8 pm" -> 18:00-20:00; "3 a 4 de la tarde" -> 15:00-16:00), splits clauses on "y voy/tengo/...", and flags "9 a 5" as `ambiguous:true`. On the owner's sentence it produced:
- `trabajo de lunes a viernes de 9 a 5` -> days 1-5, 09:00-17:00 (flagged ambiguous)
- `voy al gimnasio martes y jueves a las 7` -> days 2,4, 07:00 (am/pm not stated)
It first got the two shared-meridiem examples wrong too, which is the point: even the "easy" grammar needs explicit AM/PM rules and a confirm step. Not tested: spelled-out numbers ("nueve a cinco", "ocho y media", "menos cuarto"), regional phrasing, noisy ASR output, durations, or "tres veces por semana".

### What small local models do reliably (1-3B)
- **Structure is solvable, semantics are not guaranteed.** WebLLM integrates XGrammar for JSON-schema/grammar-constrained decoding with near-zero overhead (paper tests: Llama-3.1-8B laptop, Qwen2.5-0.5B phone) `[S45][S49]`. LLMStructBench (Feb 2026) reports prompting makes small models structurally valid but *increases semantic errors*, and prompt strategy mattered more than model size `[S44]`.
- **Size gap on tool use / instruction following (Meta model card):** Llama 3.2 1B vs 3B: BFCL V2 25.7 vs 67.0; IFEval 59.5 vs 77.4; MMLU-Spanish 41.5 vs 55.1; GSM8K 44.4 vs 77.7 `[S42]`. Spanish is an officially supported language for both `[S42]`. Qwen3-1.7B scored 28.4 overall on BFCL (function-calling mode, snapshot dated 2026-05-27) `[S43]`. Gemma 3 1B (prompt mode) 7.2: not comparable settings, but nothing suggests 1B-class models parse times dependably `[S43]`.
- **No evidence found** for Llama-3.2-1B (the model Next168 ships) on Spanish schedule extraction specifically: **UNKNOWN**. Recommendation includes a cheap eval to produce that number.
- **Chrome Prompt API (Gemini Nano)** supports `en, ja, es, de, fr`, JSON-schema `responseConstraint`, and states "No data is sent to Google or any third party", but needs Windows/macOS/Linux/Chromebook Plus, 22 GB free storage and a 4 GB+ VRAM GPU (or 16 GB RAM CPU); Android/iOS unsupported (page updated 2026-08-26) `[S41]`. Fine as an optional enhancement on desktop, not a baseline.

### Recommended hybrid (deterministic-first, LLM as assistant, human confirms)
1. **Normalize text** (lowercase, strip accents, digit-ify number words and "y media/cuarto/menos cuarto", map "mediodía/medianoche"). Same entry point for typed text and voice transcripts.
2. **Deterministic Spanish (and English) schedule grammar** for the closed domain: day sets and ranges (`de lunes a viernes`, `entre semana`, `fines de semana`, `todos los días`), time ranges and points, periods of day (mañana/tarde/noche) with shared-meridiem propagation, durations, and frequency. Output = list of `{label, days[], start, end?, evidence span, ambiguity[]}`. Each field carries its source span.
3. **chrono-node (es/en) only for absolute or relative dates** ("el 3 de noviembre", "el próximo lunes"). Do not use it for ranges or recurrence.
4. **Small LLM (the existing WebLLM model, XGrammar JSON schema) only for:** category suggestion from the label ("gimnasio" -> Health), splitting a long utterance into clauses when the grammar finds none, and phrasing the clarifying question. **Guardrail:** reject any LLM-proposed number/day that is not traceable to a span in the input or to an explicit user answer; validate with the app's schema (`ValidationService`).
5. **Ambiguity -> one question with chips**, not a guess: "9 a 5: 09:00-17:00?" [Yes] [09:00-05:00] [Edit]. Default the work-hours heuristic (end <= start -> end is PM) but still show it for confirmation.
6. **Always render the result as the reviewable proposal the app already has** (blocks highlighted on the week grid), with accept-all / edit / undo.
7. **Golden-corpus tests:** at least 100 Spanish utterances (es-CO/es-MX/es-ES) plus ASR-style variants (number words, missing accents, no punctuation) with expected blocks; run in CI; a change that regresses fails. Report exact-match rate for days, start, end per utterance.

---

## 5. Ranked recommendation and trade-offs

| Rank | Option | Why | Trade-offs / cost |
|---|---|---|---|
| 1 | **Chat-skinned stepper for onboarding + "describe your week" capture, with a persistent editable grid/summary** (Shake's structure, plus editable summary, inline errors, `role="log"`, reduced-motion) | Matches the owner's reference, supported by NN/G (text + buttons, flexible back/forward), Apple (fast/optional onboarding, choices over typing) and survey research; no ML dependency | Less "magical" than free chat; needs copy in 5 languages (app has es/en/fr/de/pt locales); grid must stay visible for heavy edits |
| 2 | **Deterministic-first parser, LLM as helper, human confirmation** (Q4 hybrid) | Only approach whose failures are bounded and testable; works offline; 1B LLM alone is not trustworthy for times `[S42]` | You own a grammar (about 1-2 weeks for es+en with tests); regional phrasing needs corpus growth |
| 3 | **Voice v1 = progressive enhancement**: feature-detect; Chrome/Edge desktop with `processLocally` + `available()`; elsewhere hint to use keyboard dictation; label each mode honestly | Cheapest honest path; zero model download; preserves the "no account, on-device" promise by *not* claiming it where unproven | No private voice on Android Chrome/iOS Safari; es-CO pack unknown; Chrome desktop status ambiguity |
| 4 | **Voice v2 = optional "private voice" pack** (lazy-loaded Whisper base/small int8 or Moonshine-ES via transformers.js/WebGPU, self-hosted) after a device benchmark | Only route to a true "never leaves your device" claim on phones | ~77 MB (base, WER 9.9% es) to ~250 MB (small, 5.6%); mid-range Android latency UNKNOWN; Moonshine license and web build unclear; battery/memory |
| 5 | LLM-first free chat (no grammar) | Most flexible | Highest hallucination risk with a 1B model; hard to test; poor on times; not recommended as the primary path |

Suggested sequencing: (1) and (2) together as the first deliverable; (3) in the same release as a small mic button; (4) as a measured spike with an explicit go/no-go (target: WER on a 50-utterance es-CO set, latency of a 10 s clip on a mid-range Android, download size); (5) rejected.

---

## 6. UNKNOWNs (and why)
- Shake runtime behavior (typing, animation timing, haptics, keyboard); store listings: page needs JS and no browser runtime was used; no matching listing found.
- Chrome's on-device language list and whether `es-CO` exists; whether on-device Web Speech is on by default in Chrome stable: no accessible primary page/status conflict in chromestatus.
- iOS Safari Web Speech audio path and PWA behavior; Apple Dictation language list: no primary Apple page retrievable.
- Mid-range Android latency/accuracy for browser Whisper/Moonshine (any language): no measured source; Moonshine Spanish web build and exact size/license applicability.
- Llama-3.2-1B accuracy on Spanish schedule extraction: no published number; must be measured.
- NN/g and Baymard guidance specific to conversational forms: neither published a dedicated study I could find; used adjacent NN/G chatbot and disclosure articles and Baymard's checkout research.
- Apple HIG has no chat or voice-input page I could retrieve; Material Design guidance on conversational capture: not found.

---

## 7. Sources (URL, source date, accessed)
Accessed date is 2026-10-24 for all rows. "snippet" means I only saw a search-result summary, not the full page.

| ID | URL | Source date |
|---|---|---|
| S1 | https://www.shakeapp.today/auth (and /) | n/a (shell) |
| S2 | https://www.shakeapp.today/assets/index-D2FLqyzR.js (production bundle) | 2026-10-24 download |
| S3 | https://www.nngroup.com/articles/chatbots/ | 2018-11-25 |
| S4 | https://www.nngroup.com/articles/prompt-controls-genai/ | 2024-08-02 |
| S5 | https://www.nngroup.com/articles/progressive-disclosure/ | 2006-12-03 |
| S6 | https://developer.apple.com/design/human-interface-guidelines/onboarding (read via developer.apple.com/tutorials/data/design/human-interface-guidelines/onboarding.json) | UNKNOWN |
| S7 | https://developer.apple.com/design/human-interface-guidelines/entering-data (same JSON route) | UNKNOWN |
| S8 | https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA23 | updated 2026-06-01 |
| S9 | https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html | WCAG 2.2 (2023) |
| S10 | https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html | WCAG 2.2 (2023) |
| S11 | https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion | MDN, current |
| S12 | https://baymard.com/blog/checkout-flow-average-form-fields (snippet) | 2024 |
| S13 | https://arxiv.org/abs/1905.10700 (Xiao et al., ACM TOCHI 27(3), 2020) | 2020 |
| S14 | https://doi.org/10.1145/3290605.3300316 (Kim, Lee, Gweon, CHI 2019) (snippet) | 2019 |
| S15 | https://uxplanet.org/ai-chat-or-not-if-its-a-form-it-should-stay-a-form-0294c59332d6 (snippet; fetch 403) | UNKNOWN |
| S16 | https://www.intercom.com/blog/?p=13649 (snippet; index page only) | UNKNOWN |
| S17 | https://www.hackceleration.com/typeform-review (snippet) | UNKNOWN |
| S18 | https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API | MDN, current |
| S19 | https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition | MDN, current |
| S20 | https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/SpeechRecognition.json | main branch, 2026-10-24 |
| S21 | https://developer.chrome.com/blog/new-in-chrome-139 | 2025-08-05 |
| S22 | https://groups.google.com/a/chromium.org/g/blink-dev/c/VNOok2dbmHM/m/TQpe9shjCgAJ | 2025-01-06 |
| S23 | https://chromestatus.com/api/v0/features?q=on-device%20web%20speech | live, 2026-10-24 |
| S24 | https://learn.microsoft.com/en-us/microsoft-edge/web-platform/speech-recognition-api | updated 2026-10-19 |
| S25 | https://github.com/WebKit/standards-positions/issues/443 | opened 2025-01-07; label 2025-04-11 |
| S26 | https://developer.apple.com/forums/thread/775699 | 2025-03 |
| S27 | https://blog.addpipe.com/apple-speechanalyzer-api/ (secondary; macOS 26 test) | UNKNOWN |
| S29 | https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/GPU.json | main branch, 2026-10-24 |
| S30 | https://huggingface.co/api/models/onnx-community/whisper-tiny/tree/main/onnx (also whisper-base, whisper-small, whisper-large-v3-turbo, moonshine-base-ONNX, distil-whisper/distil-small.en) | live, 2026-10-24 |
| S31 | https://arxiv.org/abs/2212.04356 (Whisper paper, Table 13 WER on Fleurs; Spanish tiny 15.9, base 9.9, small 5.6, medium 3.6, large-v2 3.0) | 2022-12 |
| S32 | https://makecaption.com/blog/whisper-tiny-in-browser-benchmark | 2026-08-19 |
| S33 | https://offlinetts.com/blog/browser-speech-recognition-whisper-comparison/ (unverified method) | 2026-04-28, upd. 2026-08-01 |
| S34 | https://github.com/nickwebt800/browser-whisper-benchmark (snippet) | UNKNOWN |
| S35 | https://github.com/moonshine-ai/moonshine | current |
| S36 | https://mintlify.wiki/moonshine-ai/moonshine/models/available-models (third-party mirror of Moonshine docs) | UNKNOWN |
| S37 | https://moonshine-voice.readthedocs.io/en/latest/moonshine-vs-whisper/ | current |
| S38 | https://dev.moonshine.ai/moonshine-js | current |
| S39 | npm registry (`npm view <pkg> version time.modified`): @huggingface/transformers 4.3.1, @mlc-ai/web-llm 0.2.86, onnxruntime-web 1.30.0, chrono-node 2.10.3, @moonshine-ai/moonshine-js 0.1.29 | 2026-10-24 |
| S40 | https://huggingface.co/blog/transformersjs-v4 (via search summary; v4 release 2026-02-09) | 2026-02-09 |
| S41 | https://developer.chrome.com/docs/ai/prompt-api | updated 2026-08-26 |
| S42 | https://github.com/meta-llama/llama-models/blob/main/models/llama3_2/MODEL_CARD.md | UNKNOWN (model card, Llama 3.2 release) |
| S43 | https://benchmarklist.com/models/qwen3-1.7b-5/ (BFCL snapshot) and https://benchmarklist.com/models/gemma-3-1b-it-3/ | 2026-05-27 |
| S44 | https://www.opentrain.ai/papers/llmstructbench-benchmarking-large-language-model-structured-data-extraction--arxiv-2602.14743/ (arXiv 2602.14743) | 2026-02 |
| S45 | https://arxiv.org/abs/2411.15100 (XGrammar) | 2024-11 |
| S46 | https://github.com/wanasit/chrono plus local test (chrono-node 2.10.3, Node 26) | 2026-10-24 |
| S47 | https://support.google.com/gboard/answer/11197787 (snippet: Assistant voice typing, Pixel 6+/Android 12+) | UNKNOWN |
| S48 | https://discussions.apple.com/thread/251999404 (2020, dated) and https://willowvoice.com/blog/apple-speech-to-text-iphone-dictation-guide (secondary, 2026-05-14); Apple primary page not retrievable | 2020 / 2026-05-14 |
| S49 | https://newreleases.io/project/npm/@mlc-ai/web-llm/release/0.2.81 (XGrammar structural tags) | 2026 |
| S50 | https://apps.apple.com/us/app/shake-social/id1509052946 and related (search results; none confirmed as this product) | n/a |
| S51 | https://webkit.org/blog/ (index only, Safari 27.0/27.1 post titles) | 2026-10-24 |
| S52 | https://caniuse.com/speech-recognition (summary only: Chrome Android partial, Safari iOS partial from 14.5, Firefox disabled by default) | live, 2026-10-24 |


Prepared for deliverable 2 (guided conversational UI and voice); see the scope note on #3.
