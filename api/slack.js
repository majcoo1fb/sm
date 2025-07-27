// ✅ /api/slack.js – Slack bot handler with persistent fallback for missing threadMap
import { buffer } from "micro";
import { WebClient } from "@slack/web-api";
import fs from "fs";
import path from "path";
import { analyzeMessage } from "../ai/analyzeMessage.js";
import { createTask, completeTask } from "../monday/index.js";

const slackMap = JSON.parse(fs.readFileSync(path.resolve("slackMap.json"), "utf8"));
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
const threadMapFile = path.resolve(".threadMap.json");
let threadMap = {};

// Load persisted threadMap if available
if (fs.existsSync(threadMapFile)) {
  try {
    threadMap = JSON.parse(fs.readFileSync(threadMapFile, "utf8"));
  } catch (e) {
    console.error("❌ Failed to load threadMap file", e);
  }
}

function persistThreadMap() {
  try {
    fs.writeFileSync(threadMapFile, JSON.stringify(threadMap, null, 2));
  } catch (e) {
    console.error("❌ Failed to persist threadMap", e);
  }
}

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

  // 🖼️ Handle image in thread
  if (thread_ts && files?.length) {
    const validFile = files.find(f => /\.(png|jpe?g)$/i.test(f.name));

    console.log("🧵 thread_ts:", thread_ts);
    console.log("🗂 files:", files);
    console.log("🧠 threadMap[thread_ts]:", threadMap[thread_ts]);
    console.log("👤 Slack user:", user);

    if (validFile) {
      if (!threadMap[thread_ts]) {
        await slackClient.chat.postMessage({
          channel,
          thread_ts,
          text: `⚠️ Could not find matching task for this thread.`,
        });
        return res.status(200).send("No threadMap");
      }

      const { taskId, createdAt } = threadMap[thread_ts];
      const mondayUser = slackMap[user] || null;

      if (!mondayUser) {
        console.warn("⚠️ No mapping for Slack user:", user);
        await completeTask(taskId, null, validFile.created, createdAt);
        return res.status(200).send("Marked done without assignee");
      }

      await completeTask(taskId, mondayUser, validFile.created, createdAt);
      return res.status(200).send("Marked done with assignee");
    }
    return res.status(200).send("Thread image ignored or invalid");
  }

  // 🧠 Analyze message
  const result = await analyzeMessage(text);
  if (!result.isTask) return res.status(200).send("Not a task");

  // ✅ Try to react 🤖, skip if already exists
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

  const slackLink = `https://slack.com/app_redirect?channel=${channel}&message_ts=${ts}`;
  const task = await createTask(result.summary, user, slackLink);

  if (!task || !task.id) {
    console.error("❌ Task creation failed:", task);
    return res.status(500).send("Failed to create Monday task");
  }

  threadMap[ts] = {
    taskId: task.id,
    createdAt: new Date().toISOString(),
  };
  persistThreadMap();

  await slackClient.chat.postMessage({
    channel,
    thread_ts: ts,
    text: `✅ Task created!\nDrop your PNG/JPG here when ready.`,
  });

  res.status(200).send("Task created");
}
