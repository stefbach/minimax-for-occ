/**
 * Contextual help registry.
 *
 * Each entry is keyed by a stable "contextKey" used by the <HelpButton/> in
 * page headers. The drawer picks the role-specific markdown if available,
 * otherwise falls back to `default`.
 *
 * Markdown is rendered by `lib/help/markdown.tsx`. Supported syntax:
 *   ## Heading 2 / ### Heading 3
 *   - bullet
 *   1. numbered list
 *   > blockquote
 *   `inline code` / ``` fenced code ```
 *   **bold**  *italic*  [link text](href)
 *
 * Authoring guidelines for each contextKey (default + role variants):
 *   - Start with a one-sentence intro that explains the page in plain English.
 *   - Then sections: "What this page is for", "How to use it",
 *     "Best practices", "Typical use case", "Pitfalls to avoid",
 *     "Useful links".
 *   - Role variants reuse the same skeleton but adjust scope (read-only vs
 *     editable, etc.) and call out role-specific actions.
 */

export type HelpRole =
  | "super_admin"
  | "admin"
  | "manager"
  | "supervisor"
  | "agent";

export type HelpEntry = {
  title: string;
  default: string;
  super_admin?: string;
  admin?: string;
  manager?: string;
  supervisor?: string;
  agent?: string;
  /** Optional link appended at the bottom as "Learn more". */
  learnMoreHref?: string;
};

/**
 * Resolve the "Learn more" URL for a context key. We now point to the in-app
 * `/help` page (rendered from `docs/USER_GUIDE.md`) with an anchor matching
 * the context key. This avoids the 404 we had when linking to
 * `/docs/USER_GUIDE.md` (Next does not serve files from the repo root).
 */
export function docHref(contextKey: string): string {
  return `/help#${contextKey}`;
}

