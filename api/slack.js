// ✅ /api/slack.js – Slack bot handler for Vercel with Monday + OpenAI integration + Upstash
import { buffer } from "micro";
import { WebClient } from "@slack/web-api";
import fs from "fs";
import path from "path";
import { analyzeMessage } from "../ai/analyzeMessage.js";
import { createTask, completeTask } from "../monday/index.js";
import { Redis } from "@upstash/redis";

const slackMap = JSON.parse(fs.readFileSync(path.resolve("slackMap.json"), "utf8"));
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
const redis = Redis.fromEnv();

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

  // ✅ Handle Slack URL verification
  if (payload.type === "url_verification") {
    return res.status(200).send(payload.challenge);
  }

  const event = payload.event;
  if (!event || event.subtype === "bot_message") {
    return res.status(200).send("Ignore bot messages");
  }

  const { text, ts, user, thread_ts, channel, files } = event;

  // 🖼️ Handle image in thread
  if (thread_ts && files?.length) {
    const validFile = files.find(f => /\.(png|jpe?g)$/i.test(f.name));
    if (validFile) {
      const threadData = await redis.get(thread_ts);
      if (!threadData) {
        await slackClient.chat.postMessage({
          channel,
          thread_ts,
          text: `:warning: Could not find matching task for this thread.`
        });
        return res.status(200).send("No matching task");
      }

      const { taskId, createdAt } = threadData;
      const designerEmail = slackMap[user] || null;
      if (!designerEmail) {
        await slackClient.chat.postMessage({
          channel,
          thread_ts,
          text: `:warning: No Monday mapping found for <@${user}>. Skipping assignment.`
        });
        return res.status(200).send("No mapping");
      }

      await completeTask(taskId, designerEmail, validFile.created, createdAt);

      await slackClient.reactions.add({
        name: "white_check_mark",
        channel,
        timestamp: ts,
      });

      await slackClient.chat.postMessage({
        channel,
        thread_ts,
        text: `✅ Assigned <@${user}> as task owner.`,
      });

      return res.status(200).send("Handled image upload");
    }
  }

  // 🧠 Analyze message
  const result = await analyzeMessage(text);
  if (!result.isTask) return res.status(200).send("Not a task");

  // ✅ Add 🤖 reaction
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

  // 🔍 Get author name from Slack profile
  let authorName = user;
  try {
    const userInfo = await slackClient.users.info({ user });
    authorName = userInfo.user?.real_name || userInfo.user?.name || user;
  } catch (err) {
    console.warn("⚠️ Could not fetch user info:", err);
  }

  const slackLink = `https://slack.com/app_redirect?channel=${channel}&message_ts=${ts}`;
  const task = await createTask({ summary: result.summary, author: authorName, slackLink });

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
📝 Summary: ${result.summary}
Drop your PNG/JPG here when ready.`,
  });

  res.status(200).send("Task created");
}
