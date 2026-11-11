# Work Tracker

An institute-wide tracker for work beyond teaching: SOP duties, assigned tasks, contributions and follow-ups. Each person confirms the work recorded for them, adds evidence, and their Lead verifies it. Help requests and overdue work escalate up the reporting line, and management sees who needs help.

**Pages:** My work · Team · Needs help · Organisation (split by function, then team, then person, with a CFAL / School filter) · Weekly review (agenda built automatically, commitments recorded) · Workload · Priorities and decisions · Reports (any scope and period; print and CSV) · Recognition · Org chart · People & teams · SOP duties · Settings.

**Summaries:** daily digest for Owners, weekly summaries for every function and team, a term summary per person, and initiative reports. They are written by an AI if you connect one (Gemini, Claude or OpenAI), or from a template using the same facts if you don't.

- **Frontend:** a static site (this folder) hosted on GitHub Pages. Plain HTML, CSS and JavaScript, with no build step.
- **Backend:** Google Apps Script (`apps-script/`), storing everything in a private Google Sheet.
- **Login:** every person signs in with their own staff ID (or phone or email) and password. The backend checks the session on every request, so the public website shows nothing without signing in.
- **Demo mode:** a fictional organisation that runs entirely in the browser, for showing the tool. No real staff data is in this repository.

## Safety first: messages go only to your phone

The backend starts in **test mode**. In test mode:

- Every WhatsApp message goes **only to `TEST_PHONE`** (your number), labelled `[TEST → Name]` so you can see who it was meant for.
- No email is ever sent.
- Replies are accepted **only from `TEST_PHONE`**. Send `AS P012` to choose which staff member you are replying as.
- If `TEST_PHONE` is empty or WhatsApp is not set up, **nothing is sent at all**. Messages are kept in the `outbox` sheet and on the Settings page.

Staff are messaged only after you set the Script Property `SEND_MODE` to `live`. Do not do that until the pilot is approved.

## 1. Set up the Google Sheet and backend (about 20 minutes)

1. Create a new Google Sheet, e.g. "Work Tracker data". Share it only with the people who run the system.
2. In the sheet: **Extensions › Apps Script**. Delete the sample code.
3. Create four files in the Apps Script editor and paste in their contents:
   - `Code.gs` ← `apps-script/Code.gs`
   - `Core.gs` ← `apps-script/Core.gs`
   - `Insights.gs` ← `apps-script/Insights.gs`
   - `appsscript.json` ← `apps-script/appsscript.json` (first turn on **Project Settings › Show "appsscript.json" manifest file**)
4. **Project Settings › Script properties**, add:
   | Property | Value |
   | --- | --- |
   | `ADMIN_NAME` | Your name exactly as in the roster, or a new name |
   | `ADMIN_PASSWORD` | A temporary password, at least 8 characters |
   | `OWNER_NAMES` | e.g. `Asha Menon,Rahul Shenoy` (made Owners on import) |
   | `SEND_MODE` | `test` |
   | `TEST_PHONE` | Your own WhatsApp number, e.g. `9198XXXXXXXX` |
5. In the editor, choose the function **`setup`** and click **Run**. Approve the permissions. This creates all the sheets, including an empty **Roster** sheet.
6. Paste the staff roster into the **Roster** sheet: columns `Name, Grade, Designation, Entity, Reporting manager, Phone`. Phone is optional for now.
7. Run **`importRoster`**. Read the **Import issues** sheet. It lists people with a "Discontinued" manager, managers not in the roster, names that match several people, suggested team Leads, and missing WhatsApp numbers.
8. Run **`createAdmin`**. The log shows your staff ID. Then **delete `ADMIN_PASSWORD`** from Script properties.
9. **Deploy › New deployment › Web app**: Execute as **Me**, Who has access **Anyone**. Copy the URL ending in `/exec`.
   "Anyone" is needed so the GitHub site can reach the backend. The data stays protected: every request except sign-in needs a valid session token.
10. Run **`installTriggers`** to start the jobs: hourly escalation, the daily reminders and digest, and weekly summaries every Saturday at 16:00.

## 2. Put the website on GitHub Pages (about 10 minutes)

1. Create a GitHub repository and upload everything in this folder. The `.gitignore` keeps roster files out.
2. Edit `assets/config.js` and set `apiUrl` to the `/exec` URL from step 1.9.
3. **Settings › Pages**: Source **Deploy from a branch**, branch `main`, folder `/ (root)`. After a minute the site is at `https://<user>.github.io/<repo>/`.
4. Open the site and sign in with your staff ID and `ADMIN_PASSWORD`. You'll be asked to choose a new password.

GitHub Pages on a free account needs a **public** repository. That is fine here: the repository holds only code and fictional demo data. Real data lives only in your private Google Sheet and is returned only after sign-in. If you'd rather not show the demo, set `allowDemo: false` in `assets/config.js`.