export const HELP: Record<string, HelpEntry> = {
  // ──────────────────────────────────────────────────────────────────────
  // DASHBOARD
  // ──────────────────────────────────────────────────────────────────────
  dashboard: {
    title: "Dashboard",
    learnMoreHref: docHref("dashboard"),
    default: `## Dashboard
A real-time overview of your voice contact centre's activity.

## What this page is for
- Spot **ongoing incidents** at a glance (queue saturation, blocked AI agent, quality alert).
- Track **vital KPIs**: active calls, answer rate, average duration, satisfaction.
- Visualise active **outbound campaigns** and their progress.
- Quickly access **alerts** that require action.

## How to use it
1. Hover over the **KPI cards** at the top: each value shows a trend (▲ / ▼) compared to yesterday.
2. Click **"Queues"** to open the detailed queue view.
3. Click a **red alert** to open the incident record and acknowledge it.
4. Use the **period selector** (top right) to compare Today / 7d / 30d.

## Best practices
- Keep this page open on a **second screen** during business hours.
- If **average duration** climbs above 4 min for no obvious reason, check the AI agent prompts first — it's often a conversational loop.
- Watch the **abandon rate**: above 5%, add staffing or activate automatic callback.

## Typical use case
You arrive in the morning → you open the dashboard → the "Alerts" card shows **3 open alerts** → you click, handle all 3 (false positive, number resting, queue opening), then the dashboard returns to green for the day.

## Pitfalls to avoid
- Don't confuse "calls in progress" (live) with "calls today" (cumulative).
- KPIs are **calculated using the organisation's timezone** — check it in Settings if the numbers look off.
- "Satisfaction" figures only appear if the post-call SMS is enabled on the campaign.

## Useful links
- [Alerts](/alerts) to handle incidents
- [Analytics](/analytics) to drill into a KPI
- [Live calls](/calls) to watch conversations in real time`,

    agent: `## My dashboard
Your personal view: what you've done today and what's coming up.

## What this page is for
- See your **calls** at a glance: handled, in progress, to call back.
- Track **your performance** (average duration, qualification rate) and compare yourself to the team average.
- View the **campaigns** you're assigned to and your daily quota.
- Read **messages** or instructions left by your supervisor.

## How to use it
1. Check your **status** at the top (🟢 Available / 🟡 On break). You'll only receive calls when you're Available.
2. Click a call in **"To call back"** to open the record and schedule the callback.
3. Click **"My desk"** to go to the softphone and take or place a call.

## Best practices
- Before taking a break, switch your status to **🟡 On break** so your colleagues don't get the calls.
- **Scheduled callbacks** appear at the top when the time approaches — be available 5 min beforehand.

## Typical use case
9:00 am → you log in → the dashboard shows **2 callbacks scheduled for the morning** + **1 supervisor message** ("prioritise VIP-tagged leads") → you handle the callbacks first.

## Pitfalls to avoid
- If you stay **Available** during a break, you block the queue and generate abandoned calls.
- Don't close the browser without switching to **Unavailable** — the routing might keep sending you calls.

## Useful links
- [My desk (softphone)](/desk)
- [My contacts](/contacts)`,

    supervisor: `## Supervisor dashboard
Manage your team in real time and step in where things get stuck.

## What this page is for
- See who is **online**, on break, or on a call among your agents.
- Monitor the **live queue** and anticipate saturation.
- Receive **team alerts** (call too long, negative sentiment, escalation).
- Continuously measure your team's **SLA and quality**.

## How to use it
1. Identify **agents with alerts** (highlighted in orange / red) in the top grid.
2. Click a red call in the "Active calls" list to open the supervision panel (listen / whisper / barge).
3. Use **"Live coaching"** to discreetly prompt a junior agent.
4. Filter by **queue** if you manage multiple teams.

## Best practices
- **Whisper** rather than barge when the agent is coping — taking over directly undermines the client's trust.
- Log coaching notes in **"LLM Analysis"** after each call to track an agent's progress.
- Set up **threshold alerts** (Alerts → Rules) to be notified as soon as a call exceeds N minutes.

## Typical use case
An agent goes over 8 min on a call → red card on the dashboard → you open the call → discreet listen for 30 sec → you identify a pricing sticking point → whisper "offer a 10% goodwill discount" → the agent wraps up, the customer is satisfied.

## Pitfalls to avoid
- **Barge** is heard immediately by both parties — don't do it without warning the team.
- Too many whispers cause the agent to lose track of the client; step in only at key moments.

## Useful links
- [Live calls](/calls)
- [LLM Analysis](/analyses)
- [Alerts](/alerts)`,

    manager: `## Manager dashboard
Strategic view of your department's performance.

## What this page is for
- Track **volume** (inbound / outbound / conversion) over 7, 30, or 90 days.
- Monitor **costs**: minutes consumed, cost per lead, campaign ROI.
- Measure **quality**: average sentiment, AI compliance scoring, NPS.
- Identify **trends** to present in committee meetings.

## How to use it
1. Choose the **period** (top-right selector) — 30d is a good weekly default.
2. Click a **KPI** to open the detail in Analytics.
3. Click **"Export"** to download a CSV for your committee.
4. The **"Top campaigns"** widget links directly to the best-performing campaigns.

## Best practices
- Systematically compare to the **previous period** (toggle "vs N-1") to spot drift.
- If you run many campaigns, set a **target cost per lead** and adjust speed / script if you go over it.
- Hold a weekly review **comparing quality (sentiment) and volume**: an agent doing more volume but less quality isn't necessarily creating value.

## Typical use case
Monday morning committee → you export the "last 30 days" CSV → you notice the "B2B Follow-up" campaign has a cost per lead 2× the target → you ask the admin to revise the script.

## Pitfalls to avoid
- Don't draw conclusions from **fewer than 50 calls** per segment: too much variance.
- Twilio costs fluctuate by country — compare on a like-for-like country basis.

## Useful links
- [Analytics](/analytics)
- [Campaigns](/campaigns)
- [AI Manager Copilot](/admin/copilot)`,

    admin: `## Admin dashboard
Technical and operational health of your organisation.

## What this page is for
- Check **infrastructure** status: Twilio, n8n, Supabase, LLM/TTS providers.
- Track **quotas**: remaining minutes, API credits, RAG storage.
- Monitor **security**: failed login attempts, recent access, modified roles.
- Anticipate **billing** for the current cycle.

## How to use it
1. If an **infra status** indicator is red, click it to open the detail (provider, error code).
2. If the **minutes quota** drops below 20% before the end of the cycle, open Billing → upgrade the plan.
3. Click **"Audit log"** to review sensitive actions from the last 7 days.

## Best practices
- Set up **threshold alerts** (Alerts → Rules) for quotas (e.g. alert at 80% consumption).
- Check **number health** (Numbers → Health) at least once a week.
- Keep an eye on **pending invitations**: a member who doesn't activate their account within 7 days will have their link expire.

## Typical use case
Friday evening, you notice **n8n is red** → you click → 502 error on the instance → you restart it from Admin → Connectors and the indicator turns green again.

## Pitfalls to avoid
- **Quotas** reset on the subscription anniversary date, not on the 1st of the month.
- Never delete an active member without **reassigning their contacts** first.

## Useful links
- [Administration](/admin)
- [Billing](/admin/billing)
- [Number health](/numbers/health)
- [Settings](/settings)`,

    super_admin: `## Super-admin dashboard
Multi-tenant management of the Axon platform.

## What this page is for
- Have a **consolidated view** across all organisations.
- Monitor **platform capacity**: system queues, delayed jobs, providers.
- Measure **revenue** (MRR, churn, expansion) in aggregate.
- Receive **global incidents** (provider outage, degradation).

## How to use it
1. Use the **org switcher** in the top right of the sidebar to switch to the relevant org.
2. Click **"Organisations"** for detailed management (creation, suspension, quotas).
3. Click **"Copilot"** to query the platform in natural language.

## Best practices
- Do a **weekly review** of organisations at the bottom of the leaderboard (low usage = churn risk).
- Set up **incident playbooks**: if a provider goes down, what do we switch, to what, in how long?

## Typical use case
Twilio announces maintenance in 4h → you filter **orgs > 100 minutes/day** → you send them an information message → you switch to degraded mode (pool rotation).

## Pitfalls to avoid
- Don't suspend an org without warning its owner: suspension is immediate.
- The **super_admin role** gives access to all data — use it with care (every action is logged).

## Useful links
- [Organisations](/admin) with switcher
- [Super Admin Copilot](/admin/copilot)
- [Connectors](/admin/inbound)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // ANALYTICS
  // ──────────────────────────────────────────────────────────────────────
  analytics: {
    title: "Analytics",
    learnMoreHref: docHref("analytics"),
    default: `## Analytics
Explore call and campaign data in depth to steer your business.

## What this page is for
- Measure **volume** by direction (inbound / outbound), by agent, by queue.
- Track **quality**: duration, qualification rate, sentiment, compliance.
- Compare **periods** or **segments** to identify what works.
- **Export** your data to Excel / your BI tool for advanced analysis.

## How to use it
1. Choose the **period** (top right) — Today, 7d, 30d, or a custom range.
2. Refine with **filters**: direction, agent, campaign, queue, status, language.
3. Hover over the charts to see **details** per data point.
4. Click a **segment** (e.g. "campaign X") to open its detailed record.
5. **"Export"** button → CSV or PDF.

## Best practices
- To compare "AI agent" vs "human agent", filter in two passes and export each one.
- Cross **sentiment × AI agent** to spot prompts that irritate — often just 1-2 poorly worded sentences.
- Save your **favourite filters** as browser bookmarks (the URL contains the full state).

## Typical use case
The CEO asks "how much does a qualified lead cost in the Summer campaign?" → you filter campaign = Summer, status = qualified → divide total cost / number of leads → you have the answer in 30 seconds.

## Pitfalls to avoid
- **Billed minutes** include ringing time; **talk time** does not. Choose the right KPI for what you're measuring.
- **Sentiment** depends on the LLM model used; a model change can shift figures by a few %.

## Useful links
- [Calls](/calls) to see call-by-call detail
- [LLM Analysis](/analyses) for automated post-call analysis
- [Campaigns](/campaigns)`,

    agent: `## My analytics
Your personal activity statistics.

## What this page is for
- See the number of **calls you've handled** over the period.
- Measure your **average duration** and **qualification rate**.
- **Compare yourself to the team average** (without naming other individuals).
- Identify your strengths (AI → human handoff rate handled, satisfaction).

## How to use it
1. Choose the **period**.
2. Check your **personal KPIs** at the top.
3. The chart below shows your **trend over 30 days**.

## Best practices
- If your **average duration** drifts upward, it's often a sign of fatigue or complex cases — talk to your supervisor.
- A **qualification rate** below the team average doesn't mean you're underperforming: it may reflect a harder mix of calls.

## Pitfalls to avoid
- Don't compare your week to a colleague's: you may not have handled the same types of call.

## Useful links
- [My desk](/desk)
- [My contacts](/contacts)`,

    manager: `## Manager analytics
Detailed view for running your department.

## What this page is for
- Measure the performance of **each agent** (human and AI) over the period.
- Compare **campaigns** against each other (conversion, cost, duration).
- Identify **queues** that are saturating.
- Build your **weekly / monthly reports**.

## How to use it
1. Period + filters (agent, campaign, queue).
2. **"Agents"** tab: leaderboard with quality score, volume, satisfaction.
3. **"Queues"** tab: SLA, abandon rate, average wait time.
4. **"Campaigns"** tab: ROI, cost per lead.
5. **Export** to CSV for Excel or PDF for a report.

## Best practices
- Run a **weekly committee** on the same 2-3 KPIs (volume + quality + cost) to stay comparable.
- When a KPI degrades, drill down **by segment** before drawing conclusions: it's rarely uniform.

## Useful links
- [LLM Analysis](/analyses)
- [Campaigns](/campaigns)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // CALLS
  // ──────────────────────────────────────────────────────────────────────
  calls: {
    title: "Calls",
    learnMoreHref: docHref("calls"),
    default: `## Calls
Complete list of calls — active, completed, missed, and scheduled.

## What this page is for
- Find a **specific call** by number, date, agent, or tag.
- View **live calls** with their partial transcription.
- Open a **detailed record**: full transcription, audio, sentiment, events.
- Manually trigger an **LLM analysis** or a **callback**.

## How to use it
1. Use the **search bar** (number, name, keyword in the transcription).
2. Refine with **filters**: direction (in/out), status, agent, period.
3. Click a **call row** to open the detailed record.
4. On the record: **audio player**, clickable transcription (each line jumps to the audio), "Call back", "Requalify", "Analyse" buttons.

## Best practices
- Tag interesting calls with a **label** (e.g. "objection", "to coach") so you can retrieve them via filter.
- When a call went wrong, run an **LLM analysis**: it pinpoints the exact moment things derailed and the associated sentiment.

## Typical use case
A customer calls to claim a refund → you type their number → you find the original call from 2 days ago → you listen to the disputed passage → you decide in 2 minutes.

## Pitfalls to avoid
- The **transcription** may contain errors on proper nouns or numbers — listen to the audio if in doubt.
- Calls **abandoned in queue** appear with a talk time of 0.

## Useful links
- [LLM Analysis](/analyses) for detailed analysis
- [Contacts](/contacts) to view a caller's history`,

    supervisor: `## Live call supervision
Step in on calls happening right now within your team.

## What this page is for
- See **calls in progress** (live) with a rolling transcription.
- **Listen**: discreetly monitor a call to assess quality.
- **Whisper**: speak to your agent without the caller hearing — for live coaching.
- **Barge**: take over and join the conversation as a third party.

## How to use it
1. Click an **active call** (with a "Live" badge).
2. Choose the mode:
   - 🎧 **Listen** = you listen; no one knows you're there.
   - 🗣️ **Whisper** = you speak to the agent only.
   - ⚡ **Barge** = you speak to everyone.
3. You can **switch between modes** without interrupting the call.

## Best practices
- **Listen first, then intervene**. A few seconds of listening avoids unnecessary interruptions.
- **Whisper** is silent for the customer but the agent hears you immediately — let them finish their sentence before you speak.
- **After the call**, log the exact moment you want to debrief in LLM Analysis.

## Typical use case
Junior + unhappy customer → listen for 20 sec → you understand the sticking point → whisper "offer a standard exchange within 48h" → the agent rephrases it, the customer agrees → you tag "resolved via whisper" for the debrief.

## Pitfalls to avoid
- **Barge** is heard by everyone — don't do it unless necessary.
- Avoid long whispers (>5 sec): the agent loses track of the customer.

## Useful links
- [LLM Analysis](/analyses)
- [Supervisor dashboard](/dashboard)`,

    agent: `## My calls
List of all your handled, active, or pending callback calls.

## What this page is for
- Pick up a **customer file**: full history with notes and tags.
- Schedule or view your **callbacks** for the day.
- Re-listen to a **call** you want to clarify.
- Add or edit your **qualification notes**.

## How to use it
1. Filter by **date** or **status** ("to call back", "missed", etc.).
2. Click a call to open the record.
3. On the record: audio, transcription, notes, tags. You can **edit your notes** after the call.
4. **"Call back"** button to re-contact a lead.

## Best practices
- Add a **clear tag** to each call (e.g. "appointment set", "to follow up", "complaint") — it makes sorting much easier.
- Keep notes to **2-3 lines** maximum: no novel needed, the AI already produces a summary.

## Pitfalls to avoid
- **Scheduled callbacks** only trigger if you're 🟢 Available at the scheduled time.

## Useful links
- [My desk](/desk)
- [My contacts](/contacts)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // QUEUES
  // ──────────────────────────────────────────────────────────────────────
  queues: {
    title: "Queues",
    learnMoreHref: docHref("queues"),
    default: `## Queues
Manage the distribution of inbound calls to your agents (human and AI).

## What this page is for
- Define **how calls are routed**: by skill, by language, by priority.
- Measure **queue performance**: SLA, abandon rate, wait time.
- Configure **overflow** if a queue saturates.
- Choose **hold music** and announcements.

## How to use it
1. Click **"+ New queue"** to create a queue.
2. Fill in:
   - **Name** (e.g. "Level 1 Support")
   - **Strategy**: \`longest_idle\` (recommended), \`round_robin\`, or \`broadcast\`.
   - **Max wait** (in seconds, default 600).
   - **Fallback**: voicemail, another queue, or an AI agent.
3. **"Members"** tab: add human agents and AI agents (with priority).
4. **"Routing"** tab: associate the queue with one or more numbers / IVR flows.

## Best practices
- Put an **AI agent as fallback**: it picks up when all humans are busy, preventing abandonments.
- For VIPs, create a dedicated queue with **high priority** and your best agents.
- Set up an **abandon alert** (Alerts → Rules) above 5% to react quickly.

## Typical use case
You set up customer support: create a "Support" queue, add your 4 advisers + AI agent "Hugo" as fallback, route the number 04 XX XX XX XX to this queue. During quiet hours, Hugo answers; during peak hours, the humans do.

## Pitfalls to avoid
- \`broadcast\` rings **all agents simultaneously** — useful for small teams, but causes double-picks beyond 5 agents.
- Don't forget to **deactivate** a queue you're no longer using; otherwise it may keep receiving calls due to stale routing.

## Useful links
- [Numbers](/numbers) to configure inbound routing
- [Flows / IVR](/flows) for more complex journeys`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // CAMPAIGNS
  // ──────────────────────────────────────────────────────────────────────
  campaigns: {
    title: "Campaigns",
    learnMoreHref: docHref("campaigns"),
    default: `## Outbound campaigns
Run your outbound call campaigns at scale.

## What this page is for
- Launch **campaigns** for prospecting, follow-up, satisfaction surveys, or debt collection.
- Track **progress** live: calls made / remaining, conversions, abandonments.
- **Pause** or adjust speed in real time.
- Measure **cost per contact** and **ROI**.

## How to use it
1. Click **"+ New campaign"**.
2. Fill in:
   - **Name** (e.g. "June follow-up")
   - **Assigned AI agent**
   - **Caller number** (Twilio)
   - **Target**: upload a CSV (mandatory column: \`phone\`)
   - **Time window**: e.g. 9am–7pm, Monday–Friday
   - **Speed (CPS)**: number of simultaneous calls
   - **Script**: campaign-specific prompt (overrides agent)
3. Click **▶ Start**. The worker dials contacts within the time window.
4. Follow **live stats** on the campaign record.

## Best practices
- Start at **CPS = 2-3** to verify everything is working, then scale up.
- Prepare **2 scripts** (A/B) and run them in parallel on 100 leads each; keep the better one.
- Enable the **post-call SMS** to measure satisfaction.
- Set up a **human transfer** for strong-interest cases (commercial gesture to validate).

## Typical use case
500 leads from a trade show → you create "Oct Show Follow-up" → AI agent "Lisa", script "qualify training interest" → window 9am-12pm / 2pm-5pm over 3 days → you monitor conversion live → 78 appointments booked, ROI ×6.

## Pitfalls to avoid
- **Never launch without testing the script**: at least 1 test call before ▶.
- Check the **time window and timezone**: a Sunday at 8am can ruin your reputation.
- Comply with **legal requirements** (GDPR, opt-out, DNC list).

## Useful links
- [AI Agents](/agents) to configure the agent
- [Scripts](/scripts) for your templates
- [Contacts](/contacts) to prepare your target list
- [Numbers (health)](/numbers/health) to check your outbound numbers`,

    agent: `## My campaigns
List of campaigns you're participating in (as a human agent for handoffs from the AI).

## What this page is for
- See your **daily quota** per campaign.
- Pick up **scheduled callbacks** (leads the AI transferred to you but who requested a callback).
- Review the **script** and **campaign prompt** to stay aligned.

## How to use it
1. Click a campaign to see its **record**: script, leads assigned to you, performance.
2. Your **callbacks** appear at the top with their scheduled time.

## Best practices
- Before a callback, **re-read the notes** from the previous AI call (visible on the contact record).
- If the customer asks "who called me before?", be transparent: "That was our virtual assistant who collected some information to save time."

## Useful links
- [My calls](/calls)
- [My contacts](/contacts)`,

    manager: `## Campaigns (manager)
Campaign management in read / pause mode.

## What this page is for
- Track the **performance** of ongoing and completed campaigns.
- **Pause** a campaign that is going off the rails.
- Decide on **scaling** a campaign that's performing well.

## How to use it
1. Sort by **conversion** or **cost per lead** to identify top performers.
2. To pause: open the campaign → **⏸** button.
3. To scale: increase the speed (CPS) or ask the admin to add more leads.

## Best practices
- Cut **underperformers** quickly (conversion < 5% of benchmark).
- Regularly share **top scripts** with other campaigns.

## Useful links
- [Analytics](/analytics)
- [Scripts](/scripts)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // AGENTS IA
  // ──────────────────────────────────────────────────────────────────────
  agents: {
    title: "AI Agents",
    learnMoreHref: docHref("agents"),
    default: `## AI Agents
Your conversational assistants — each with its own voice, prompt, knowledge, and tools.

## What this page is for
- List all the organisation's **AI agents**.
- Create a **new agent** from a template or from scratch.
- **Duplicate** an existing agent to start from a proven base.
- Track **performance** per agent (volume, duration, quality).

## How to use it
1. Click **"+ New agent"**.
2. Choose a **template** ("Hotel concierge", "B2B switchboard", etc.) or start from scratch.
3. Fill in **name**, **language**, **voice**, **LLM model**, **system prompt**, **greeting**.
4. Optional: enable **RAG** (documents) and **n8n tools**.
5. **Test**: "Test call" button (the system calls you for a live exchange).
6. **Publish**: the agent becomes available for flows, queues, and campaigns.

## Best practices
- Start with a **template**: 80% of the work is already done.
- A good **prompt** = 2-3 paragraphs max, examples, "do not" rules.
- **Test in real conditions** before assigning to a production number.

## Typical use case
You want to automate the reception of a medical practice → template "Healthcare switchboard" → you customise the greeting and add RAG on the patient FAQ → 30 minutes later, the agent "Capucine" is live.

## Pitfalls to avoid
- **Don't** put precise figures (prices, opening hours) in the prompt: use RAG. Otherwise, every change requires editing the prompt.
- Avoid overly expressive voices for professional use: they overact.

## Useful links
- [Voice Studio](/voices) for voices
- [Documents (RAG)](/documents) for the knowledge base
- [n8n Workflows](/workflows) for tools`,
  },

  "agents.detail": {
    title: "AI agent profile",
    learnMoreHref: docHref("agents.detail"),
    default: `## AI agent configuration
All the controls to precisely shape your agent's behaviour.

## What this page is for
- Define the agent's **personality** and **mission** (system prompt).
- Choose the **voice** (TTS) — preset or cloned voice.
- Set the **LLM** (provider, model, temperature).
- Enable **RAG**: documents the agent can consult on the fly.
- Configure **tools**: n8n workflows / functions the agent can trigger.
- Customise the **greeting** (opening phrase).

## How to use it
1. **System prompt**: describe WHO the agent is, its MISSION, its TONE, its LIMITS (what it doesn't do).
2. **Voice**: choose from the catalogue. ▶ button for preview.
3. **LLM**: \`deepseek-v4-flash\` is the default (fast + ~3× cheaper than the pro tier). \`deepseek-v4-pro\` or \`deepseek-reasoner\` for complex tasks.
4. **RAG**: tick the documents to expose. The agent will retrieve before each long answer.
5. **Tools**: add the authorised n8n workflows (transfer_human, book_appointment, etc.).
6. **Greeting**: opening phrase. Short (5-10 words) works better than long.
7. **Test**: "Test call" button to validate before publishing.

## Best practices
- **Prompt**: structure in 3 blocks (identity / mission / rules). Give 1-2 concrete examples. Specify the tone ("natural, never robotic").
- **Greeting**: don't say "I am a virtual assistant" — prefer "Hi, this is Sophie from [brand], how can I help you?".
- **Temperature**: 0.3-0.5 for predictable answers, 0.7+ for warm conversation.
- **RAG**: only include documents relevant to THIS role, otherwise the agent dilutes its answers.

## Typical use case
"Hotel concierge" agent:
1. Prompt: "You are Sophie, concierge at Hôtel des Pins. You answer questions about hours/restaurant/rooms, take messages, and transfer to the front desk for sensitive requests."
2. RAG: rates PDF, restaurant hours PDF, patient FAQ.
3. Tools: \`transfer_human\`, \`take_message\`, \`send_sms_confirmation\`.
4. Greeting: "Hello, this is Sophie from Hôtel des Pins, how can I help you!"

## Pitfalls to avoid
- **Don't put prices in the prompt**: they'll go stale. Use RAG.
- Too many tools kill the tools: 3-5 max, otherwise the agent hesitates.
- Don't use a **cloned voice of a person without their consent** (GDPR).

## Useful links
- [Voice Studio](/voices)
- [Documents (RAG)](/documents)
- [n8n Workflows](/workflows)
- [AI Teams](/teams) for agent swarms`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // VOICES
  // ──────────────────────────────────────────────────────────────────────
  voices: {
    title: "Voice Studio",
    learnMoreHref: docHref("voices"),
    default: `## Voice Studio
Create, clone, and manage your synthetic voices (TTS).

## What this page is for
- Browse the **library**: provider's native voices + your cloned voices.
- **Clone a voice** from an audio sample (10 sec to 5 min).
- **Preview** each voice by generating a test sample.
- View the **status** of each voice (active, error, quota exceeded).

## How to use it
1. **Library**: browse the pre-installed voices. ▶ button for preview.
2. **+ Clone a voice**:
   - Give it a **name** (e.g. "Sophie's voice")
   - Upload an **MP3/WAV** (mono, 10 sec to 5 min, clear quality)
   - Click **"Clone"**
   - After 10-30 s, the voice appears with a "Ready" status
3. **Test**: ▶ next to the voice → the system synthesises a test sentence.
4. **Assignment**: from AI Agents → agent record → "Voice" field.

## Best practices
- The source audio must be **clean**: no music, no echo, one person only.
- 1-2 minutes of audio is enough for a good clone — beyond that, gains are marginal.
- **Test on several sentences** (short, long, with numbers, with punctuation) before going live.

## Typical use case
You want to personalise hotel reception → you ask a staff member (with written consent) to read a short 1-min text → you clone it → you assign it to your AI agent.

## Pitfalls to avoid
- **Always obtain written consent** from the person whose voice you're cloning (GDPR).
- A **low-quality clone** (poor audio) will produce a robotic voice.
- Some languages work better than others — test under real conditions.

## Diagnostic
If a voice goes into error:
1. Open **Voices → Diagnostic** to see the error code (missing MiniMax key, quota exceeded, etc.).
2. Re-clone if the source audio was poor.

## Useful links
- [AI Agents](/agents) to assign voices`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // FLOWS / IVR
  // ──────────────────────────────────────────────────────────────────────
  flows: {
    title: "Flow Builder IVR",
    learnMoreHref: docHref("flows"),
    default: `## Flow Builder
Visually design your interactive voice response (IVR) systems with drag-and-drop.

## What this page is for
- Create **structured call journeys** (press 1 / 2 / 3 menus, DTMF capture, etc.).
- Add **conditions** (time of day, detected language, CRM variable).
- Call **external APIs** mid-journey.
- Transfer to an **AI agent**, a **queue**, or an external number.

## How to use it
1. **+ New flow** → you land on an empty canvas.
2. Drag **nodes** from the palette:
   - **Start**: flow entry point.
   - **Say**: the agent speaks a phrase.
   - **Listen**: captures the customer's voice (with timeout).
   - **Choice**: branches based on what they said (NLU).
   - **API Call**: calls an endpoint (n8n, your backend).
   - **Transfer**: to a human or another queue.
   - **Hangup** / **Voicemail**.
3. **Connect** nodes by dragging from their outputs.
4. **Variables**: everything you capture is usable in subsequent nodes (\`{{user_choice}}\`).
5. **Test** in the built-in simulator before publishing.
6. **Assign** to a number from Numbers → number record → Routing → Flow.

## Best practices
- Start **simple**: a Say + a Listen + a Choice + 2-3 branches is often enough.
- Prefer **AI agents in free mode** for conversational cases — keep IVR for truly structured scenarios.
- Always add a **fallback branch** ("Sorry, I didn't catch that, let me transfer you to an adviser").

## Typical use case
"Press 1 for support, 2 for sales, 3 for billing" → Choice → 3 branches each leading to a specialised AI agent.

## Pitfalls to avoid
- **Don't chain more than 3 menu levels**: customers hang up.
- Sensitive variables (bank card details) must never be logged — disable transcription on those nodes.

## Useful links
- [AI Agents](/agents)
- [Queues](/queues)
- [Numbers](/numbers)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // WORKFLOWS N8N
  // ──────────────────────────────────────────────────────────────────────
  workflows: {
    title: "Workflows n8n",
    learnMoreHref: docHref("workflows"),
    default: `## Automation workflows
Connect the platform to your tools (CRM, Slack, email, calendar…) via n8n.

## What this page is for
- Browse **ready-to-use templates** (HubSpot sync, Slack notification, confirmation email…).
- **Edit** a workflow in the embedded n8n editor.
- Define **triggers**: call ended, lead qualified, escalation, negative sentiment.
- Configure the **tools** your AI agents can call live.

## How to use it
1. **+ New workflow** → choose a template or start empty.
2. The **n8n editor** opens in-page.
3. Define your **trigger** (webhook from Axon, cron, event).
4. Add **steps**: HTTP request, Salesforce, Slack, etc.
5. **Activate** the workflow.
6. For an AI agent to call it live, go to its record → Tools → tick the workflow.

## Best practices
- **Version** your critical workflows (export JSON to git).
- **Test** each workflow in isolation before exposing it to an AI agent.
- Limit the **side effects** of agent tools: a call should be able to fail without corrupting your CRM.

## Typical use case
"Qualified 'hot' call" → trigger on \`call.qualified\` event → Salesforce deal creation + Slack #sales notification + recap email to the assigned salesperson.

## Pitfalls to avoid
- **Don't hard-code credentials** in the workflow — use n8n credentials.
- Avoid **overly long** workflows: > 30 sec and the AI agent will wait, which the customer will notice.

## Useful links
- [AI Agents](/agents) to expose workflows as tools
- [Documents (RAG)](/documents) if you also want to expose documentation`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // DOCUMENTS RAG
  // ──────────────────────────────────────────────────────────────────────
  documents: {
    title: "Documents (RAG)",
    learnMoreHref: docHref("documents"),
    default: `## RAG document base
Give your AI agents domain knowledge — without hallucination.

## What this page is for
- **Upload** your documents (PDF, DOCX, TXT, MD).
- **Index** automatically (chunking + embeddings + pgvector).
- **Tag** by category, language, target agent.
- **Test** retrieval exactly as your agent does it.

## How to use it
1. **+ Add a document** → drag your file or paste text.
2. Choose the **tags** (e.g. "pricing", "FAQ", "product:hotel").
3. Click **"Index"** → extraction + embeddings happen in the background (10 sec to 2 min).
4. Once "Indexed", the document appears with its chunk count.
5. **Test**: type a question in the "Test retrieval" field → see the chunks returned.
6. **Assign** to an agent: in its record → RAG → tick the documents.

## Best practices
- **Split** your documents by topic: a "Pricing" doc + a "Hours" doc + an "FAQ" doc will work better than a 200-page megadoc.
- **Update** regularly: an agent answering with outdated pricing is worse than one that says "let me check".
- Prefer **structured markdown** (clear headings) over untagged PDFs.

## Typical use case
You upload your product catalogue + FAQ → your AI agents answer accurately and cite their sources without inventing anything.

## Pitfalls to avoid
- **Never put personally identifiable customer data** in RAG (GDPR).
- **Scanned PDFs (images)** cannot be extracted without OCR — prefer a text export.
- Too many documents = less precise retrieval: target with tags.

## Useful links
- [AI Agents](/agents) to assign RAG
- [n8n Workflows](/workflows) for more dynamic data`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // TEAMS (SWARM)
  // ──────────────────────────────────────────────────────────────────────
  teams: {
    title: "Multi-agent teams",
    learnMoreHref: docHref("teams"),
    default: `## AI agent swarm
Orchestrate multiple AI agents collaborating on the same call.

## What this page is for
- Build **specialised teams** (reception, technical, sales, payment…).
- Define an **orchestrator agent** (supervisor) that dispatches based on intent.
- Configure **handoff rules** between agents.
- Maintain **shared context**: the conversation stays coherent even after multiple handoffs.

## How to use it
1. **+ New team** → give it a name (e.g. "Support Squad").
2. **Add members**: select existing AI agents.
3. Define the **orchestrator**: an agent that receives first and routes.
4. **Handoff rules**: e.g. "if intent = technical support → pass to 'Hugo Tech'".
5. **Shared variables**: what every agent can read (customer name, history).
6. **Test**: test call to the full team.

## Best practices
- Specialise each agent — don't make them Swiss Army knives.
- The **handoff must be invisible** to the customer: "one moment, I'll connect you with my colleague Hugo who'll handle that".
- Limit to **3-5 agents** per team: beyond that, it becomes unmanageable.

## Typical use case
Support squad for a retailer:
- **Reception**: receives the call, qualifies the intent.
- **Tech**: takes over for product issues.
- **Support**: handles returns / refunds.
- **Sales**: deals with upsell opportunities.
Reception dispatches, the others take over, and a human can step in at any time.

## Pitfalls to avoid
- Don't put two agents with the **same role**: handoff conflicts.
- Too many felt handoffs irritates customers — limit to 1-2 per call maximum.

## Useful links
- [AI Agents](/agents)
- [n8n Workflows](/workflows) for shared tools`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // SCRIPTS
  // ──────────────────────────────────────────────────────────────────────
  scripts: {
    title: "Campaign scripts",
    learnMoreHref: docHref("scripts"),
    default: `## Campaign scripts
Reusable conversational script library for your campaigns.

## What this page is for
- Centralise your **scripts** (opening, qualification, pitch, objections, closing).
- Manage **variables** \`{{firstname}}\`, \`{{company}}\` interpolated at runtime.
- Version and **A/B test** your scripts.
- Reuse the same script across multiple campaigns.

## How to use it
1. **+ New script** → name it (e.g. "B2B SaaS Prospecting").
2. Write the **sections**:
   - Opening (5-10 sec)
   - Qualification (3-5 questions)
   - Pitch (30 sec max)
   - Objections (prepare the 3-5 most common)
   - Closing (appointment or CTA)
3. Insert **variables** between \`{{ }}\` — they'll be replaced by the contact's CSV data.
4. **Version**: each change creates a new version; you keep the history.
5. **Assign** to a campaign in the campaign record.

## Best practices
- **Short beats long**: an AI agent improvises well from 3-5 clear bullet points.
- Prefer **bullets** over continuous prose — the agent follows better.
- **A/B test**: 2 versions, 100 leads each, compare conversion.

## Typical use case
"Warm lead follow-up" script: warm opening + 2 qualification questions + offer to send documentation or book an appointment → conversion measured over 7 days.

## Pitfalls to avoid
- **Don't** put sensitive information (detailed pricing) in the script if it changes — use RAG.
- **Don't read** the script word for word: let the AI agent improvise around it.

## Useful links
- [Campaigns](/campaigns)
- [AI Agents](/agents)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // CONTACTS
  // ──────────────────────────────────────────────────────────────────────
  contacts: {
    title: "Contacts (CRM)",
    learnMoreHref: docHref("contacts"),
    default: `## Contacts
Your integrated CRM — used for campaigns and call history.

## What this page is for
- Centralise all your **contacts** (B2B / B2C).
- View **history**: calls, notes, tags, qualifications.
- **Import** via CSV with automatic mapping.
- Create **segments** (tags) to target your campaigns.

## How to use it
1. **+ New contact** or **Import CSV**.
2. For import: mandatory column: \`phone\`. Optional: \`first_name\`, \`last_name\`, \`email\`, \`company\`, etc.
3. On a contact record: **call history**, notes, tags, opt-out.
4. **Quick search** by name / phone / email / tag.
5. **Tags**: create your segments ("hot lead", "VIP", "do-not-call").

## Best practices
- **Clean** your database regularly: duplicates, invalid numbers.
- Mark **opt-outs** clearly (tag "DNC") so they're excluded from campaigns.
- Import in **batches of 5,000 max** to keep things running smoothly.

## Typical use case
After a trade show, you receive 500 leads → CSV import → tag "Oct Show" → you launch a targeted campaign on that tag.

## Pitfalls to avoid
- **GDPR**: ensure you have a legal basis to call (consent, legitimate interest).
- A **bad phone format** (without country code) causes dialling to fail — add \`+44\` etc. before import.

## Useful links
- [Campaigns](/campaigns)
- [Calls](/calls)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // NUMBERS
  // ──────────────────────────────────────────────────────────────────────
  numbers: {
    title: "Numbers",
    learnMoreHref: docHref("numbers"),
    default: `## Numbers
Manage your phone numbers (inbound and outbound) purchased from Twilio.

## What this page is for
- **Buy** a number by country / region directly from the interface.
- **Route** each number to an IVR flow, a queue, or an AI agent.
- Configure the **caller ID** (identity shown when calling out).
- Verify **compliance** (STIR/SHAKEN, A2P 10DLC for the US).

## How to use it
1. **Buy**: select country + type (Local / Mobile / TollFree) → Twilio lists available numbers → Buy.
2. **Configure**: click the number → "Routing" tab → choose the AI agent, queue, or flow.
3. **Twilio webhooks**: automated via the "Auto-config webhooks" button (or manually on the Twilio console).
4. **Caller ID**: "Displayed identity" field — useful for outbound.

## Best practices
- For **high-volume outbound**, buy a **pool of numbers** and enable rotation (prevents spam flagging).
- For **critical inbound**, keep a single VIP number with a dedicated queue.
- Check **health** monthly (Numbers → Health).

## Typical use case
You launch a new service in Belgium → you buy a BE Local number + a mobile → you route the local to the support queue, the mobile to the outbound campaign.

## Pitfalls to avoid
- Don't forget to **configure Twilio webhooks** otherwise calls arrive in a void.
- In the **US**, A2P 10DLC is mandatory for SMS — not for voice, but read the guidelines.
- **TollFree** numbers cost more but inspire more confidence for customer service.

## Useful links
- [Number health](/numbers/health)
- [Queues](/queues)
- [Flows](/flows)`,

    admin: `## Numbers (admin)
Complete number management for your organisation.

## What this page is for
- **Buy / port** numbers.
- **Routing** and associated flows.
- **Compliance**: STIR/SHAKEN, A2P 10DLC, caller ID verification.
- Track **monthly costs** per number.

## How to use it
1. **Buy** from Twilio (Buy button), or **Import** a number you already have (porting).
2. **Webhooks**: use auto-config (recommended) to point voice + status at the platform.
3. **Outbound pool**: if > 50 calls/day, create a pool of 5-10 numbers for rotation.
4. **Audit**: open the Costs tab for detailed billing.

## Best practices
- Add a **comment** on each number's purpose (inbound support, outbound follow-up…) — your team will thank you in 6 months.
- Renew your **STIR/SHAKEN** verifications annually.

## Typical use case
You notice an outbound number is flagged "Spam Likely" → you rest it for 30 days → you activate 2 new numbers in the pool.

## Pitfalls to avoid
- **Don't delete** a number assigned to a live flow: confirm first that it's no longer routed.
- **Manual Twilio webhooks** break with every domain renewal — prefer auto-config.

## Useful links
- [Number health](/numbers/health)
- [Inbound connectors](/admin/inbound)
- [Billing](/admin/billing)`,
  },

  "numbers.health": {
    title: "Number health",
    learnMoreHref: docHref("numbers.health"),
    default: `## Number health
Reputation and quality monitoring for your outbound numbers.

## What this page is for
- See the **spam score** assigned to each number by carriers / anti-spam apps.
- Track the **answer rate** per number (key health indicator).
- Manage **rotation**: number pools to spread the load.
- Receive **alerts** on flagged numbers.

## How to use it
1. The table lists your outbound numbers with their metrics (answer rate, spam score, volume).
2. Click a number to view its **30-day history**.
3. **Rest**: button to suspend a number for 7/14/30 days.
4. **Rotation**: Numbers → Pools → assign multiple numbers to a campaign.

## Best practices
- **Below 30%** answer rate: rest the number for 14 days.
- **Below 20%**: change the number (resting rarely helps at this point).
- Vary **patterns** (hours, frequency) to avoid anti-spam algorithms.
- Rotate across **pools of 5-10** numbers.

## Typical use case
You launch a campaign of 5,000 calls → you activate a pool of 8 numbers → the platform distributes the load → none exceeds 100 calls/day → spam score stays green.

## Pitfalls to avoid
- **Don't exceed 200 calls/day/number** without close monitoring.
- A flagged number keeps its bad reputation **for several weeks** even after resting.

## Useful links
- [Numbers](/numbers)
- [Campaigns](/campaigns)
- [Alerts](/alerts) for automatic thresholds`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // DESK / SOFTPHONE
  // ──────────────────────────────────────────────────────────────────────
  desk: {
    title: "My desk (softphone)",
    learnMoreHref: docHref("desk"),
    default: `## Softphone
Your integrated web phone for making and receiving calls.

## What this page is for
- **Receive** assigned calls (queues, transfers from AI).
- **Dial** a number manually.
- **Manage** mute, hold, transfer, conference.
- **Take notes** in real time, saved to the call record.

## How to use it
1. Check your **status** (🟢 Available / 🟡 On break / 🔴 Unavailable).
2. **Receive**: an inbound call rings → ✅ Answer / ❌ Decline.
3. **Dial**: number pad or "Dial" button → type or paste a number.
4. **During the call**: mute, hold, transfer, conf, hang up buttons.
5. **Notes**: right panel — type in real time, auto-saved.

## Best practices
- **Allow the microphone** in the browser at first load (Chrome / Edge: padlock → microphone → Allow).
- Set your status to **🟡 On break** before stepping away for a coffee.
- Notes taken during the call appear afterwards on the **contact record**.

## Typical use case
A call transferred from the AI agent arrives on your softphone → you see an **AI summary** (what was said before) → you answer → you pick up seamlessly for the customer.

## Pitfalls to avoid
- If the microphone is **muted at system level (Windows / Mac)**, the softphone can't override it — check outside the browser.
- Don't **reload** the page during a call: you'll lose it.

## Useful links
- [My calls](/calls)
- [My contacts](/contacts)`,

    agent: `## Your softphone
Your main tool for taking calls.

## What this page is for
- **Receive** calls (queue, handoff from AI, transfer from a colleague).
- **Make** outbound calls (callback, manual prospecting).
- **Transfer** to a colleague, a queue, or an external number.
- **Take notes** saved to the contact record.

## How to use it
1. **Log in** → you land on the desk.
2. Switch to **🟢 Available** to receive calls.
3. When a call comes in: ✅ Answer (an AI summary appears if one exists).
4. **During the call**: mute / hold / transfer / conf / hang up, and live note-taking.
5. **After the call**: add a tag (appointment set / to call back / complaint) → Save.

## Best practices
- Have a **headset plugged in** before going Available.
- Keep your **notes** tidy: your future self (or a colleague) will read them.
- A **handoff from AI** = context is already summarised → don't re-brief the customer.

## Typical use case
The AI handled the reception and qualified a hot lead → handoff → your desk rings → you see "client interested in the pro plan, waiting for a demo" → you book an appointment in 5 min.

## Pitfalls to avoid
- **Don't mute for too long** without warning: the customer thinks they've been abandoned.
- If you **decline** a call, the queue redistributes it but it affects your KPIs.

## Useful links
- [My calls](/calls)
- [My contacts](/contacts)
- [My campaigns](/campaigns)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // ADMIN
  // ──────────────────────────────────────────────────────────────────────
  admin: {
    title: "Administration",
    learnMoreHref: docHref("admin"),
    default: `## Administration
Settings and operations for your organisation.

## What this page is for
- Invite / manage **members** and their roles.
- Manage **organisations** (multi-tenant, super_admin only).
- Configure **inbound connectors** (Twilio, SIP, webhooks) and outbound (CRM, n8n).
- Track **billing** (subscription, invoices, payment methods).
- View the **audit log** of sensitive actions.

## How to use it
1. **Users** section: invite members (email + role), suspend, change roles.
2. **Connectors** section: add Twilio, configure webhooks.
3. **Audit** section: search by user, action, period.
4. **Billing** section: view current cycle and history.

## Best practices
- Limit the **admin** role to 2-3 people max; others as manager / supervisor / agent.
- Enable **mandatory 2FA** in Settings → Security.
- Review the **audit log** each week to detect unusual actions.

## Typical use case
You onboard a new manager → Users → Invite → email + role "manager" → they receive their activation link → you assign them to the right teams in the queue.

## Pitfalls to avoid
- **Never give the admin role to a frontline agent**: they'd have access to everything (billing, deletion).
- If a member **leaves** the organisation, deactivate their account immediately (don't delete — keep for the audit trail).

## Useful links
- [Inbound connectors](/admin/inbound)
- [Billing](/admin/billing)
- [Super Admin Copilot](/admin/copilot)
- [Settings](/settings)`,

    super_admin: `## Platform administration
You see and manage **all organisations** on the platform.

## What this page is for
- **Create / suspend** organisations.
- Define **quotas** per tenant (minutes, agents, numbers, storage).
- View the **global audit** (all orgs).
- Manage **platform templates** (AI agents, flows, scripts) reusable by all orgs.

## How to use it
1. **Organisations** → list of all tenants. "+ New org" button.
2. **Quotas**: per org, set limits (minutes/month, number of AI agents, RAG storage GB).
3. **Suspension**: ⋮ → Suspend (the org becomes inaccessible but data is retained).
4. **Org switch**: selector in the top right of the sidebar.

## Best practices
- Set up a **default quota policy** (e.g. trial = 100 min, paid = 5,000 min).
- Do a **quarterly review** of inactive orgs → commercial follow-up or suspension.
- Before **deleting** an org, do a full export (GDPR).

## Typical use case
A prospect signs the contract → you create their org → you set their quotas, invite their owner → in 5 min they have a clean, ready-to-use environment.

## Pitfalls to avoid
- **Never delete** an org without a backup: it's irreversible and the data is lost.
- **Suspension** is immediate for users — warn them beforehand.

## Useful links
- [Organisations](/admin)
- [Copilot](/admin/copilot)
- [Billing](/admin/billing)`,
  },

  "admin.orgs": {
    title: "Organisations",
    learnMoreHref: docHref("admin.orgs"),
    default: `## Organisation management
Reserved for super-admins to manage the multi-tenant setup.

## What this page is for
- **List** all organisations.
- **Create** a new tenant with its owner.
- Define **quotas** (minutes, agents, numbers, storage).
- **Suspend** or reactivate an org without deleting it.
- **Switch** to an org as support (with traceability).

## How to use it
1. **+ New organisation**: name, slug, plan, owner (email → automatic invitation).
2. **Quotas**: per org, adjust the limits.
3. **Switch**: "Log in as" button — all your actions are logged.
4. **Suspension**: ⋮ → Suspend (with mandatory reason).

## Best practices
- Standardise your **plans** (Trial / Pro / Enterprise) with associated quotas.
- Org switching should be **reserved for support** — it's sensitive access.
- Always log the **reason** for a suspension.

## Typical use case
An org exceeds its quotas → you contact them → no response after 7 days → you suspend them with reason "quota exceeded - non-payment" → automatic email sent to the owner.

## Pitfalls to avoid
- **Don't switch** without an operational need — it's logged and visible to the client.
- **Don't reuse the slug of a deleted org**: potential conflict.

## Useful links
- [Admin](/admin)
- [Billing](/admin/billing)`,
  },

  "admin.copilot": {
    title: "AI Copilot",
    learnMoreHref: docHref("admin.copilot"),
    default: `## AI Copilot
AI assistant for configuring and managing the platform in natural language.

## What this page is for
- **Query** the platform: "how many missed calls yesterday?".
- **Plan** actions: "launch a campaign on these 200 contacts tomorrow at 10am".
- **Diagnose**: "why does the number +44 1... have a poor answer rate?".
- **Generate** artefacts: scripts, prompts, flows.

## How to use it
1. Type your request in the **chat bar** in natural language.
2. The copilot queries **Supabase**, **n8n**, the **platform RAG** and responds with **data + recommendations**.
3. If it proposes an action (create agent, launch campaign…), it asks for **confirmation** before executing.
4. You can see the **execution plan** (tool calls) before validating.

## Best practices
- Be **specific**: "campaign for these 200 leads with agent Lisa, window 9am-12pm" → better result than "run a campaign".
- Ask it to **diagnose before acting** ("why is this campaign converting poorly?").
- Use it to **generate a first draft** of a prompt / script, then refine by hand.

## Typical use case
"Generate a prospecting script for the real estate sector, B2C, leading to an appointment booking" → the copilot produces a structured script → you keep 80%, you adapt 20%.

## Pitfalls to avoid
- Always check the **execution plan** before validating an action — the copilot has write access.
- For **large-scale** actions (>100 contacts), first ask for a **dry run** ("simulate without sending").

## Useful links
- [n8n Workflows](/workflows) (the copilot uses them)
- [Documents (RAG)](/documents)`,
  },

  "admin.inbound": {
    title: "Inbound connectors",
    learnMoreHref: docHref("admin.inbound"),
    default: `## Inbound connectors
Call and lead sources that the platform ingests.

## What this page is for
- Connect **SIP trunks** (carrier interconnections).
- Configure **Twilio webhooks** (automatic or manual).
- Hook up **external webhooks** (Meta Ads, Google Ads, your website).
- Configure **email-to-call**: an inbound email triggers a callback.

## How to use it
1. **+ New connector** → choose the type (Twilio, SIP, Webhook, Email).
2. Fill in the **credentials** (encrypted on the platform side).
3. **Test** the connection: "Test" button → you see the event arrive.
4. **Map**: which agent / queue / flow receives calls from this connector.

## Best practices
- Use **Twilio auto-config** rather than manually configuring webhooks.
- Prefer **HTTPS + signatures** for external webhooks (security).
- **Document each connector** (what it does, who maintains it).

## Typical use case
You want to turn every Meta Ads lead into a call → you create a webhook pointing to the platform → when a lead arrives → the platform triggers an automatic callback via an AI agent.

## Pitfalls to avoid
- **Don't store** credentials in plain text on the n8n side — use encrypted credentials.
- **Unsigned webhooks** can receive spam → use an HMAC signature.

## Useful links
- [Numbers](/numbers)
- [n8n Workflows](/workflows)`,
  },

  "admin.billing": {
    title: "Billing",
    learnMoreHref: docHref("admin.billing"),
    default: `## Billing
Track your consumption and invoices.

## What this page is for
- View the **current cycle**: minutes consumed, active AI agents, RAG storage, number of phone numbers.
- Download your **invoices** as PDF.
- Manage your **payment methods** (card, SEPA direct debit).
- **Change plan** or add add-ons.

## How to use it
1. **Current cycle**: progress bar per quota.
2. **Invoices**: table with date, amount, status, PDF.
3. **Payment methods**: add / remove a card.
4. **Plan**: view your current plan and its limits. "Upgrade" button.
5. **Alerts**: set a threshold (e.g. alert at 80% of the minutes quota).

## Best practices
- Enable **threshold alerts** to avoid end-of-cycle surprises.
- Prefer **SEPA direct debit** for professional subscriptions (card = expiry risk).
- Download your **invoices** each month for your accountant.

## Typical use case
You see the "Minutes" bar at 85% on the 20th of the month → you activate the "extra minutes" add-on to avoid a service interruption.

## Pitfalls to avoid
- An **expired card** triggers automatic suspension within 7 days if not replaced.
- **Add-ons** are consumed on top of the plan — check what's consumed first (usually plan, then add-on).

## Useful links
- [Admin](/admin)
- [Settings](/settings)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // ALERTS
  // ──────────────────────────────────────────────────────────────────────
  alerts: {
    title: "Alerts",
    learnMoreHref: docHref("alerts"),
    default: `## Alerts
Incidents and exceeded thresholds to handle.

## What this page is for
- View **open alerts** (to be handled).
- Filter by **severity**, **category**, **source**.
- **Acknowledge**, comment, and close an alert.
- Define your own **rules** (custom thresholds).

## How to use it
1. Sort by **severity** (critical / high / medium / info).
2. Click an alert to open the **detail** (context, metric, suggested action).
3. **Acknowledge**: "I'm handling this" → the alert moves to "in progress".
4. **Close** with a comment.
5. **Rules**: "Configuration" tab to create / modify thresholds.

## Categories
- **Technical**: provider down, webhook failure, delayed job.
- **Quality**: negative sentiment, call too long, high abandon rate.
- **Compliance**: call outside time window, opted-out contact called.
- **Business**: conversion dropping, degraded campaign ROI.

## Best practices
- **Acknowledge** a critical alert quickly (< 5 min) — it prevents escalation to the manager.
- Refine your **rules**: too much noise → you stop reading any of them.
- Run a **post-mortem** on frequent critical alerts to resolve them at the source.

## Typical use case
"5 abandonments in the VIP queue in 10 min" → red alert → you reinforce the team (add AI agents as fallback) → the alert resolves itself.

## Pitfalls to avoid
- **Don't close without commenting**: the history is valuable for post-mortems.
- Don't set thresholds too **low**: you'll be overwhelmed.

## Useful links
- [Dashboard](/dashboard)
- [Number health](/numbers/health)
- [Queues](/queues)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // ANALYSES LLM
  // ──────────────────────────────────────────────────────────────────────
  analyses: {
    title: "LLM Analysis",
    learnMoreHref: docHref("analyses"),
    default: `## LLM Analysis
Automated post-call analysis generated by AI.

## What this page is for
- **Summarise** each call in 3 lines.
- Detect **sentiment** (positive / neutral / negative) and its evolution.
- Extract **topics** covered (subjects, objections, requests).
- Score **quality**: compliance, commercial opportunity, tone.
- Extract **actions**: callbacks to make, tasks, appointments to create.

## How to use it
1. Filter by **period**, **agent**, **campaign**, **sentiment**.
2. Click an analysis to see the **detail** (summary, sentiment, topics, actions).
3. **Trigger a manual analysis** on a call: from Calls → call record → "Analyse".
4. **Export** to CSV for your quality committees.

## Best practices
- Run a **weekly quality review**: filter "negative sentiment" + "compliance < 70%" → debrief with the team.
- Cross **agent × sentiment** to identify training needs.
- Enable **automatic analysis** on 100% of production calls.

## Typical use case
Monday morning, you open Analysis → filter "negative sentiment over 7d" → you identify 4 difficult calls → team debrief → 2 are genuinely hard cases (aggressive customers), 2 are agent errors → targeted coaching.

## Pitfalls to avoid
- **LLM sentiment** isn't perfect on irony / cultural nuance — listen to the audio when a case surprises you.
- **Analyses cost LLM tokens**: if you have 10,000 calls/day, it's better to sample than to analyse everything.

## Useful links
- [Calls](/calls)
- [Analytics](/analytics)
- [Alerts](/alerts) (you can turn a threshold into an alert)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // SETTINGS
  // ──────────────────────────────────────────────────────────────────────
  settings: {
    title: "Settings",
    learnMoreHref: docHref("settings"),
    default: `## Settings
Your profile and personal preferences.

## What this page is for
- Edit your **profile** (name, photo, interface language).
- Configure **notifications** (email, in-app, push).
- Manage **security**: password, 2FA, active sessions.
- Customise **preferences** (theme, shortcuts).

## How to use it
1. **Profile**: change your name and photo. The interface language applies on the next refresh.
2. **Notifications**: choose what you want to receive and via which channel.
3. **Security**: enable 2FA (recommended). Revoke unused sessions.
4. **Preferences**: theme (dark / light / system).

## Best practices
- **Enable 2FA** — a compromised account gives access to customer data.
- Revoke **old sessions** (old laptop, public café).
- **Email + in-app** notifications for critical alerts, **in-app only** for the rest.

## Pitfalls to avoid
- If you **disable all notifications**, you risk missing an important event.
- **Never** use the same password as on other services.

## Useful links
- [Administration](/admin)`,

    admin: `## Organisation settings
Customise your tenant (visuals, security, integrations).

## What this page is for
- **Branding**: logo, colours (appear in emails, the portal).
- **Custom domain**: e.g. \`support.your-brand.com\` instead of the platform URL.
- **Security policies**: strong passwords, mandatory 2FA, IP allowlist.
- **Global integrations**: LDAP / SSO, custom providers.

## How to use it
1. **Branding**: upload logo (transparent PNG/SVG recommended) + primary colours.
2. **Domain**: add your CNAME, validate DNS, wait for the certificate (5-30 min).
3. **Security**: tick "Mandatory 2FA" (recommended in production).
4. **SSO**: configure SAML / OIDC if you have an IdP (Okta, Azure AD).

## Best practices
- Enable **mandatory 2FA** as soon as you have more than 5 members.
- Set up a **password policy** (12 char min, complexity, 90-day rotation).
- For large accounts: **SSO via SAML** > local accounts (centralised management).

## Typical use case
Onboarding a new B2B client → you activate their branding (logo + colours) in 10 min → the experience is immediately personalised.

## Pitfalls to avoid
- A poorly configured **IP allowlist** can lock you out yourself: test on another member before enabling.
- **Changing the domain** invalidates old invitation links — communicate this beforehand.

## Useful links
- [Administration](/admin)
- [Billing](/admin/billing)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // AUTH (kept short — these are pre-app)
  // ──────────────────────────────────────────────────────────────────────
  signup: {
    title: "Sign up",
    learnMoreHref: docHref("signup"),
    default: `## Create an account
Welcome! A few details are all you need to get started.

## What this page is for
- Create your account **in 30 seconds**.
- Sign in via **Google / Microsoft** if you prefer.
- Join an **existing organisation** by invitation.

## How to use it
1. **Email + password** (8 char min) OR "Continue with Google/Microsoft".
2. Choose: create my own organisation, or join via invitation code.
3. Confirm your **email** (link sent).
4. Follow the **onboarding**: step-by-step wizard to set up your first AI agent.

## Best practices
- Use your **work email** (for billing and compliance).
- Start with an **agent template**: 5 minutes and you have something to test.

## Pitfalls to avoid
- Check your **spam folder** if you don't receive the confirmation email.

## Useful links
- [Log in](/login)`,
  },

  login: {
    title: "Log in",
    learnMoreHref: docHref("login"),
    default: `## Log in
Access your Axon workspace.

## What this page is for
- **Log in** to your account (email + password, or SSO).
- **Recover** a forgotten password.
- **Switch** between organisations after login (if you're a member of several).

## How to use it
1. **Email + password**, or "Continue with Google/Microsoft" if enabled.
2. If 2FA is active: enter the **code** from your authenticator app.
3. **Forgot your password?** → reset link sent by email.

## Best practices
- Enable **2FA** as soon as possible (Settings → Security).
- Avoid sessions on **shared machines** without logging out.

## Pitfalls to avoid
- Too many failures → account temporarily locked (5 min) for security.

## Useful links
- [Create an account](/signup)`,
  },
};

/** Resolve markdown content for a (contextKey, role) pair. */
export function resolveHelp(
  contextKey: string,
  role: HelpRole | null | undefined
): { title: string; body: string; learnMoreHref?: string } | null {
  const entry = HELP[contextKey];
  if (!entry) return null;
  const body = (role && entry[role]) || entry.default;
  return {
    title: entry.title,
    body,
    learnMoreHref: entry.learnMoreHref,
  };
}

/** Returns all context keys that have at least a `default` body. */
export function allContextKeys(): string[] {
  return Object.keys(HELP);
}
