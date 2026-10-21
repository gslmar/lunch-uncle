import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { runLoop } from "../src/loop.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const env = { OPENCODE_API_KEY: "test", GOOGLE_PLACES_API_KEY: "test" };

// A model reply that always asks for the rain forecast.
const toolCallReply = {
  choices: [
    {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "get_rain_forecast", arguments: "{}" },
          },
        ],
      },
    },
  ],
};

const forecastPayload = {
  data: {
    items: [
      {
        valid_period: { text: "12 pm to 2 pm" },
        forecasts: [{ area: "Kallang", forecast: "Cloudy" }],
      },
    ],
  },
};

test("runLoop stops after MAX_ROUNDS when the model keeps calling tools", async () => {
  let modelCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/chat/completions")) {
      modelCalls++;
      return Response.json(toolCallReply);
    }
    return Response.json(forecastPayload);
  };

  const reply = await runLoop([], "rain or not?", env);

  assert.equal(modelCalls, 8);
  assert.match(reply, /tried too many times/);
});

test("runLoop without a Places key drops only find_lunch_places", async () => {
  let sentTools;
  globalThis.fetch = async (_url, init) => {
    sentTools = JSON.parse(init.body).tools.map((t) => t.function.name);
    return Response.json({
      choices: [{ message: { role: "assistant", content: "Cannot check now lah." } }],
    });
  };

  const reply = await runLoop([], "where to eat?", {
    OPENCODE_API_KEY: "test",
  });

  assert.equal(reply, "Cannot check now lah.");
  assert.deepEqual(sentTools, ["get_rain_forecast", "get_bus_arrivals"]);
});
