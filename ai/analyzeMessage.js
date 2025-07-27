import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function analyzeMessage(text) {
  const prompt = `
Decide if this Slack message is a task. If yes, give a short summary.

Message: "${text}"

Respond in JSON:
{ "isTask": true|false, "summary": "..." }
  `;

  const res = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
  });

  try {
    return JSON.parse(res.choices[0].message.content);
  } catch {
    return { isTask: false };
  }
}
