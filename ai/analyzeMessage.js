import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function analyzeMessage(text) {
  const prompt = `
You're an assistant that reads Slack messages and decides whether the message is a **new task for a sports design team**, especially related to creating banners for betting promotions.

Instructions:
- Understand full context of the message, including betting terminology and common phrases used in requests.
- Detect **requests for banners or graphics**, even if the message is long or has multiple betting picks.
- Phrases like "GH: [tip]", "BOB: [match]", "prepare banners", "promo odds", "today’s picks", or "anytime goalscorer" likely mean a task.
- If the message includes odds (e.g. from 2.12 > 2.50), match or player names, and words like "prepare", "today’s banners", "promo", then it's a task.
- If the message is just analysis, opinions, or general sports talk, then it's not a task.

Your goal is to:
- Return \`isTask: true\` if the message is requesting any design work (banners, graphics).
- Provide a short summary of what the task is about. If it's not a task, explain what the message is.

---

Message:
"""${text}"""

---

Reply in valid JSON:
{
  "isTask": true or false,
  "summary": "If true, give a clear task summary for the designer (e.g. 'Two banners for today: FC Copenhagen win + BTTS No, and Braithwaite anytime scorer for Gremio'). If false, describe the message as general discussion."
}
  `;

  const res = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
  });

  try {
    const content = res.choices[0].message.content.trim();
    return JSON.parse(content);
  } catch (err) {
    console.error("❌ Failed to parse OpenAI response:", res.choices[0].message.content);
    return { isTask: false };
  }
}
