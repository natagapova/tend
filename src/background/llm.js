// Asks a real LLM (Claude) to read each tab's title/URL/description and
// group them by actual purpose — e.g. recognizing that LeetCode is "for
// coding" and a joke site is "for leisure," not by keyword matching.
//
// This is a genuine architecture tradeoff, not a strict upgrade: it sends
// tab contents to Anthropic's API (no longer fully local/offline) and costs
// real money per request. It's only used when the user has set their own
// API key (see popup.js); callers must treat any failure (no key, network
// error, bad response) as "fall back to the local pipeline," never as fatal.

import Anthropic from '@anthropic-ai/sdk';
import { KEYS, read } from './store.js';

const GROUP_TOOL = {
  name: 'report_tab_groups',
  description:
    "Report how the given browser tabs should be grouped by what they're actually for.",
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      groups: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: {
              type: 'string',
              description:
                'A short (1-3 word) label for what this group of tabs is for — e.g. "Programming", ' +
                '"Social media", "Design", "Leisure / hobby", "Travel planning". Judge this from what the ' +
                "page actually is, not just its brand name.",
            },
            tabIds: { type: 'array', items: { type: 'integer' } },
          },
          required: ['label', 'tabIds'],
          additionalProperties: false,
        },
      },
    },
    required: ['groups'],
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT =
  'You are grouping a list of open browser tabs by what each one is actually for — the field of ' +
  "work, topic, or purpose a person would use to describe it, based on the page's real content, not " +
  'just its brand name or domain. Tabs that serve the same purpose should get the exact same label ' +
  'string, even if they are on completely different websites (e.g. a translation site and a language ' +
  "course both read \"Languages\"), and tabs on the same site but for unrelated purposes should NOT " +
  'automatically share a label. Every tab id given to you must appear in exactly one group in your ' +
  'answer. Call report_tab_groups with your answer.';

// In-memory only (cleared on service-worker restart) — avoids re-billing an
// identical request every time the popup happens to reopen.
let cache = null; // { key, result }

function cacheKey(tabs) {
  return JSON.stringify(
    tabs.map((t) => [t.id, t.title, t.url, t.description ?? '']).sort((a, b) => a[0] - b[0]),
  );
}

/**
 * @param {object[]} tabs — each needs id, title, url, and optionally description
 * @returns {Promise<{label: string, tabIds: number[]}[] | null>} null means
 *   "not configured" or "failed" — caller should fall back to the local
 *   keyword/embedding pipeline, not treat this as an error.
 */
export async function llmGroupTabs(tabs) {
  const apiKey = await read(KEYS.anthropicApiKey, '');
  if (!apiKey || !tabs.length) return null;

  const key = cacheKey(tabs);
  if (cache?.key === key) return cache.result;

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const payload = tabs.map((t) => ({
    id: t.id,
    title: t.title,
    url: t.url,
    description: t.description ?? '',
  }));

  let response;
  try {
    response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 4000,
      output_config: { effort: 'low' }, // this is plain classification, not hard reasoning
      system: SYSTEM_PROMPT,
      tools: [GROUP_TOOL],
      tool_choice: { type: 'tool', name: GROUP_TOOL.name },
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    });
  } catch (err) {
    console.warn('[tend] LLM grouping failed, falling back to local pipeline:', err);
    return null;
  }

  const call = response.content.find((b) => b.type === 'tool_use');
  const groups = call?.input?.groups;
  if (!Array.isArray(groups)) return null;

  // Sanity check: every open tab must be accounted for exactly once, or the
  // popup would silently drop tabs from view. If the model missed any,
  // distrust the whole result rather than show an incomplete tab list.
  const seen = new Set();
  for (const g of groups) for (const id of g.tabIds) seen.add(id);
  const allPresent = tabs.every((t) => seen.has(t.id));
  if (!allPresent) {
    console.warn('[tend] LLM result missing some tabs, falling back to local pipeline');
    return null;
  }

  cache = { key, result: groups };
  return groups;
}
