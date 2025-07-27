// ✅ /api/slack.js – Slack bot handler with Upstash Redis integration
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
  // napln si vlastné mapovanie Slack ID -> Monday meno
  // "U123ABC": "marian.z@firma.com",
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

 // 🖼️ Handle image in thread
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
    const mondayUserName = slackMap[user] || "missing";

    // ✅ Update task in Monday
    await completeTask(taskId, mondayUserName, validFile.created, createdAt);

    // ✅ Add ✅ emoji
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

    // ✅ Notify in thread
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

  return res.status(200).send("Ignored file");
}

    // ✅ Send confirmation to thread
    await slackClient.chat.postMessage({
      channel,
      thread_ts,
      text: `✅ Designer assigned and task marked as done!`,
    });

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

  const slackLink = `https://slack.com/app_redirect?channel=${channel}&message_ts=${ts}`;
  const task = await createTask(result.summary, user, slackLink);
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
    text: `✅ Task created!\nDrop your PNG/JPG here when ready.`,
  });

  res.status(200).send("Task created");
}