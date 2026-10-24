# Integration verifier fixes (D1–D12)

Fixes for the defects found by the independent verification of a93aab7. Each has a regression test that fails when the fix is reverted.

| Defect | Fix | Test |
| --- | --- | --- |
| D1 conflicting events hidden under blocks | `DayColumn.vue`: events stack above blocks; conflicting ones take the right of the column | `e2e/calendars.spec.ts` (`elementFromPoint` on title and Conflict mark) |
| D2 raw JSON in proposal review | `changeSummary.ts` + review sheet; JSON behind Details | `review.spec.ts` |
| D3 Settings gutter | `calendars.css`, `AssistantSettings.vue` | `e2e/calendars.spec.ts` (side gutter) |
| D4 tasks ignore calendar events | `TasksView.vue` uses the shared external occurrences | `TasksView.spec.ts` |
| D5 first task in Sleep | `defaultTaskTemplateId` | `templates.spec.ts`, `e2e/plan-measure.spec.ts` |
| D6 download failure says offline | `network` failure code and retry action | `WebLlmProvider.spec.ts`, `AssistantView.spec.ts` |
| D7 enable-model advice without WebGPU | `modelAvailability` in the ask context | `RulesProvider.spec.ts`, `useAssistant.spec.ts`, `e2e/assistant.spec.ts` |
| D8 tab scroll offset | `AppShell.vue` scrolls to top after leaving a view | `e2e/shell.spec.ts` |
| D9 day-strip names | `DayPager.vue` names start with the visible text | `e2e/today-week.spec.ts` (axe) |
| D10 stale MCP description | `companion/src/mcp.ts` | `companion/test/server.test.ts` |
| D11 article agreement | `tasks.overflowHint` in 5 locales | `messages.spec.ts` |
| D12 stray "10" paragraph | answer schema requires a sentence | `WebLlmProvider.spec.ts` |
| Overlay flash on refresh | `externalOccurrences.ts` keeps the previous list | `externalOccurrences.spec.ts` |
