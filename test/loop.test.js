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
  let sentBody;
  globalThis.fetch = async (_url, init) => {
    sentBody = JSON.parse(init.body);
    return Response.json({
      choices: [{ message: { role: "assistant", content: "Cannot check now lah." } }],
    });
  };

  const reply = await runLoop([], "where to eat?", {
    OPENCODE_API_KEY: "test",
  });

  assert.equal(reply, "Cannot check now lah.");
  assert.deepEqual(
    sentBody.tools.map((t) => t.function.name),
    ["get_rain_forecast", "get_bus_arrivals"],
  );
  assert.match(sentBody.messages[0].content, /find_lunch_places is unavailable/);
});

test("runLoop refuses a tool call that was not offered", async () => {
  const calls = [];
  let modelCalls = 0;
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    modelCalls++;
    if (modelCalls === 1) {
      return Response.json({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "find_lunch_places",
                    arguments: '{"query":"chicken rice"}',
                  },
                },
              ],
            },
          },
        ],
      });
    }
    const toolMessage = JSON.parse(init.body).messages.at(-1);
    assert.match(toolMessage.content, /Tool not available/);
    return Response.json({
      choices: [{ message: { role: "assistant", content: "Cannot search now." } }],
    });
  };

  const reply = await runLoop([], "chicken rice?", { OPENCODE_API_KEY: "test" });

  assert.equal(reply, "Cannot search now.");
  assert.ok(calls.every((u) => u.endsWith("/chat/completions")));
});
