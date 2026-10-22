// The privacy notice for pulsegmg.com (pulse.orryy.com/privacy redirects here). It describes
// what the Pulse code actually does with personal data: the factory's YouTube comment replies
// (src/youtube/replies.ts, stored in comment_replies) and viewer-request tally
// (src/social/requests.ts), plus the older pipeline in the repo root: engagement.js,
// competitor_monitor.js, hunter.js / assemble.js (Reddit comments) and discord/bot.js.
// Keep it in step with the root server.js /privacy page (lib/privacy-notice.js on main)
// and update the date whenever what the code does changes.
// Burner identity rule: never name the owner here. The controller is the trading name.

export const PRIVACY_LAST_UPDATED = "22 October 2026";

export const PRIVACY_NOTICE_HTML = `<h1>Privacy policy</h1>
<p class="meta">Last updated: ${PRIVACY_LAST_UPDATED}</p>
<p>This notice explains what personal data Pulse Gaming uses, why, who else handles it, how long we keep it and what you can do about it. It covers this website, our channels on YouTube, TikTok, Instagram, Facebook and X, and our Discord server.</p>

<h2>Who we are</h2>
<p>Pulse Gaming (also published as Pulse Gaming News) is a trading name of a UK sole trader, who is the controller of the personal data described here.</p>
<p>To contact us about privacy, including any of the requests below, email <a href="mailto:hello@pulsegmg.com">hello@pulsegmg.com</a>. We will only ask for what we need to find your data. You can also reach us through our YouTube channel, <a href="https://www.youtube.com/@PulseGMG" rel="noopener">youtube.com/@PulseGMG</a>, but email keeps your request private.</p>

<h2>The short version</h2>
<ul>
<li>This website sets no cookies of its own and runs no advertising or analytics trackers.</li>
<li>When you comment on one of our YouTube videos, our software reads the comment and an AI model (Claude, made by Anthropic) may draft a public reply from the channel.</li>
<li>We read public comments on YouTube and Reddit to see what gamers are asking about, and a video may quote a public Reddit comment. Our videos do not show Reddit usernames.</li>
<li>Our Discord bot keeps your Discord user ID with your XP, level and daily streak.</li>
<li>We never sell personal data and never use it for advertising.</li>
</ul>

<h2>What we use and why</h2>

<h3>Visiting this website</h3>
<p>pulsegmg.com does not ask you for personal information. The site is delivered through Cloudflare, which processes technical data such as your IP address to serve pages and protect the site from attacks. We read the country Cloudflare reports for your connection to send shop links to your nearest Amazon store, and we count shop page visits by country. We do not store your IP address.</p>
<p>Videos are embedded from YouTube in privacy-enhanced mode (youtube-nocookie.com): YouTube does not store information about you until you play a video, and after that YouTube's own privacy policy applies. Shop links carry our Amazon Associates tag so Amazon can credit us for qualifying purchases. Amazon may set cookies when you visit its store and its privacy notice applies there.</p>

<h3>Comments on our YouTube videos</h3>
<p>Mainly while a video is new (from its first hour or so for a Short to its first day or two for a long video), our software reads its newest comments through YouTube's API: the comment's text, its ID, its like count, when it was posted and the commenter's channel ID (used only so we never answer ourselves). Some of our tools also read the commenter's display name.</p>
<p>We send the comment text to Claude with facts from the video's script, and in some cases the commenter's display name so a reply can address them. Claude suggests whether to reply and what to say. Replies are posted publicly from the Pulse Gaming channel, a limited number per video. We keep a record of each comment our software has looked at (its ID, its text, our decision and any reply) so we never answer the same comment twice, plus daily totals of replies. Records that include a comment's text are deleted after 90 days.</p>
<p>Once a day we also read the comments on our recent long videos and use Claude to pick out games people have asked us to cover next. We keep only the game names and how many people asked, not the comments.</p>

<h3>Public comments on other YouTube channels</h3>
<p>To understand what gamers are asking about a story, our software may read the top public comments on other channels' videos on the same topic and send the comment text, without names, to Claude to find the common questions. We do not keep those comments.</p>

<h3>Reddit</h3>
<p>Our software can read public Reddit posts and their top comments as story leads, including the commenter's Reddit username and the comment's score. A story record keeps the top comments with their usernames and scores, and a video may quote a comment on screen. Our videos do not show Reddit usernames. Some older videos did; if one shows yours, ask us and we will review it.</p>

<h3>Our Discord server</h3>
<p>If you join our Discord server, our bot welcomes you by your Discord username and keeps your Discord user ID together with your XP, level, message count and daily streak, and your entries in predictions, trivia and giveaways. It counts your messages to award XP but does not keep what you write. Discord processes everything you post under its own privacy policy.</p>

<h3>Facebook, Instagram, TikTok and X</h3>
<p>We publish our own posts on these platforms. On Facebook and Instagram we read how many comments a post has received, not who wrote them. Each platform controls the account, comment and analytics data it holds about you.</p>

<h3>Creators whose footage we use</h3>
<p>When we use gameplay that a creator has licensed under Creative Commons, we show their channel name on screen and in the description, as the licence requires.</p>

<h2>Our lawful basis</h2>
<p>We rely on legitimate interests (Article 6(1)(f) of the UK GDPR): running and growing a gaming news channel, replying to viewers, covering the stories people want, crediting creators and running a community server. We only use comments that are already public or that you post in our own spaces, we keep as little as we can, and our replies are public and easy to ignore, so we consider that these interests are not outweighed by yours. You can object at any time (see below).</p>
<p>No decision with legal or similarly significant effects is made about you automatically. The most our software decides on its own is whether to reply to your comment or skip it.</p>

<h2>Who else handles it</h2>
<ul>
<li><b>Anthropic</b> (Claude) processes comment text, and sometimes display names, on our behalf to suggest replies and spot common questions.</li>
<li><b>Google (YouTube)</b>: we read comments and post replies through YouTube's API.</li>
<li><b>Reddit</b> is the source of the public posts and comments we read.</li>
<li><b>Discord</b> hosts our server and the bot's connection to it.</li>
<li><b>Cloudflare</b> delivers this website and connects it to our own server in the UK, where our records are kept.</li>
<li><b>Meta, TikTok and X</b> host the posts we publish there.</li>
<li><b>Amazon</b> runs the stores our shop links go to.</li>
</ul>
<p>Anthropic, Google, Cloudflare and Discord are based in the United States or process data there. Where personal data leaves the UK, we rely on the safeguards UK law requires, such as the UK-US data bridge or the provider's international data transfer terms.</p>

<h2>How long we keep it</h2>
<ul>
<li><b>Records of YouTube comments our software has looked at</b> (the comment's text, our decision and any reply): deleted after 90 days, or sooner if you ask. Some of our tools keep only the IDs of comments they answered, with no text, so they never reply twice; ask and we will delete yours.</li>
<li><b>Comments read to find questions or requests:</b> not kept. Only game names and counts are kept.</li>
<li><b>Reddit comments in story records:</b> kept with the story; ask and we will delete yours.</li>
<li><b>Discord XP, levels and streaks:</b> kept while the bot runs; ask and we will delete yours.</li>
<li><b>Our public replies</b> stay on YouTube until we delete them, or until you delete the comment they answer.</li>
<li><b>Website:</b> we keep only counts of shop visits by country. Cloudflare keeps its own technical logs under its own policy.</li>
</ul>

<h2>Your rights</h2>
<p>You can ask us for a copy of your data, to correct it, to delete it or to restrict how we use it, and you can object to our use of it at any time. If you object, we will stop replying to you or featuring your comments and delete what we hold, unless we have a compelling reason to keep it. To help us find your data, tell us which comment it is (a link, or the video and what you wrote), your Reddit username or your Discord username. We will respond within one month.</p>
<p>You can also delete your own comments on YouTube, Reddit or Discord at any time. That removes them from the platform; tell us as well if you want our copy deleted.</p>

<h2>Complaints</h2>
<p>If you are unhappy with how we have handled your data, please complain to us first, using the contact route above. We will acknowledge your complaint within 30 days and answer it without undue delay, as the Data (Use and Access) Act 2025 requires.</p>
<p>If you are still not satisfied, you can complain to the UK regulator, the Information Commission (still widely known as the ICO): <a href="https://ico.org.uk/make-a-complaint/" rel="noopener">ico.org.uk/make-a-complaint</a>.</p>

<h2>Changes</h2>
<p>We will update this page when what we do with personal data changes, and change the date at the top.</p>`;
