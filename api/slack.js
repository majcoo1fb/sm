import { buffer } from "micro";
import crypto from "crypto";
import { WebClient } from "@slack/web-api";
import { analyzeMessage } from "../ai/analyzeMessage.js";
import { createTask, completeTask } from "../monday/index.js";
import { Redis } from "@upstash/redis";

console.log("🔧 Booting Slack handler...");

// Redis pre anti-duplicate ochranu
const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// Slack client
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

// Zakáže bodyParser (aby sme mali raw body)
export const config = {
  api: {
    bodyParser: false,
  },
};

function verifySlackSignature(req, rawBody) {
  const slackSignature = req.headers["x-slack-signature"];
  const slackTimestamp = req.headers["x-slack-request-timestamp"];

  if (!slackSignature || !slackTimestamp) {
    console.warn("❌ Missing Slack signature headers");
    return false;
  }

  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
  if (slackTimestamp < fiveMinutesAgo) {
    console.warn("❌ Slack timestamp too old");
    return false;
  }

  const sigBase = `v0:${slackTimestamp}:${rawBody}`;
  const mySig = `v0=` + crypto
    .createHmac("sha256", process.env.SLACK_SIGNING_SECRET)
    .update(sigBase)
    .digest("hex");

  const result = crypto.timingSafeEqual(Buffer.from(mySig), Buffer.from(slackSignature));
  if (!result) console.warn("❌ Signature mismatch");
  return result;
}

export default async function handler(req, res) {
  console.log("🔵 Incoming request:", req.method, req.url);

  if (req.method !== "POST") {
    console.warn("❌ Method not allowed");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const rawBody = (await buffer(req)).toString();
  console.log("🔵 Raw body received");

  if (!verifySlackSignature(req, rawBody)) {
    console.warn("❌ Invalid Slack signature");
    return res.status(401).send("Unauthorized");
  }
  console.log("✅ Slack signature verified");

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    console.error("❌ Failed to parse payload:", err);
    return res.status(400).send("Bad JSON");
  }

  console.log("🟡 Payload type:", payload.type);

  if (payload.type === "url_verification") {
    console.log("✅ Responding to Slack challenge");
    return res.status(200).send(payload.challenge);
  }

  const event = payload.event;
  if (!event) {
    console.warn("❌ Missing event in payload");
    return res.status(400).send("No event");
  }

  console.log("🔵 Slack Event:", event);

  if (
    event.subtype === "bot_message" ||
    event.bot_id ||
    event.user === process.env.BOT_USER_ID
  ) {
    console.log("🟡 Ignored bot/self message");
    return res.status(200).send("Ignored");
  }

  const { text, ts, user, thread_ts, channel, files } = event;
  console.log("📡 Received from channel:", channel);

  // 🚫 Check allowed channel
  if (channel !== process.env.CHANNEL_ID) {
    console.log("🟡 Skipping message from unauthorized channel");
    return res.status(200).send("Channel not monitored");
  }

  // Anti-duplicate
  const eventKey = `event:${ts}`;
  const alreadyHandled = await redis.get(eventKey);
  if (alreadyHandled) {
    console.warn("⚠️ Duplicate event detected, skipping.");
    return res.status(200).send("Duplicate event");
  }
  await redis.set(eventKey, "1", { ex: 60 });
  console.log("✅ Event is unique, continuing...");

  // Fetch user info
  let slackDisplayName = user;
  try {
    const userInfo = await slackClient.users.info({ user });
    slackDisplayName =
      userInfo.user?.profile?.real_name || userInfo.user?.name || user;
    console.log("✅ Slack display name:", slackDisplayName);
  } catch (err) {
    console.warn("⚠️ Failed to fetch Slack display name:", err);
  }

  // Handle image delivery in thread
  if (thread_ts && files?.length) {
    console.log("🟡 Image received in thread");

    const validFile = files.find((f) => /\.(png|jpe?g)$/i.test(f.name));
    if (!validFile) {
      console.log("🟡 No valid PNG/JPG found, skipping file handling.");
      return res.status(200).send("Ignored non-image file");
    }

    const taskRecord = await redis.get(thread_ts);
    if (!taskRecord) {
      console.warn("❌ No task mapping found for thread:", thread_ts);
      await slackClient.chat.postMessage({
        channel,
        thread_ts,
        text: `⚠️ Could not find matching task for this thread.`,
      });
      return res.status(200).send("No task mapping found");
    }

    const { taskId, createdAt } = taskRecord;
    console.log("✅ Matching task found:", taskId);

    await completeTask(taskId, slackDisplayName, validFile.created, createdAt);
    console.log("✅ Task marked complete");

    try {
      await slackClient.reactions.add({
        name: "white_check_mark",
        channel,
        timestamp: thread_ts,
      });
    } catch (err) {
      if (
        err.code === "slack_webapi_platform_error" &&
        err.data?.error === "already_reacted"
      ) {
        console.log("🟡 Already reacted");
      } else {
        console.error("❌ Reaction failed:", err);
      }
    }

    await slackClient.chat.postMessage({
      channel,
      thread_ts,
      text: `✅ Designer assigned: *${slackDisplayName}*\nTask marked as done.`,
    });

    return res.status(200).send("Marked done");
  }

  // AI analyze
  console.log("🧠 Analyzing message:", text);
  const result = await analyzeMessage(text);
  console.log("🧠 Analysis result:", result);

  if (!result.isTask) {
    console.log("🟡 Message is not a task, ignoring.");
    return res.status(200).send("Not a task");
  }

  try {
    await slackClient.reactions.add({
      name: "robot_face",
      channel,
      timestamp: ts,
    });
    console.log("✅ Reaction added");
  } catch (err) {
    if (
      err.code === "slack_webapi_platform_error" &&
      err.data?.error === "already_reacted"
    ) {
      console.log("🟡 Robot already reacted");
    } else {
      console.error("❌ Failed to add robot reaction:", err);
    }
  }

  const slackLink = `https://slack.com/app_redirect?channel=${channel}&message_ts=${ts}`;
  const task = await createTask(result.summary, slackDisplayName, slackLink);

  if (!task || !task.id) {
    console.error("❌ Task creation failed:", task);
    return res.status(500).send("Failed to create Monday task");
  }

  console.log("✅ Monday task created:", task.id);

  await redis.set(ts, {
    taskId: task.id,
    createdAt: new Date().toISOString(),
  });

  await slackClient.chat.postMessage({
    channel,
    thread_ts: ts,
    text: `✅ Task created!
🎨 *Design Summary:* _${result.summary}_
@sbdesigners , please take a look.
Drop your PNG/JPG here when ready.`,
  });

  console.log("✅ Summary posted in thread");

  res.status(200).send("Task created");
}
