import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_FILE = path.join(__dirname, "data", "pricing-cache.json");
const CACHE_TTL = 60 * 60 * 1000;
const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/models";

const ALIASES = {
  "gpt-4o": "openai/gpt-4o",
  "gpt-4o-2024-08-06": "openai/gpt-4o",
  "gpt-4o-2024-05-13": "openai/gpt-4o",
  "gpt-4o-mini": "openai/gpt-4o-mini",
  "gpt-4o-mini-2024-07-18": "openai/gpt-4o-mini",
  "gpt-4-turbo": "openai/gpt-4-turbo",
  "gpt-4": "openai/gpt-4",
  "gpt-3.5-turbo": "openai/gpt-3.5-turbo",
  "claude-3-5-sonnet": "anthropic/claude-3-5-sonnet-20241022",
  "claude-3-5-sonnet-20241022": "anthropic/claude-3-5-sonnet-20241022",
  "claude-3-5-sonnet-20240620": "anthropic/claude-3-5-sonnet-20240620",
  "claude-3-haiku": "anthropic/claude-3-haiku-20240307",
  "claude-3-opus": "anthropic/claude-3-opus-20240229",
  "claude-3-5-haiku": "anthropic/claude-3-5-haiku-20241022",
  "claude-3-5-haiku-20241022": "anthropic/claude-3-5-haiku-20241022",
  "gemini-1.5-pro": "google/gemini-1.5-pro",
  "gemini-1.5-flash": "google/gemini-1.5-flash",
  "gemini-2.0-flash": "google/gemini-2.0-flash",
  "mistral-large": "mistralai/mistral-large",
  "llama-3.1-70b": "meta-llama/llama-3.1-70b",
  "llama-3.1-8b": "meta-llama/llama-3.1-8b",
  "codestral": "mistralai/codestral",
  "deepseek-coder": "deepseek/deepseek-coder",
  "deepseek-chat": "deepseek/deepseek-chat",
  "command-r-plus": "cohere/command-r-plus",
  "command-r": "cohere/command-r",
};

const KNOWN_PREFIXES = [
  "openai/",
  "anthropic/",
  "google/",
  "meta-llama/",
  "mistralai/",
  "deepseek/",
  "cohere/",
  "ai21/",
  "perplexity/",
];

let mergedPricing = null;

function expandHome(p) {
  if (p.startsWith("~")) {
    return path.join(
      process.env.HOME || process.env.USERPROFILE || "/tmp",
      p.slice(1),
    );
  }
  return p;
}

function loadCustomPricing() {
  const customPath = expandHome(
    "~/.config/token-leaderboard/custom-pricing.json",
  );
  try {
    if (fs.existsSync(customPath)) {
      return JSON.parse(fs.readFileSync(customPath, "utf-8"));
    }
  } catch (err) {
    console.error("Failed to load custom pricing:", err.message);
  }
  return {};
}

function readCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, "utf-8");
      const cached = JSON.parse(raw);
      if (Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
      }
    }
  } catch {}
  return null;
}

function writeCache(data) {
  try {
    const dir = path.dirname(CACHE_FILE);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      CACHE_FILE,
      JSON.stringify({ timestamp: Date.now(), data }, null, 2),
      "utf-8",
    );
  } catch (err) {
    console.error("Failed to write pricing cache:", err.message);
  }
}

async function fetchLiteLLM() {
  const resp = await fetch(LITELLM_URL);
  if (!resp.ok) throw new Error(`LiteLLM returned ${resp.status}`);
  return await resp.json();
}

async function fetchOpenRouter() {
  const resp = await fetch(OPENROUTER_URL);
  if (!resp.ok) throw new Error(`OpenRouter returned ${resp.status}`);
  const json = await resp.json();
  const models = {};
  for (const m of json.data || []) {
    const pricing = m.pricing || {};
    models[m.id] = {
      input_cost_per_token: parseFloat(pricing.prompt) || 0,
      output_cost_per_token: parseFloat(pricing.completion) || 0,
      cache_read_cost_per_token: 0,
      cache_write_cost_per_token: 0,
    };
  }
  return models;
}

function normalizeLitellm(litellm) {
  const normalized = {};
  for (const [id, data] of Object.entries(litellm)) {
    if (data && typeof data === "object") {
      normalized[id] = {
        input_cost_per_token: data.input_cost_per_token || 0,
        output_cost_per_token: data.output_cost_per_token || 0,
        cache_read_cost_per_token: data.cache_read_input_token_cost || 0,
        cache_write_cost_per_token: data.cache_read_output_token_cost || 0,
      };
    }
  }
  return normalized;
}

export async function initPricingEngine() {
  const cached = readCache();
  if (cached) {
    mergedPricing = cached;
    return;
  }

  let litellm = {};
  let openrouter = {};

  try {
    litellm = await fetchLiteLLM();
  } catch (err) {
    console.error("Pricing: LiteLLM fetch failed:", err.message);
  }

  try {
    openrouter = await fetchOpenRouter();
  } catch (err) {
    console.error("Pricing: OpenRouter fetch failed:", err.message);
  }

  const merged = { ...normalizeLitellm(litellm) };
  for (const [id, pricing] of Object.entries(openrouter)) {
    if (!merged[id]) {
      merged[id] = pricing;
    }
  }

  mergedPricing = merged;
  writeCache(merged);
}

export function lookupPricing(modelId) {
  if (!mergedPricing) {
    return {
      input_cost_per_token: 0,
      output_cost_per_token: 0,
      cache_read_cost_per_token: 0,
      cache_write_cost_per_token: 0,
      source: "uninitialized",
    };
  }

  const custom = loadCustomPricing();
  if (custom[modelId]) {
    return { ...custom[modelId], source: "custom" };
  }

  if (mergedPricing[modelId]) {
    return { ...mergedPricing[modelId], source: "exact" };
  }

  if (ALIASES[modelId] && mergedPricing[ALIASES[modelId]]) {
    return { ...mergedPricing[ALIASES[modelId]], source: "alias" };
  }

  for (const prefix of KNOWN_PREFIXES) {
    if (modelId.startsWith(prefix)) {
      const stripped = modelId.slice(prefix.length);
      if (mergedPricing[stripped]) {
        return { ...mergedPricing[stripped], source: "prefix_strip" };
      }
    }
  }

  for (const [key, pricing] of Object.entries(mergedPricing)) {
    if (modelId.includes(key) || key.includes(modelId)) {
      return { ...pricing, source: "fuzzy" };
    }
  }

  return {
    input_cost_per_token: 0,
    output_cost_per_token: 0,
    cache_read_cost_per_token: 0,
    cache_write_cost_per_token: 0,
    source: "unknown",
  };
}
