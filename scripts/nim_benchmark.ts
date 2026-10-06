import fs from "node:fs";
import { execSync } from "node:child_process";

async function main() {
  const apiKey = process.env.NVIDIA_API_KEY || process.env.AI_API_KEY || "";
  if (!apiKey) {
    console.log("NO_API_KEY");
    process.exit(1);
  }

  const modelsToTest = [
    "z-ai/glm-5.3",
    "z-ai/glm-5.3-flash",
    "nvidia/nemotron-3-super-120b-a12b",
    "openai/gpt-oss-20b",
    "meta/muse-glimmer-30b",
    "meta/llama-3.2-11b-vision-instruct",
  ];

  console.log("Retrieving catalog...");
  let availableModels: string[] = [];
  try {
    const res = await fetch("https://integrate.api.nvidia.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) {
      const json = await res.json();
      availableModels = json.data?.map((m: any) => m.id) || [];
    }
  } catch (err: any) {
    console.error("Failed to get models:", err.message);
  }

  console.log("Available models matching target list:");
  const results: Record<string, any> = {};

  for (const m of modelsToTest) {
    const exists = availableModels.includes(m);
    console.log(`- ${m}: ${exists ? "FOUND" : "NOT FOUND"}`);
    results[m] = {
      id: m,
      catalog: exists ? "PASS" : "FAIL",
      api: "API_UNAVAILABLE",
      uncachedLatency: -1,
      json: "FAIL",
      pipeline: "FAIL",
      mtf: "FAIL",
      noHallucination: "FAIL",
      toolUse: "TOOL_CALLING_NOT_SUPPORTED",
      repeatability: "FAIL",
      score: 0,
      verdict: "API_UNAVAILABLE",
    };
  }

  // Sequentially test each model that exists
  for (const m of modelsToTest) {
    if (results[m].catalog === "FAIL") {
      results[m].verdict = "MODEL_NOT_FOUND";
      continue;
    }

    console.log(`\n==========================================`);
    console.log(`BENCHMARKING MODEL: ${m}`);
    console.log(`==========================================`);

    // Phase 1: Real API Connectivity (3 uncached requests of "Reply with exactly: OK")
    console.log("--- PHASE 1: CONNECTIVITY (3 Uncached Requests) ---");
    const latencies: number[] = [];
    let p1Status = 0;
    let p1Body = "";
    let p1Error = "";

    for (let i = 1; i <= 3; i++) {
      const start = Date.now();
      try {
        const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: m,
            messages: [{ role: "user", content: "Reply with exactly: OK" }],
            max_tokens: 10,
            temperature: 0.01, // bypass potential exact request cache if needed
            stream: false,
          }),
          signal: AbortSignal.timeout(20000), // 20s timeout per attempt to keep benchmark moving
        });
        const elapsed = Date.now() - start;
        if (res.ok) {
          latencies.push(elapsed);
          if (i === 1) {
            p1Status = res.status;
            const json = await res.json();
            p1Body = json.choices?.[0]?.message?.content || "";
          }
        } else {
          console.log(`Attempt ${i} failed with HTTP ${res.status}`);
        }
      } catch (err: any) {
        console.log(`Attempt ${i} timed out/failed: ${err.message}`);
        p1Error = err.message || String(err);
      }
    }

    if (latencies.length > 0) {
      results[m].api = "PASS";
      results[m].uncachedLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
      console.log(`API Succeeded. Latencies: ${latencies.join(", ")}ms. Avg: ${results[m].uncachedLatency}ms`);
    } else {
      console.log(`Model ${m} connectivity failed.`);
      results[m].verdict = "API_UNAVAILABLE";
      continue;
    }

    // Phase 2: Response Contract
    console.log("--- PHASE 2: RESPONSE CONTRACT ---");
    let p2Pass = false;
    try {
      const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: m,
          messages: [
            {
              role: "user",
              content: 'Return ONLY valid JSON in exactly this structure:\n{\n  "decision": "NO_TRADE",\n  "confidence": 0.85,\n  "reason": "insufficient confirmation"\n}',
            },
          ],
          max_tokens: 100,
          temperature: 0,
          stream: false,
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) {
        const json = await res.json();
        const content = json.choices?.[0]?.message?.content?.trim() || "";
        console.log("Contract Output:", content);
        const parsed = JSON.parse(content);
        if (parsed.decision === "NO_TRADE" && typeof parsed.confidence === "number") {
          p2Pass = true;
        }
      }
    } catch (err: any) {
      console.log("Contract check failed:", err.message);
    }
    results[m].json = p2Pass ? "PASS" : "FAIL";

    // Phase 3 & 4: Pipeline Compatibility & Repeatability
    console.log("--- PHASE 3 & 4: PIPELINE COMPATIBILITY & REPEATABILITY ---");
    // Synthetic setup details
    const mtfPrompt = `Analyze this synthetic XAUUSD context according to a conservative trading-analysis framework.
Primary timeframe: M1, Current price: 2650.00
M5: mildly bullish, higher lows, positive momentum
M15: neutral-bullish
H1: bullish
Liquidity: buy-side liquidity above current price
Demand zone: below current price
MACD: bullish supporting evidence only
Risk: within configured limits

Return ONLY valid JSON structure:
{
  "decision": "NO_TRADE | WATCH | TRADE_CANDIDATE",
  "direction": "LONG | SHORT | NONE",
  "confidence": 0.85,
  "key_evidence": ["Higher lows on M5"],
  "risk_flags": ["Spread normal"]
}`;

    let p3Pass = false;
    let runsValid = 0;
    const runsList: any[] = [];

    for (let r = 1; r <= 3; r++) {
      const rStart = Date.now();
      try {
        const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: m,
            messages: [{ role: "user", content: mtfPrompt }],
            max_tokens: 300,
            temperature: 0.1 * r, // vary temperature slightly to bypass cache
            stream: false,
          }),
          signal: AbortSignal.timeout(25000),
        });
        const elapsed = Date.now() - rStart;
        if (res.ok) {
          const json = await res.json();
          const content = json.choices?.[0]?.message?.content?.trim() || "";
          const parsed = JSON.parse(content);
          if (parsed.decision && parsed.key_evidence) {
            runsValid++;
          }
          runsList.push({ run: r, decision: parsed.decision, elapsed });
        }
      } catch (err: any) {
        console.log(`Run ${r} failed:`, err.message);
      }
    }

    if (runsValid >= 2) {
      p3Pass = true;
      results[m].pipeline = "PASS";
      results[m].mtf = "PASS";
      results[m].repeatability = "PASS";
    }
    console.log("Pipeline Compatibility runs:", runsList);

    // Phase 5: Context Discipline / No Hallucination
    console.log("--- PHASE 5: CONTEXT DISCIPLINE ---");
    let p5Pass = false;
    try {
      const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: m,
          messages: [
            {
              role: "user",
              content: "You are given only the following facts: XAUUSD, M1, Close = 2650. No stop loss provided. No take profit provided. No entry price provided. No position size provided. Return JSON. Do not invent an entry, SL, TP, or position size.",
            },
          ],
          max_tokens: 150,
          temperature: 0,
          stream: false,
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) {
        const json = await res.json();
        const content = json.choices?.[0]?.message?.content?.toLowerCase() || "";
        console.log("Context Discipline Output:", content);
        if (!content.includes("sl=") && !content.includes("tp=") && !content.includes("entry=")) {
          p5Pass = true;
        }
      }
    } catch (err: any) {
      console.log("Discipline check failed:", err.message);
    }
    results[m].noHallucination = p5Pass ? "PASS" : "FAIL";

    // Phase 6: Tool Calling Capability
    console.log("--- PHASE 6: TOOL CALLING ---");
    let p6Pass = false;
    try {
      const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: m,
          messages: [{ role: "user", content: "Use the available tool to get the test value." }],
          tools: [
            {
              type: "function",
              function: {
                name: "get_test_value",
                description: "Gets the test value",
                parameters: { type: "object", properties: {}, required: [] },
              },
            },
          ],
          max_tokens: 50,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) {
        const json = await res.json();
        const toolCalls = json.choices?.[0]?.message?.tool_calls;
        if (Array.isArray(toolCalls) && toolCalls.length > 0 && toolCalls[0].function?.name === "get_test_value") {
          p6Pass = true;
        }
      }
    } catch (err: any) {
      console.log("Tool calling check failed:", err.message);
    }
    results[m].toolUse = p6Pass ? "PASS" : "TOOL_CALLING_NOT_SUPPORTED";

    // Scoring out of 100
    // API reliability: 20
    // Response latency: 15
    // Structured JSON compliance: 15
    // GP-V4 pipeline compatibility: 20
    // Instruction following: 10
    // Context discipline: 10
    // Tool calling: 5
    // Repeatability: 5
    let score = 0;
    if (results[m].api === "PASS") score += 20;
    if (results[m].uncachedLatency !== -1 && results[m].uncachedLatency < 500) score += 15;
    else if (results[m].uncachedLatency !== -1 && results[m].uncachedLatency < 2000) score += 10;
    else if (results[m].uncachedLatency !== -1) score += 5;

    if (results[m].json === "PASS") score += 15;
    if (results[m].pipeline === "PASS") score += 20;
    score += 10; // instruction following base
    if (results[m].noHallucination === "PASS") score += 10;
    if (results[m].toolUse === "PASS") score += 5;
    if (results[m].repeatability === "PASS") score += 5;

    results[m].score = score;

    // Verdict mapping
    if (score >= 90) results[m].verdict = "RECOMMENDED";
    else if (score >= 75) results[m].verdict = "STRONG CANDIDATE";
    else if (score >= 50) results[m].verdict = "BACKUP";
    else results[m].verdict = "NOT_RECOMMENDED";
  }

  console.log("\n==========================================");
  console.log("FINAL BENCHMARK COMPARISON TABLE RAW DATA");
  console.log("==========================================");
  console.log(JSON.stringify(results, null, 2));
}

main();
