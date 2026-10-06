import { OpenAiCompatibleProvider } from "../src/ai/OpenAiCompatibleProvider.js";
import { createConsoleLogger } from "../src/core/logging/Logger.js";

async function main() {
  const apiKey = process.env.NVIDIA_API_KEY || process.env.AI_API_KEY;
  if (!apiKey) {
    console.log("NVIDIA_API_KEY_NOT_AVAILABLE");
    process.exit(0);
  }

  const log = createConsoleLogger("gp-test");
  const provider = new OpenAiCompatibleProvider({
    baseUrl: "https://integrate.api.nvidia.com/v1",
    apiKey,
    model: "meta/llama-3.2-11b-vision-instruct",
    timeoutMs: 30000
  }, log);

  try {
    const res = await provider.complete({
      model: "meta/llama-3.2-11b-vision-instruct",
      messages: [
        { role: "user", content: "Reply with exactly: OK" }
      ],
      temperature: 0,
      max_tokens: 10
    });
    
    const trimmed = res.content.trim();
    console.log("Response content:", trimmed);
    if (trimmed.includes("OK")) {
      console.log("NVIDIA_API_LIVE_SUCCESS");
    } else {
      console.log("Response content mismatch:", trimmed);
      console.log("NVIDIA_API_LIVE_FAILED");
    }
  } catch (err: any) {
    console.error("API Error:", err);
    console.log("NVIDIA_API_LIVE_FAILED");
  }
}

main();
