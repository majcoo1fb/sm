import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function analyzeMessage(text) {
  const prompt = `
You're an assistant that analyzes Slack messages and determines whether the message contains a **new design task request** for the sports design team (e.g. a new banner or creative asset request).

Strict rules:
- Only return "isTask": true if the message is a **new, original task**, such as a request to create a new banner, graphic, promo asset, etc.
- Do NOT mark as a task if the message:
  - Follows up on existing tasks (e.g. status updates, asking for timelines, reviews).
  - Mentions edits, revisions, or feedback for already started banners.
  - Asks for checking progress, correcting names, or updating elements.
  - References previous work or uses phrases like “needs updating”, “half-completed”, “remove name”, “add images”, or “returned”.

---

Message:
"""${text}"""

---

Reply in valid JSON:
{
  "isTask": true or false,
  "summary": "If true, summarize the new design task. If false, describe that it's a follow-up or status message, not a new task."
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
