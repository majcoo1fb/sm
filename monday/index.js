import axios from "axios";

export async function createTask(summary, slackUser, slackLink) {
  const query = `
    mutation {
      create_item(board_id: ${process.env.MONDAY_BOARD_ID}, item_name: "${summary}", column_values: "${JSON.stringify({
        text_mkt8cqag: slackUser,
        status: { label: "Working on it" },
        date4: { date: new Date().toISOString().split("T")[0] }
      }).replace(/"/g, '\\"')}")
      { id }
    }
  `;

  try {
    const res = await axios.post("https://api.monday.com/v2", { query }, {
      headers: {
        Authorization: process.env.MONDAY_API_KEY,
        "Content-Type": "application/json",
      },
    });

    const data = res.data?.data?.create_item;
    if (!data) console.error("❌ Monday API response:", res.data);
    return data;
  } catch (err) {
    console.error("❌ Error while creating task:", err.response?.data || err.message);
    return null;
  }
}

export async function completeTask(taskId, designerId, timestamp, createdAt) {
  const finishDate = new Date(timestamp * 1000).toISOString().split("T")[0];
  const gapText = `${Math.round((timestamp * 1000 - new Date(createdAt).getTime()) / 3600000)}h`;

  const columnValues = {
    status: { label: "Done" },
    date_mkt86fjx: { date: finishDate },
    text_mkt8zwjz: gapText
  };

  if (designerId) {
    columnValues.multiple_person_mkt82xp7 = {
      personsAndTeams: [{ id: designerId, kind: "person" }]
    };
  }

  const query = `
    mutation {
      change_multiple_column_values(item_id: ${taskId}, board_id: ${process.env.MONDAY_BOARD_ID}, column_values: "${JSON.stringify(columnValues).replace(/"/g, '\\"')}")
      { id }
    }
  `;

  try {
    await axios.post("https://api.monday.com/v2", { query }, {
      headers: {
        Authorization: process.env.MONDAY_API_KEY,
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    console.error("❌ Error while completing task:", err.response?.data || err.message);
  }
}