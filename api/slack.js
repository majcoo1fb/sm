import { buffer } from "micro";
import { WebClient } from "@slack/web-api";
import { analyzeMessage } from "../../ai/analyzeMessage";
import { createTask, completeTask } from "../../monday";
import slackMap from "../../slackMap.json";

export const config = {
  api: {
    bodyParser: false,
  },
};

const threadMap = {};

const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

export default async function handler(req, res) {
  const rawBody = (await buffer(req)).toString();
  const slackSignature = req.headers["x-slack-signature"];
  const timestamp = req.headers["x-slack-request-timestamp"];

  // Skip verification here – add crypto-based verification if needed for security

  const payload = JSON.parse(rawBody);

  if (payload.event?.type === "message" && !payload.event.subtype) {
    const { text, ts, user, thread_ts, channel, files } = payload.event;

    // FILE REPLY (thread response with image)
    if (thread_ts && files?.length) {
      const validFile = files.find(f => /\.(png|jpe?g)$/i.test(f.name));
      if (validFile && threadMap[thread_ts]) {
        const { taskId, createdAt } = threadMap[thread_ts];
        const mondayUser = slackMap[user] || null;
        if (!mondayUser) return res.status(200).send("No mapping");

        await completeTask(taskId, mondayUser, validFile.created, createdAt);
      }
      return res.status(200).send("File handled");
    }

    // ANALYZE NEW MESSAGE
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

  res.status(200).send("OK");
}
