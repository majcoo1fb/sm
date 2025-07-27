import { buffer } from "micro";
import { WebClient } from "@slack/web-api";
import fs from "fs";
import path from "path";
import { analyzeMessage } from "../ai/analyzeMessage.js";
import { createTask, completeTask } from "../monday/index.js";

const slackMap = JSON.parse(fs.readFileSync(path.resolve("slackMap.json"), "utf8"));
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
const threadMap = {}; // cache for thread ↔ taskId

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

  // ✅ Handle Slack URL verification challenge
  if (payload.type === "url_verification") {
    return res.status(200).send(payload.challenge);
  }

  const event = payload.event;
  if (!event || event.subtype === "bot_message") {
    return res.status(200).send("Ignore bot messages");
  }

  const { text, ts, user, thread_ts, channel, files } = event;

  // 🖼️ Handle image upload in thread
  if (thread_ts && files?.length) {
    const validFile = files.find(f => /\.(png|jpe?g)$/i.test(f.name));
    if (validFile && threadMap[thread_ts]) {
      const { taskId, createdAt } = threadMap[thread_ts];
      const mondayUser = slackMap[user] || null;
      if (!mondayUser) return res.status(200).send("No mapping");

      await completeTask(taskId, mondayUser, validFile.created, createdAt);
    }
    return res.status(200).send("Handled image");
  }

  // 🧠 Analyze message content
  const result = await analyzeMessage(text);
  if (!result.isTask) return res.status(200).send("Not a task");

  await slackClient.reactions.add({
    name: "robot_face",
    channel,
    timestamp: ts,
  });

  const slackLink = `https://slack.com/app_redirect?channel=${channel}&message_ts=${ts}`;
  const task = await createTask(result.summary, user, slackLink);

  threadMap[ts] = {
    taskId: task.id,
    createdAt: new Date().toISOString(),
  };

  await slackClient.chat.postMessage({
    channel,
    thread_ts: ts,
    text: `✅ Task created!\nDrop your PNG/JPG here when ready.`,
  });

  res.status(200).send("Task created");
}
