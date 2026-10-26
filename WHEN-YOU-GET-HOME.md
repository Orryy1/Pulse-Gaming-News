# Pulse: your to-do list when you get home

Everything else is automatic. Do these in order. Total time: about 30 minutes.
If anything looks different from what's written here, stop and tell Claude what you see.

---

## 1. Re-sign in to YouTube Studio (2 minutes)

Why: Google wants to check it's you before it lets the factory change video settings again.

1. On the PC, open **Brave** (the orange lion icon).
2. Go to **studio.youtube.com**.
3. Check the picture in the top-right corner. If it isn't the orange Pulse logo, click it, then click **Switch account** and choose **Pulse Gaming**.
4. Click **Content** on the left, then click the title of any video.
5. If a box says **"Verify it's you"**, type your Google password and click **Next**. Do any phone check it asks for.
6. You're done when the video's details page opens and nothing asks you again.
7. Leave Brave open. It's fine behind other windows; just don't close it.
8. On 26 Oct Google started blocking automated clicks in Studio's "related video" picker (it opens empty). Claude won't try to get around that. The task now skips linking when it happens and carries on with comment hearts. Linking by hand is optional (see section 9).

---

## 2. Click "Run now" on five tasks (10 minutes)

Why: each task stops at its first permission box until you approve it once. After that it runs by itself forever.

1. Open the **Claude** desktop app.
2. In the left sidebar, click **Scheduled**.
3. Click **Pulse: related videos and comment hearts**, then click **Run now**.
4. Click the task's chat in the left sidebar to open it. The task pauses at a box asking to allow something, and it waits there until you click. Click **Always allow** (or **Allow** if there's no "Always allow"). Keep that chat open for a minute in case a second box appears.
5. Let it finish. That takes a few minutes, and it's fine to look away.
6. Do the same (steps 3 to 5) for each of these:
   - **Pulse: YouTube Community posts**
   - **Pulse: X posts**
   - **Pulse: weekly "rank next" poll**
   - **Pulse: weekly review of the factory's QA notes**
7. **Don't** click Run now on **"Pulse: desk test verdict, then start Pip"**. It must wait until 8 November.

---

## 3. Bluesky (5 minutes)

1. On your phone or the PC, go to **bsky.app** and tap **Create account**.
   - Use your email.
   - For the handle, pick something like **pulsegmg** (it becomes pulsegmg.bsky.social).
   - Set the display name to **Pulse Gaming**.
2. Once you're in: **Settings**, then **Privacy and security**, then **App passwords**, then **Add App Password**.
3. Name it **Pulse factory** and tap **Create**.
4. Copy the code it shows. It looks like `abcd-efgh-ijkl-mnop`.
5. On the **PC**, open this address in any browser: **http://localhost:8080/connect?account=bluesky**
6. Type your handle (for example `pulsegmg.bsky.social`) and paste the code. Click **Connect**.
7. You're done when the page says **"Bluesky is connected"**. New Shorts then go to Bluesky about 20 minutes after YouTube.

---

## 4. Threads (15 minutes)

### Part A: make the Threads profile (phone)

1. Install the **Threads** app.
2. Tap **Log in with Instagram** and choose **@pulse.gmg**.
3. Import the profile from Instagram, then tap **Join Threads**.

### Part B: get the two keys (PC, Meta's developer site)

1. Go to **developers.facebook.com** and log in. Click **My Apps**, then open the app you use for Pulse's Facebook and Instagram posting.
2. Click **Use cases**, then **Add use case**, choose **Access the Threads API**, then **Add**.
3. In that use case, open **Permissions** and add **threads_basic** and **threads_content_publish**.
4. In that use case's **Settings**, under **Redirect callback URLs**, add: **https://pulsegmg.com/oauth/threads**
   - If it also asks for "Uninstall" and "Delete" callback URLs, put **https://pulsegmg.com/** in both.
   - Then click **Save**.
5. Go to **App roles**, then **Roles**, then **Add people**, then **Threads testers**, and add **pulse.gmg**.
6. On your phone, in the Threads app: **Settings**, then **Account**, then **Website permissions**, then **Invites**. **Accept** the invite.
7. Back on the PC, in the Threads use case **Settings**, find **Threads app ID** and **Threads app secret**. Click **Show** next to the secret.

### Part C: connect (PC)

1. Open **http://localhost:8080/connect?account=threads**
2. Paste the **Threads app ID** and **Threads app secret**, then click **Save and continue**.
3. Threads asks you to allow Pulse. Click **Allow**.
4. You're done when the page says **"Threads is connected"**. New Shorts then go to Threads about 45 minutes after YouTube.

---

## 5. TikTok: every day, about 2 minutes

Why: TikTok hides videos posted by automation (they got 0 views), but the ones you posted yourself reached 939 views. So the factory sends you the day's **two best** Shorts as drafts, and you post them.

1. When Discord pings you with **"Your turn, TikTok"**, tap the link on your phone.
2. Tap the button that copies the caption and opens TikTok.
3. In TikTok, open the draft from your inbox, paste the caption, then tap **Post**.

---

## 6. GTA 6 launch week (from 19 November)

1. **Stream GTA 6 on Twitch from your Xbox, as you normally do.** The factory automatically cuts the best moments from your broadcasts into Shorts, focusing on hidden details and surprises.
2. Gameplay Shorts **always wait for your tap** in Discord before posting. Tap **Approve** on the good ones.
3. That's it. The launch plan (news, "why" Shorts, a hidden-details series and a long "everything hidden in GTA 6's map" video) is already in the factory's calendar.

---

## 7. Optional: a small paid push (your call)

Only if you want to, and only during launch week:

1. Open the **YouTube Studio** app on your phone, go to **Content**, and pick the best GTA video that week.
2. Tap **Promote**, set a budget of **£20 to £50**, and let YouTube choose the audience.
3. Pay with your card.

Claude never spends money for you.

---

## 8. Already booked, nothing to do now

- **29 October, 10:45:** the Mac mini unlock day. A Claude task walks you through it.
- **8 November:** Claude judges the Alice narrator test, the desk question and the leak Shorts, then starts the Pip mascot test.
- **Every Monday:** Claude reads the week's quality notes, fixes what keeps going wrong, and reports.
- **Whenever a Short takes off:** you get a Discord ping, and the factory makes more on that game for three days.

---

## 9. Optional: link the best Shorts to a long video by hand (about 30 seconds each)

Why: a "Related video" link under a Short sends its viewers to a long video. Google now blocks Claude from setting it, but it works fine when you do it. These are the ones most worth doing:

| Open this Short in Studio                  | Pick this long video                          |
| ------------------------------------------ | --------------------------------------------- |
| studio.youtube.com/video/VLfCkcXnQ2o/edit  | Every Mainline GTA Game, Ranked Worst to Best |
| studio.youtube.com/video/lP4a-dEGgoE/edit  | Every Mainline GTA Game, Ranked Worst to Best |
| studio.youtube.com/video/\_iaczXRXw_Q/edit | Every Mainline GTA Game, Ranked Worst to Best |
| studio.youtube.com/video/tSuaEe5rmjI/edit  | Every Mainline GTA Game, Ranked Worst to Best |
| studio.youtube.com/video/Os_yeSFpGh0/edit  | Call of Duty Campaigns Ranked Worst to Best   |
| studio.youtube.com/video/\_zy96Y-npM8/edit | Call of Duty Campaigns Ranked Worst to Best   |

For each one:

1. Open the address in Brave.
2. Scroll down to **Related video** and click the box.
3. Click the long video named in the table.
4. Click **Save** (top right).
