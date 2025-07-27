import axios from "axios";

export async function createTask(summary, slackUser, slackLink) {
  const query = `
    mutation {
      create_item(board_id: ${process.env.MONDAY_BOARD_ID}, item_name: "${summary}", column_values: "${JSON.stringify({
        text: slackUser,
        long_text: { text: summary },
        link: { url: slackLink, text: "Slack link" },
        status: { label: "Open" }
      }).replace(/"/g, '\\"')}")
      { id }
    }
  `;

  const res = await axios.post("https://api.monday.com/v2", { query }, {
    headers: {
      Authorization: process.env.MONDAY_API_KEY,
      "Content-Type": "application/json",
    },
  });

  return res.data.data.create_item;
}

export async function completeTask(taskId, designer, timestamp, createdAt) {
  const duration = Math.round((timestamp * 1000 - new Date(createdAt).getTime()) / 1000);
  const query = `
    mutation {
      change_multiple_column_values(item_id: ${taskId}, board_id: ${process.env.MONDAY_BOARD_ID}, column_values: "${JSON.stringify({
        person: { personsAndTeams: [{ id: designer, kind: "person" }] },
        status: { label: "Done" },
        date4: { date: new Date(timestamp * 1000).toISOString().split("T")[0] },
        numbers: duration
      }).replace(/"/g, '\\"')}")
      { id }
    }
  `;

  await axios.post("https://api.monday.com/v2", { query }, {
    headers: {
      Authorization: process.env.MONDAY_API_KEY,
      "Content-Type": "application/json",
    },
  });
}