## 3. First things to do in the app

1. **People & teams › Structure problems**: fix managers, home teams and Leads. Use **Edit** on a person to set their verifier (for example, a subject's senior lecturer instead of the academic administrator).
2. **People & teams › Teams**: confirm each team's Lead, Deputy, Team Admins and **function**. The import guesses the function from the team name.
3. **Priorities**: add 3–5 term priorities and their initiatives.
4. **SOP duties**: add the dated duties from the SOP, starting with the Administrators and AAs.
5. Give pilot users a temporary password: **People › person › Edit › Reset password**. Hand it to them in person; they choose their own when they first sign in.

## 4. Connecting an AI for summaries (optional, decide later)

Without an AI, every summary is written from a template using the same facts. To have an AI write them instead, add two Script properties:

| Property | Value |
| --- | --- |
| `AI_PROVIDER` | `gemini`, `claude` or `openai` |
| `AI_API_KEY` | The key from Google AI Studio, console.anthropic.com or platform.openai.com |
| `AI_MODEL` | Optional. Defaults: `gemini-2.5-flash`, `claude-haiku-5-5`, `gpt-4o-mini`. Check the provider's current model names |

What the AI receives: only facts the tracker has calculated for that summary, as JSON. That includes people's names, item titles, counts and help-request reasons, but no phone numbers or emails. It is told to use only those facts and to treat staff-typed text as data. If the AI call fails, the template summary is used and the summary is labelled that way. Each summary shows whether an AI or the template wrote it.

Settings › "Write term summaries for everyone" queues a term summary per person. The hourly job writes about 25 people an hour, to stay inside Google's time limits. Set **Term starts** in Settings first.

## 5. Connecting WhatsApp (Wati), still in test mode

1. In Wati, create an API token and note your API endpoint, e.g. `https://live-server-12345.wati.io`.
2. Create and get approval for one **utility template** with a single variable `{{1}}`, e.g. "Work Tracker: {{1}}". Messages outside WhatsApp's 24-hour window must use an approved template.
3. Script properties: `WATI_ENDPOINT`, `WATI_TOKEN`, `WATI_TEMPLATE`, `WATI_BROADCAST` (any name), and a random `WEBHOOK_KEY`.
4. In Wati, set the webhook for incoming messages to `<your /exec URL>?webhook=wati&key=<WEBHOOK_KEY>`.
5. Check the endpoint paths in `sendWhatsApp` in `Code.gs` against your Wati account's API documentation before relying on them.
6. Test from your phone. Reply `AS P012` to act as staff member P012, then `MY WORK`, `CONFIRM <code>`, `WRONG <code> <reason>`, `DONE <code> <link>`, `HELP <code> <reason>`, `ACK <code>`, `VERIFY <code>`.

## How it fits together

```
assets/core.js          All business rules (hierarchy, permissions, items, escalation, signals).
                        Runs in the browser AND, copied as Core.gs, in Apps Script.
assets/insights.js      Functions, summary facts, template summaries, AI prompts, weekly review agenda,
                        recognition. Also shared: copied as Insights.gs.
assets/app.js           The pages: My work, Team, Needs help, Organisation, Workload,
                        Priorities, Org chart, People & teams, SOP duties, Settings.
assets/api.js           Talks to Apps Script, or runs locally in demo mode.
assets/demo-data.js     Fictional sample organisation for demo mode.
apps-script/Code.gs     Web API, sign-in, Google Sheets storage, jobs, WhatsApp, roster import.
tools/build.sh          Copies core.js and insights.js into apps-script/. Run after editing either.
manifest.webmanifest    Lets staff add the site to their phone's home screen.
tests/                  Node tests: core rules, backend on fake Google services, UI in a simulated browser.
```

Run the tests with `npm test` (needs Node 18+ and `npm i -g jsdom` for the UI tests).

## Security notes

- Passwords are salted and hashed in a hidden `auth` sheet. After 8 wrong attempts, sign-in is locked for 15 minutes.
- Sessions last 6 hours from the last use.
- Who sees what is enforced on the server. Staff see their own work. Leads see the people below them and their teams. Owners see everything. Phone numbers are visible only to the System admin and HR.
- Every change to structure, roles, settings and items is logged (People & teams › Change log, and the `events` sheet).
- Anyone with edit access to the Google Sheet can see all data. Share the sheet only with the people who run the system.
- For stronger sign-in later, the Apps Script web app can be switched to Google accounts, if every staff member has a school Google account.

## Limits of this first version

- Photos sent on WhatsApp are not yet saved as evidence; staff send a link or a file name instead.
- The interface is in English only. WhatsApp messages are English too, for now.
- WhatsApp replies are typed commands, not tap buttons. Buttons need Wati's interactive message API and can be added later.
- Google Sheets handles a few hundred people and tens of thousands of items comfortably. Beyond that, move storage to a database.
