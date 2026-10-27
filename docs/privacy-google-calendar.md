# Weeklid and Google Calendar: privacy (draft)

Status: **draft for Google's OAuth verification**, not yet published. Google requires a privacy policy on the app's own domain (`weeklid.crexative.com`), linked from the OAuth consent screen and from the app, before the app leaves testing mode. This draft describes the read-only connection as built (Slice 1, `docs/calendars.md` § Google Calendar). The owner reviews it, a contact is added, and it is published as a page before verification is requested.

## 1. Who runs Weeklid

Weeklid is a local-first weekly planner by Crexative. Contact: _to be added by the owner (a monitored address)_.

## 2. What Weeklid reads, and why

When you connect Google Calendar, Weeklid asks Google for one permission:

| Permission | Google's scope | Why Weeklid needs it |
| --- | --- | --- |
| See events on your calendars | `https://www.googleapis.com/auth/calendar.events.readonly` | To show the busy time of your **primary** calendar next to your plan, mark conflicts with it, and fit your tasks around your meetings. |

From each event Weeklid asks only for: its id, status, title, start and end, whether it is marked free, its event type, your own response to it, and which recurring series it belongs to. It does **not** ask for guests' names or addresses, descriptions, locations, meeting links or attachments, and Google does not send them.

## 3. Read-only

Weeklid never creates, changes or deletes anything in your Google account.

## 4. Where your data goes

- Weeklid talks to Google **directly from your browser**. There is no Weeklid server: no Crexative system receives your token or your events.
- The access token and the events stay **in the memory of the browser tab** that connected. They are not written to the device (no browser storage, no database, no cache) and they disappear when you close or reload the tab.
- The only thing Weeklid keeps on the device for this feature is a flag saying that you turned the feature on.

## 5. What Weeklid does not keep

Guests, descriptions, locations, meeting links, your email address and your calendar's id are never requested or stored. Weeklid keeps no history of your events and no usage statistics about them.

## 6. AI features

- The optional on-device assistant runs in your browser. It receives your Google meetings only as busy time, labelled "Busy", without titles.
- "Use with your AI" builds a text that **you** copy and paste into an AI of your choice. Google meetings appear in it only as "Busy" with their times, without titles.
- Weeklid does not send your Google data to any AI service itself.

## 7. No sale, no ads, no transfer

Weeklid does not sell, rent or share your Google data, does not use it for advertising, and does not transfer it to anyone. Weeklid's use and transfer of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

## 8. Keeping and deleting

- **Disconnect** (Settings › Calendars › Google Calendar) forgets the events in every open Weeklid tab and asks Google to withdraw Weeklid's access. Weeklid tells you whether Google confirmed it.
- **Delete all data** (Settings › Your data) also forgets them.
- You can always remove Weeklid's access yourself at [myaccount.google.com/connections](https://myaccount.google.com/connections).
- Closing or reloading the tab drops the events and the token.

## 9. Changes

Changes to this page are dated here.

| Date | Change |
| --- | --- |
| 2026-10-27 | First draft (read-only primary calendar, memory only). |

## Before publishing (owner checklist, from the research notes)

- Add the contact and publish this page at `https://weeklid.crexative.com/privacy`, linked from the consent screen and from the app.
- Verify the brand and the domain (Search Console ownership of `crexative.com`), keep a public homepage, record an unlisted demo video of the consent flow and the scope in use, and write the scope justification. Plan for weeks of review.
