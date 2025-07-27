// ✅ /api/slack.js – Slack bot handler with Upstash Redis, Monday, Slack reactions, assignment, and time tracking
import { buffer } from "micro";
import { WebClient } from "@slack/web-api";
import { analyzeMessage } from "../ai/analyzeMessage.js";
import { createTask, completeTask } from "../monday/index.js";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const slackMap = {
  // example: "U04ABC123": "marian.z@firma.com"
};

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

  // 🖼️ Handle image in thread (delivery)
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
        return res.status(200).send("No threadMap");
      }

      const { taskId, createdAt } = taskRecord;
      const mondayUserEmail = slackMap[user] || null;
      if (!mondayUserEmail) {
        await slackClient.chat.postMessage({
          channel,
          thread_ts,
          text: `⚠️ No Monday mapping found for <@${user}>. Skipping assignment.`,
        });
        return res.status(200).send("No Monday mapping");
      }

      await slackClient.reactions.add({
        name: "white_check_mark",
        channel,
        timestamp: event.ts,
      });

      await slackClient.chat.postMessage({
        channel,
        thread_ts,
        text: `✅ Assigned <@${user}> as the task owner.`,
      });

      await completeTask(taskId, mondayUserEmail, validFile.created, createdAt);
      return res.status(200).send("Marked done");
    }
    return res.status(200).send("Ignored file");
  }

  // 🧠 Analyze message
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
      console.error("❌ Failed to add reaction:", err);
    }
  }

  const userInfo = await slackClient.users.info({ user });
  const authorName = userInfo.user?.real_name || userInfo.user?.name || user;

  const slackLink = `https://slack.com/app_redirect?channel=${channel}&message_ts=${ts}`;
  const task = await createTask({
    summary: result.summary,
    author: authorName,
    slackLink,
    timeTracking: true,
  });

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
    text: `✅ Task created!
📝 *Summary for designer:* ${result.summary}
📎 Drop your PNG/JPG here when ready.`,
  });

  res.status(200).send("Task created");
}