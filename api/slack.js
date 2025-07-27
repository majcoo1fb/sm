import { buffer } from "micro";
import { WebClient } from "@slack/web-api";
import { analyzeMessage } from "../ai/analyzeMessage.js";
import { createTask, completeTask } from "../monday/index.js";
import { Redis } from "@upstash/redis";

// 👇 SlackMap: Slack ID → Designer meno (text)
const slackMap = {
  "U092HTKKG10": "Marian Z.",
  // doplň ďalších podľa potreby
};

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const rawBody = (await buffer(req)).toString();
  const payload = JSON.parse(rawBody);

  if (payload.type === "url_verification") {
    return res.status(200).send(payload.challenge);
  }

  const event = payload.event;
  if (!event || event.subtype === "bot_message" || event.bot_id || event.user === process.env.BOT_USER_ID) {
    return res.status(200).send("Ignore bot/self messages");
  }

  const { text, ts, user, thread_ts, channel, files } = event;

  // 🖼️ Handle image uploaded in thread
  if (thread_ts && files?.length) {
    const validFile = files.find(f => /\.(png|jpe?g)$/i.test(f.name));
    if (validFile) {
      const taskRecord = await redis.get(thread_ts);
      if (!taskRecord) {
        await slackClient.chat.postMessage({
          channel,
          thread_ts,
          text: `⚠️ Could not find matching task for this thread.`,
        });
        return res.status(200).send("No task mapping found");
      }

      const { taskId, createdAt } = taskRecord;
      const mondayUserName = slackMap[user] || "missing";

      await completeTask(taskId, mondayUserName, validFile.created, createdAt);

      try {
        await slackClient.reactions.add({
          name: "white_check_mark",
          channel,
          timestamp: thread_ts,
        });
      } catch (err) {
        if (err.code === "slack_webapi_platform_error" && err.data?.error === "already_reacted") {
          console.log("✅ Already reacted, skipping...");
        } else {
          console.error("❌ Failed to add checkmark reaction:", err);
        }
      }

      const designerMsg = mondayUserName === "missing"
        ? `⚠️ Designer not mapped for <@${user}> – saved as *missing*.`
        : `✅ Designer assigned: *${mondayUserName}*`;

      await slackClient.chat.postMessage({
        channel,
        thread_ts,
        text: `${designerMsg}\nTask marked as done.`,
      });

      return res.status(200).send("Marked done");
    }

    return res.status(200).send("Ignored non-image file");
  }

  // 🧠 Analyze if message is a task
  const result = await analyzeMessage(text);
  if (!result.isTask) return res.status(200).send("Not a task");

  try {
    await slackClient.reactions.add({
      name: "robot_face",
      channel,
      timestamp: ts,
    });
  } catch (err) {
    if (err.code === "slack_webapi_platform_error" && err.data?.error === "already_reacted") {
      console.log("🤖 Already reacted, skipping...");
    } else {
      console.error("❌ Failed to add robot reaction:", err);
    }
  }

  // 👤 Získaj meno používateľa
  let slackDisplayName = user;
  try {
    const userInfo = await slackClient.users.info({ user });
    slackDisplayName = userInfo.user?.profile?.real_name || userInfo.user?.name || user;
  } catch (err) {
    console.warn("⚠️ Failed to fetch Slack username, using fallback ID");
  }

  const slackLink = `https://slack.com/app_redirect?channel=${channel}&message_ts=${ts}`;
  const task = await createTask(result.summary, slackDisplayName, slackLink);

  if (!task || !task.id) {
    console.error("❌ Task creation failed:", task);
    return res.status(500).send("Failed to create Monday task");
  }

  await redis.set(ts, {
    taskId: task.id,
    createdAt: new Date().toISOString(),
  });

  await slackClient.chat.postMessage({
    channel,
    thread_ts: ts,
    text: `✅ Task created!\n🎨 *Design Summary:* _${result.summary}_\nDrop your PNG/JPG here when ready.`,
  });

  res.status(200).send("Task created");
}
