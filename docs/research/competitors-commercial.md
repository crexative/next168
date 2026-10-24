# Commercial weekly planners, time-blockers and time trackers: review for Next168

Epic: [#3](https://github.com/crexative/next168/issues/3) · Research date: 2026-10-24 (accessed) · Language: English

## 0. Method and confidence (read first)

- **Primary sources were NOT reachable.** In this run the sandbox blocked every direct fetch to vendor sites (pricing pages, changelogs, help centers: DNS/proxy 403). All findings below come from **web-search result summaries of third-party pages** (review sites, price trackers, and *competitor* blogs such as morgen.so, rize.io, jibble.io, cal.com). Nothing was verified against an official page.
- Legend: **[V-sec]** = stated consistently by 2+ independent secondary sources; **[S]** = single secondary source; **[VENDOR-COMP]** = comes from a competitor's marketing; **UNKNOWN** = not found, not guessed.
- Prices conflict heavily between sources; they are shown as ranges with the source type. Treat every number as "to re-verify on the vendor page before use". Streaks, Routine, Session, Apple Health sleep schedule and Apple Screen Time (iOS 26) returned no usable data: marked UNKNOWN.
- Per-product "what users praise/complain" is limited to what the summaries reported (Capterra/G2 aggregate scores, reviewer commentary). No Reddit/HN threads were retrievable.
- Next step for whoever continues: re-run this with unrestricted network access to fetch the official pages listed in section 7 and upgrade the confidence tags.

## 1. Summary

1. **The market is splitting in two.** Planners (Sunsama, Akiflow, Motion, Morgen, Structured, Tiimo) sell *daily ritual + calendar integration* at roughly $15–35/month, almost all subscription-only with trial-not-free-tier. Trackers (Toggl, Clockify, RescueTime, Rize, Timing) measure actuals. **Almost nobody closes the plan-vs-actual loop in one local, free product.** That is Next168's opening: it already has weekly hour budgets per category (the 168-hour frame), which none of the planners surveyed foregrounds.
2. **Features users value that are cheap to do locally:** a timeline/time-block view, an end-of-day/week shutdown review, workload warnings (don't overbook), per-task timers, natural-language capture, templates ("frames") and recurring blocks, and a plan-vs-actual comparison.
3. **What users dislike:** price creep and metered AI credits (Motion), trial-with-card-required and no free tier (Akiflow, Motion), opaque auto-rescheduling, product bloat, and vendor shutdowns that delete data (Clockwise, March 2026). Local-first, no-account, export-anywhere is a real differentiator.
4. **AI is shifting from "auto-scheduler" to "assistant you connect your own LLM to."** Akiflow ships a hosted MCP connector (Claude/ChatGPT/Cursor); a third-party MCP server for Sunsama exists; Morgen frames its AI as propose-then-approve. This matches Next168's "bring your own LLM" goal.
5. **Recommended top 3 for Next168:** (1) plan-vs-actual overlay on the 7-day grid, (2) a guided weekly review/shutdown ritual driven by the 168-hour budget, (3) quick-add natural-language capture (rule-based first, optional on-device LLM later).

## 2. Product table

| # | Product | Group | Problem solved | Plan vs actual | Weekly review | AI | Pricing (as found, unverified) | Platforms | Local-first / privacy | Praise / complaints (secondary) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Sunsama | Planner | Calm daily planning that pulls tasks from other tools | Time estimates vs calendar; workload warnings; no real actuals found | Evening "shutdown" ritual, weekly objectives [S]; dedicated weekly review UNKNOWN | AI time estimates, does not reschedule [VENDOR-COMP]; unofficial 3rd-party MCP server exists [S] | ~$20/mo yearly, ~$25 monthly, 14-day trial no card [VENDOR-COMP + aggregators] | Web, desktop, mobile | Cloud; local-first UNKNOWN | Praised: ritual. Complaint: price (inferred from competitor pricing posts only) |
| 2 | Akiflow | Planner | Inbox → time-blocked calendar, keyboard-first | Not found | Not found | "Aki" assistant + hosted MCP connector for Claude/ChatGPT/Cursor (June 2026 coverage); "Work with AI" handoff in v2.80 (Aug 2026) | Pro $34/mo monthly, ~$19/mo yearly (labelled promo), 7-day trial needing a card, no free plan; "Believer" 2- and 5-year prepay ($357.60 / $699); AI Meeting Assistant add-on $19/mo [aggregators, late Sep 2026] | Desktop, web, mobile | Cloud; UNKNOWN | Complaint pattern: card-required trial, long-term prepay tiers |
| 3 | Motion | Planner / auto-scheduler | AI auto-schedules tasks around meetings | Rescheduling engine moves tasks when plans slip | Not found | Core auto-scheduling; AI meeting notes; AI "employee" tiers $49–$599/mo; monthly AI credits with overage [VENDOR-COMP] | $29/mo annual, $49 monthly, no free tier, 7-day trial; Capterra 4.3/5 (89 reviews) | Web, desktop, mobile (G2: mobile 2.7/5 vs desktop 4.5/5) | Cloud; UNKNOWN | Praise: scheduling engine. Complaints: price increases, feature bloat, 2–4 week setup, trial billing disputes, metered AI |
| 4 | Reclaim.ai | Auto-scheduler | Protects focus/habits time on Google Calendar | Habits and tasks flex around meetings | Not found | Auto-scheduling; one review says Reclaim 2.0 no longer schedules individual tasks (undated) [S]; MCP: not found | Owned by Dropbox since Aug 2024 [S]; Free Lite, paid ~$8–18/user/mo depending on source (conflict) | Web, Google Calendar | Cloud | Offered price-match to ex-Clockwise users until 2026-06-30 [S] |
| 5 | Structured | Planner | Visual timeline day planner | Replan moves unfinished tasks forward (iOS) | Not found | Paid "AI tab" drafts/rearranges schedule from plain English [S] | Free core (timeline, subtasks, notes, widgets); Pro ~$6.99/mo, $29.99/yr, $99.99 lifetime (US, Aug–Oct 2026 review; older lifetime $29.99) | iOS, iPad, Watch, Mac, Android, web | Cloud sync UNKNOWN | Praise: free tier usable; one-time lifetime option |
| 6 | Morgen | Planner | Frames + AI planner across calendars/tasks | Reschedule / unschedule on conflict | Not found | AI Planner proposes, user approves; "never moves tasks without approval" [VENDOR] | $15/mo annual, $30 monthly, 14-day trial no card [vendor pages via search] | Mac, Win, Linux, mobile, web | Cloud | Positions against Motion's opaque autopilot |
| 7 | Amie | Planner | Calendar + to-do with polish | Not found | Not found | Pivoted toward AI note-taker; calendar "no longer a priority" (efficient.app, May 2026; nocal.app, Aug 2026) | ~$20–25/mo; free plan no longer listed [S] | Mac, Win, iPhone, no Android | Cloud | Pivot is itself a warning sign |
| 8 | Tweek | Weekly planner | Simple paper-style weekly view | Not found | Not found | None found | Free; Premium ~$2.83–4.17/mo (sources conflict) | Web, iOS, Android | Cloud | Closest UI analogue to Next168's week grid |
| 9 | Tiimo | Visual planner (ADHD) | Visual routines, gentle structure | Focus timer; visual timeline | Not found | AI task breakdown with duration estimates, "AI Co-Planner" [S] | Free (limited AI); Pro ~$7.99/mo or $79.99/yr; family $119.99/yr (7-day trial yearly only) | iOS, Android, web (paid) | Cloud; UNKNOWN | Praise: neuro-inclusive design |
| 10 | Llama Life | Timeboxing | One-day sequence of timed tasks | End time recalculates with your pace | Not found | None found | ~$6/mo [S, conflicts with $39 listing] | Desktop, iOS | UNKNOWN | Capterra: only 2 reviews, too thin |
| 11 | Fantastical | Calendar | Natural-language event entry, scheduling links | Not applicable | Not applicable | NLP entry; Claude connector for Mac calendar [S, thin] | Individual ~$4.75–6.99/mo; old Fantastical 2 buyers don't get new Premium features | Apple, Windows | Cloud accounts | Praise: NLP input |
| 12 | Notion Calendar (ex-Cron) | Calendar | Calendar with Notion DB items | Not applicable | Not applicable | UNKNOWN for 2026 | Free [S]; verify | Mac, Win, iOS, web | Cloud | Updates now folded into Notion "What's New" (Cron changelog) |
| 13 | Toggl Track | Time tracking | Manual and timer tracking, reports | Estimates vs tracked time (Starter) | Reports | UNKNOWN | Free tier + paid ~$9–10/user/mo (conflicting) | Web, desktop, mobile | Cloud | Sources conflict on invoicing |
| 14 | Clockify | Time tracking | Free-ish team time tracking | Estimates vs actual | Reports | UNKNOWN | **Free plan cut April 21, 2026**: 5 users max, features moved to paid, 30 req/hour API cap (CAKE.com announcement via Jibble) [S]; paid ~$4–12/seat/mo (June 2026 actiTIME page) | Web, desktop, mobile | Cloud | Free-tier retreat is a market signal |
| 15 | RescueTime | Auto tracking | Automatic app/website tracking and focus goals | Daily goals vs tracked | Weekly reports (generic knowledge, not re-verified) | UNKNOWN | New tiers Solo Focus / Solo+ (Timesheets); grandfathering to April 15, 2026 (community post, undated) | Win, Mac, mobile | Cloud | No shutdown found |
| 16 | Rize | Auto tracking | AI auto time tracker for focus sessions | Categorises automatically | Reports | AI categorisation | Basic $9.99, Pro $14.99, Team $19.99 or $39.99 (conflict), annual billing, 7-day trial [vendor] | Mac, Win | Claims no screenshots/keylogging, local processing first (vendor); independent reviewer says it tracks everything by default | Vendor pages dominate sources |
| 17 | Timing (macOS) | Auto tracking | Local automatic tracking incl. timeline | Timeline of what you did | Reports | UNKNOWN | Current price UNKNOWN (only a Dec 2025 $9.99 Mac App Store intro listing found) | macOS only | Data local by default, sync opt-in, drops private browser tabs | Praise: privacy |
| 18 | Daylio | Check-in | Mood/activity diary, no typing | Mood vs activities | Stats | None found | Free + Premium (~$5/mo / $36/yr per one source; another listing differs) | iOS, Android | Data stored on device; optional cloud backup | Praise: local data |
| 19 | Bearable | Check-in | Symptom/mood/habit correlations | Correlation insights (premium) | Insights | UNKNOWN | Free core; $6.99/mo or $34.99/yr, often discounted [vendor "Pricing and Principles"] | iOS, Android | Local-vs-cloud storage UNKNOWN | Paywalled stats and passcode lock are complaints |

Not reviewed with data (search returned nothing usable): **Streaks, Routine, Session, Apple Screen Time (iOS 26), Apple Health sleep schedule.** Apple Screen Time is cited only as a reference pattern: a weekly report of top apps/time, with Downtime schedules (older Apple support guides).

Shutdowns / pivots noted: **Clockwise shut down 2026-03-27** (Salesforce redirected team to Agentforce; features removed and user data deleted, not migrated; announced ~Mar 19–23) [multiple secondary]; **Amie** pivoted to AI notes; **Reclaim** reportedly reduced task scheduling in "2.0" [S]; **Clockify** removed unlimited free users.

## 3. Ranked shortlist for Next168 (local-first, free, no account)

Ranking weighs user value, fit with the 168-hour/category-limit model, and cost.

| Rank | Feature | Effort | AI needed |
|---|---|---|---|
| 1 | Plan-vs-actual overlay | M | No |
| 2 | Guided weekly review / shutdown ritual | M | No (AI optional) |
| 3 | Quick-add natural-language capture | S rule-based / M with LLM | Optional |
| 4 | Workload and over-commitment warnings | S | No |
| 5 | Block templates and recurring blocks ("frames") | M | No |
| 6 | Per-block focus timer that logs actuals | M | No |
| 7 | Unscheduled-hours "where did it go" view | S | No |
| 8 | "Replan" unfinished blocks | S | No |
| 9 | Propose-then-approve schedule suggestions | L | Yes |
| 10 | Bring-your-own-LLM connector (local MCP) | L | Yes (user's own) |
| 11 | One-tap check-in (mood/energy) per block | S | No |
| 12 | Full data export/import and backup | S | No |

**1. Plan-vs-actual overlay.** *Problem:* planners show intent, trackers show reality, nobody shows both. *Who:* Toggl/Clockify (estimates vs tracked), Sunsama (estimates), Timing (timeline of actuals), Llama Life (pace-adjusted end time). *Next168:* each time block gets an optional "actual" (start/end or minutes done/skipped); the grid draws planned as outline and actual as filled; category stats show planned vs actual vs weekly limit. All in localStorage via the existing repository interface; needs a type/storage migration.

**2. Guided weekly review.** *Problem:* the week resets with no reflection. *Who:* Sunsama (shutdown ritual, weekly objectives), Akiflow/Structured (UNKNOWN), Screen Time (weekly report pattern). *Next168:* a Sunday card flow: hours planned vs done per category against its limit, biggest overrun, unscheduled hours of the 168, three prompts (kept / drop / change), carry-forward button. Saved as a local note per ISO week; no notifications unless the user opts in.

**3. Natural-language quick add.** *Problem:* forms are slow, especially on mobile. *Who:* Fantastical (NLP), Structured AI tab, Tiimo (brain dump to plan). *Next168:* single input like "gym tue 7-8am" parsed by a deterministic parser per locale (en/es/fr/pt/de); falls back to the form with fields pre-filled. LLM-assisted parsing only as optional enhancement.

**4. Over-commitment warnings.** *Who:* Sunsama workload warnings, Morgen conflict handling. *Next168:* extend existing limit validation into a non-blocking day-level "you planned 14h" and category-near-limit hint; calm wording, no push notifications.

**5. Templates and recurring blocks.** *Who:* Morgen Frames, Structured Pro recurring, Llama Life presets. *Next168:* "save this day/week as template" and recurring blocks generated locally; one-click apply to a new week; respects limits and overlap validation.

**6. Focus timer logging actuals.** *Who:* Llama Life, Tiimo, Session-style timers (Session itself UNKNOWN). *Next168:* start a timer on a block; stop writes the actual (feeds #1). Works offline; no sound spam by default.

**7. Unscheduled/"where did it go" view.** *Who:* Rize, RescueTime, Timing timelines. *Next168:* stats card that shows the remainder of the 168 hours (sleep/unassigned) and week-over-week change per category. Mostly reuses `unscheduledHours` and chart code.

**8. Replan.** *Who:* Structured Replan, Motion/Reclaim reschedule. *Next168:* manual "move unfinished to next free slot" with a preview; deterministic, explainable, no hidden auto-moves.

**9. Propose-then-approve AI suggestions.** *Who:* Morgen (approval before booking), Motion/Reclaim (auto). *Next168:* optional on-device model proposes a block layout as a diff the user accepts or rejects; never edits silently. Effort L because of model loading, prompt design and validation. Depends on the on-device AI epic.

**10. Bring-your-own-LLM connector.** *Who:* Akiflow hosted MCP (Claude/ChatGPT/Cursor), unofficial Sunsama MCP. *Next168:* because there is no backend, a hosted MCP is impossible; options are a local MCP bridge or a copy/paste "export week as JSON + prompt" first, with read-only default and explicit confirmation for writes. Needs its own spike; here only flagged.

**11. One-tap check-in.** *Who:* Daylio, Bearable. *Next168:* after a block ends, optional emoji for energy or satisfaction stored with the block; surfaces in the weekly review as "which categories drained you". Stays local, opt-in.

**12. Export/import and backup.** *Who:* Daylio (local data, backups), response to Clockwise-style data loss. *Next168:* JSON export/import and a visible "your data never leaves this device" statement.

## 4. Anti-patterns to avoid (from the sources above)

- **Forced subscription and card-required trials with no free tier** (Akiflow, Motion). Next168 stays free, no account.
- **Metered AI credits and overage billing** (Motion). Use on-device or the user's own LLM.
- **Opaque auto-rescheduling** vs propose-then-approve (Morgen's stated positioning; Reclaim reportedly retreated). Always show a diff.
- **Price creep and tier proliferation** (Motion "AI Employee" tiers, Structured lifetime price tripling, Clockify free-tier cut).
- **Feature bloat** drifting from the core (Motion docs/sheets; Amie to notes).
- **Vendor death deletes data** (Clockwise, March 2026). Ship export; keep data in the user's browser.
- **Paywalling basic insight or privacy** (Bearable stats and passcode in premium).
- **Notification spam** and **long setup periods** (Motion 2–4 weeks, per reviewers). No specific notification-spam source was retrieved; treat as a design principle, not a sourced finding.
- **Mobile worse than desktop** (G2 Motion split). Next168 is mobile-first already; keep parity.

## 5. What changed in the last 3 months (≈ 2026-07-23 to 2026-10-23)

Confirmed only where a dated secondary source exists; otherwise labelled.

- **Akiflow:** releases 2.79 and 2.80 in August 2026 (mobile navigation rework, "Work with AI" handoff, task locations); late-September FAQ added Believer 2-/5-year prepay tiers; Sept 2026 LinkedIn preview of attachments [S, aggregator]. Hosted MCP connector covered in June 2026 (just outside the window).
- **Clockify:** free plan reduction was April 2026 (outside the window); a possible new plan on 2026-08-29 is **unverified**.
- **Structured:** a US review dated Aug–Oct 2026 shows lifetime at $99.99; App Pricing Lab shows a yearly SKU change on 2026-04-01 (outside window) [S].
- **Amie:** AI-notetaker repositioning visible Aug 2026 (nocal.app) [S].
- **Claude "Duet" (assistant that messages you first)** reportedly launched 2026-10-21 per one blog (saner.ai). **Single non-official source; unverified, do not rely on it.**
- **Reclaim "2.0"** no longer scheduling single tasks: undated, so cannot be placed in the window.
- **Market-wide:** MCP moved to the Linux Foundation's Agentic AI Foundation in Dec 2025 and "MCP Apps" in Jan 2026 (outside window, context). Calendar/planner vendors adopting MCP is the visible trend.
- **Everything else (Sunsama, Motion, Toggl, RescueTime, Rize, Timing, Tiimo, Daylio, Bearable): no change in the window found. UNKNOWN whether none occurred; official changelogs could not be fetched.**

## 6. Open questions for the owner

1. Is a copy/paste (export week + prompt) acceptable as the first LLM integration, ahead of a local MCP bridge?
2. Should "actual" be recorded per block (manual or timer) or only as free-form daily check-ins?

## 7. Sources (all accessed 2026-10-24 via web search summaries; publication dates only where shown)

Official pages to verify next (NOT fetched, blocked): sunsama.com/pricing, akiflow.com/changelog and /pricing, usemotion.com/pricing, reclaim.ai/pricing, structured.app, toggl.com/track/pricing, rescuetime.com/pricing, timingapp.com, clockify.me/pricing, tweek.so, tiimo.app, llamalife.co, flexibits.com, daylio.net, bearable.app/pricing.

Secondary pages used:
- Sunsama pricing: https://www.morgen.so/blog-posts/sunsama-pricing (competitor; 2026); https://subger.com/en/service/sunsama (updated July 2026); https://www.capterra.com/p/145616/Sunsama/pricing/
- Sunsama MCP (unofficial): https://www.gamut.so/mcp/project-management/sunsama
- Akiflow: https://pricingsaas.com/companies/akiflow/diffs/2026W40 (late Sep 2026); https://www.usecarly.com/blog/akiflow-pricing/; https://kingy.ai/news/akiflow-mcp-guide/ (June 2026); https://chatgate.ai/post/akiflow
- Motion: https://www.morgen.so/blog-posts/motion-review (competitor); https://www.capterra.co.uk/software/214264/motion; https://www.getapp.com/emerging-technology-software/a/motion/
- Reclaim: https://pricingsaas.com/companies/reclaim; https://usagepricing.com/blueprint/reclaim-ai; https://subger.com/en/service/reclaim-ai
- Clockwise shutdown: https://doodle.com/en/clockwise-is-shutting-down-what-to-do-next-in-2026/; https://www.usecarly.com/blog/is-clockwise-shutting-down/; https://cal.com/blog/clockwise-alternative (all competitor/aggregator)
- Structured: https://apps.apple.com/app/apple-store/id1499198946; https://toolradar.com/tools/structured/pricing; https://apppricinglab.com/iap/apple/1499198946
- Morgen: https://www.morgen.so/blog-posts/reclaim-ai-alternatives; https://morgen.so/blog-posts/motion-pricing
- Amie: https://efficient.app/apps/amie (updated May 2026); https://nocal.app/alternatives/amie (updated Aug 2026); https://feedback.amie.so/p/there-should-be-tiered-pricing-for-users-who-only-want
- Tweek: https://morgen.so/blog-posts/tweek-vs-teuxdeux (re-verified April 2026 per vendor); https://www.trustradius.com/products/tweek/pricing
- Tiimo: https://apps.apple.com/app/tiimo/id1480220328; https://lifestack.ai/blog/tiimo-pricing
- Llama Life: https://www.capterra.com/p/253326/Llama-Life/; https://us.fitgap.com/products/043664/llama-life
- Fantastical: https://www.morgen.so/blog-posts/fantastical-pricing; https://subscribed.fyi/fantastical/reviews/
- Notion Calendar: https://cron.com/changelog; https://efficient.app/apps/notion-calendar
- Toggl: https://www.capterra.com/p/247745/Toggl/pricing; https://www.timecamp.com/blog/what-is-toggl-track/ (updated July 2026); https://www.actitime.com/software-collections/toggl-pricing
- Clockify: https://www.jibble.io/news/changes-clockify-free-pricing-users-impact (competitor; reports CAKE.com announcement of 2026-04-21); https://www.actitime.com/software-collections/clockify-pricing (June 2026); https://costbench.com/changelog/clockify-plan-added-2026-08/ (unverified)
- RescueTime: https://community.rescuetime.com/t/future-pricing-changes/1631 (undated in results); https://www.capterra.com/p/103317/RescueTime/
- Rize: https://rize.io/blog/rize-vs-timely; https://rize.io/best/privacy-first-time-tracking-software-2026 (vendor); https://dhruvirzala.com/rize-review/ (independent)
- Timing: https://timingapp.com/presskit/; https://www.iclarified.com/entry/index.php?enid=19247 (Dec 9, 2025); https://dev.to/airabbit/the-great-time-tracking-showdown-6-tools-put-to-the-test-191
- Daylio / Bearable: https://intuitionlabs.ai/software/telepsychiatry-digital-mental-health/mood-tracking-and-journaling/daylio; https://makeheadway.com/blog/daylio-review/; https://bearable.app/blog/pricing-and-principles/; https://www.choosingtherapy.com/bearable-app-review/
- Screen Time (reference only): https://support.apple.com/en-au/guide/ipad/ipad1a175601/ios
- AI market: https://blog.saner.ai/best-ai-calendar/ (Claude Duet claim, unverified); https://flowsavvy.app/ai-calendar-apps (Reclaim 2.0 claim); https://mcpplaygroundonline.com/blog/mcp-2026-roadmap-whats-changing-for-developers.md
