import { WebClient } from "@slack/web-api";
import { analyzeMessage } from "../../ai/analyzeMessage";
import { createTask, completeTask } from "../../monday";
import slackMap from "../../slackMap.json";

const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

const threadMap = {};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  const payload = req.body?.event;

  if (!payload || payload.type !== "message" || payload.subtype === "bot_message") {
    return res.status(200).send("Ignoring");
  }

  const { text, ts, user, thread_ts, channel, files } = payload;

  // File upload
  if (thread_ts && files?.length) {
    const validFile = files.find(f => /\.(png|jpe?g)$/i.test(f.name));
    if (validFile && threadMap[thread_ts]) {
      const { taskId, createdAt } = threadMap[thread_ts];
      const mondayUser = slackMap[user] || null;
      if (!mondayUser) return res.status(200).send("No mapping");

      await completeTask(taskId, mondayUser, validFile.created, createdAt);
    }
    return res.status(200).send("Handled file");
  }

  // AI detection
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

  return res.status(200).send("Task created");
}
