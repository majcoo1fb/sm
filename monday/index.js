export async function createTask({ summary, author, slackLink }) {
  const itemName = typeof summary === "string" ? summary : String(summary);

  const columnValues = {
    text_mkt8cq0ag: author, // Author (text)
    text_mkt8jq0t: "",      // Designer (prázdne zatiaľ)
    status: { index: 0 },   // "Working on it"
    date4: { date: new Date().toISOString().split("T")[0] }, // Create Date
    link: { url: slackLink, text: "Slack message" },
    duration_mkt8v8yq: {
      started_at: new Date().toISOString() // Time Tracker štart
    }
  };

  const query = `
    mutation {
      create_item(
        board_id: ${process.env.MONDAY_BOARD_ID},
        item_name: "${itemName}",
        column_values: ${JSON.stringify(JSON.stringify(columnValues))}
      ) {
        id
      }
    }
  `;

  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.MONDAY_API_TOKEN,
    },
    body: JSON.stringify({ query }),
  });

  const json = await res.json();

  if (!json?.data?.create_item?.id) {
    console.error("❌ Monday API response:", JSON.stringify(json, null, 2));
  }

  return json?.data?.create_item;
}

export async function completeTask(taskId, designerEmail, finishTimestamp, createdAt) {
  const finishDate = new Date(finishTimestamp * 1000); // Slack timestamp je v sekundách
  const createdDate = new Date(createdAt);

  const columnValues = {
    status: { index: 1 }, // "Done"
    date_mkt86fjx: { date: finishDate.toISOString().split("T")[0] }, // Finish Date
    text_mkt8jq0t: designerEmail, // Designer ako email (text column)
    duration_mkt8v8yq: {
      started_at: createdDate.toISOString(),
      ended_at: finishDate.toISOString()
    }
  };

  const query = `
    mutation {
      change_multiple_column_values(
        item_id: ${taskId},
        board_id: ${process.env.MONDAY_BOARD_ID},
        column_values: ${JSON.stringify(JSON.stringify(columnValues))}
      ) {
        id
      }
    }
  `;

  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.MONDAY_API_TOKEN,
    },
    body: JSON.stringify({ query }),
  });

  const json = await res.json();

  if (!json?.data?.change_multiple_column_values?.id) {
    console.error("❌ Monday completeTask error:", JSON.stringify(json, null, 2));
  }

  return json?.data?.change_multiple_column_values;
}
