# Weeklid and Google Calendar: privacy (draft)

Status: **draft for Google's OAuth verification**, not yet published. Google requires a privacy policy on the app's own domain (`weeklid.crexative.com`), linked from the OAuth consent screen and from the app, before the app leaves testing mode. This draft describes the read-only connection as built (Slice 1 and the permanent connection of slice S1b, `docs/calendars.md` § Google Calendar). The owner reviews it, a contact is added, and it is published as a page before verification is requested.

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

- **Your events** go from Google straight to your browser. They never pass through a Weeklid server, and Weeklid never stores them on a server.
- **The permission** Google gives Weeklid (a refresh token, which lets Weeklid ask Google for a short-lived access token) is kept by a **Weeklid server** (Cloudflare Pages Functions and a Cloudflare D1 database), **encrypted**, one per device, so you stay connected after closing Weeklid. The server stores that encrypted permission, a random identifier for the device and the dates it was created and last used. It never receives your events, titles, address or calendar, and it logs only the name of the route, a result code, the status and the duration of each request.
- **The device** holds a random identifier in a cookie that only Weeklid can read, and the browser keeps the short-lived access token **in memory** only: it disappears when you close or reload the tab.
- **No copy of your events is saved on your device**, in any browser, installed app or in-app browser of a build that uses the Weeklid server. Each time you open Weeklid it asks the server for an access token and reads your events again from Google. **Without internet, Google events are not shown**, and an AI prompt made offline carries no Google meetings. A copy saved by an earlier version is deleted the first time this version opens.
- Besides that, Weeklid keeps on the device only a flag saying that you turned the feature on.

## 5. What Weeklid does not keep

Guests, descriptions, locations, meeting links, your email address and your calendar's id are never requested or stored. Weeklid keeps no copy of your events, no history of them and no usage statistics about them.

## 6. AI features

- The optional on-device assistant runs in your browser. It receives your Google meetings only as busy time, labelled "Busy", without titles.
- "Use with your AI" builds a text that **you** copy and paste into an AI of your choice. Google meetings appear in it only as "Busy" with their times, without titles.
- Weeklid does not send your Google data to any AI service itself.

## 7. No sale, no ads, no transfer

Weeklid does not sell, rent or share your Google data, does not use it for advertising, and does not transfer it to anyone. Weeklid's use and transfer of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

## 8. Keeping and deleting

- **Disconnect** (Settings › Calendars › Google Calendar, needs internet) deletes this device's permission from the Weeklid server and asks Google to withdraw Weeklid's access, then forgets the events in every open Weeklid tab. Weeklid tells you whether Google confirmed it. Google's revocation covers **the whole Google account** for Weeklid: if you connected Weeklid with the same account on other devices, they have to connect again.
- **Delete all data** (Settings › Your data) first asks the server to delete this device's permission (other devices keep theirs), then deletes your data on the device. Without internet or without the device identifier, Weeklid says what could not be done and links to the page where you remove its access.
- You can always remove Weeklid's access yourself at [myaccount.google.com/connections](https://myaccount.google.com/connections). A permission left on the server that nothing can use any more (for example after clearing this site's data in your browser) is deleted after 190 days without use.
- Closing or reloading the tab drops the access token; the permission stays on the server until one of the above.

## 9. Changes

Changes to this page are dated here.

| Date | Change |
| --- | --- |
| 2026-10-27 | First draft (read-only primary calendar, memory only). |
| 2026-10-27 | The last complete read is kept on the device so it shows when Weeklid opens again; the token still stays in memory only (§4, §8). |
| 2026-11-06 | Slice S1b: a Weeklid server keeps Google's permission, encrypted, one per device, so you stay connected; events are never stored on the server or on the device, and Disconnect is account-wide (§4, §5, §8). |

## Before publishing (owner checklist, from the research notes)

- Add the contact and publish this page at `https://weeklid.crexative.com/privacy`, linked from the consent screen and from the app.
- Verify the brand and the domain (Search Console ownership of `crexative.com`), keep a public homepage, record an unlisted demo video of the consent flow and the scope in use, and write the scope justification. Plan for weeks of review.
