// Topic labels for clusters.
//
// An earlier version tried classifying each tab against a set of topic
// phrases using the MiniLM embeddings already computed for clustering (a
// "zero-shot" approach). That produced confident-looking but wrong results —
// e.g. LeetCode landed under "Maps & navigation" — because the model is a
// small, quantized one running on short, noisy text (title + hostname); it's
// good at judging "are these two tabs alike," not at picking the right one
// of several unrelated abstract category descriptions.
//
// This uses a plain keyword/hostname match instead: deterministic, and wrong
// only when a site genuinely isn't in the list (in which case it falls back
// to the word/host label below, same as an uncategorized site always did).

const CATEGORY_RULES = [
  ['Social media', /instagram|facebook|\bfb\.com|twitter|\bx\.com\b|tiktok|reddit|\bvk\.(ru|com)|linkedin|snapchat|pinterest|tumblr|mastodon|threads\.net/],
  ['Programming', /github|gitlab|bitbucket|leetcode|stackoverflow|stack overflow|hackerrank|codepen|replit|npmjs|developer\.mozilla|devdocs|codewars/],
  ['Video & streaming', /youtube|netflix|hulu\.com|twitch\.tv|vimeo|disneyplus|primevideo|hbomax|crunchyroll/],
  ['Music', /spotify|soundcloud|music\.apple|pandora\.com|bandcamp|deezer/],
  ['Shopping', /amazon\.|ebay\.|etsy\.com|aliexpress|shopify|walmart\.com|target\.com/],
  ['Email & productivity', /\bgmail\b|mail\.google|outlook\.|calendar\.google|docs\.google|drive\.google|sheets\.google|slack\.com|notion\.so|trello\.com|asana\.com|workspace\.google/],
  ['News', /\bnews\b|nytimes|bbc\.|cnn\.|theguardian|reuters|bloomberg\.com/],
  ['Research & reading', /wikipedia|arxiv\.org|scholar\.google|medium\.com|researchgate|jstor/],
  ['Travel', /airbnb|booking\.com|expedia|skyscanner|kayak\.com|tripadvisor/],
  ['Finance', /paypal\.com|chase\.com|wellsfargo|stripe\.com|coinbase|robinhood/],
  ['Languages', /translate|dictionary|duolingo|talktomeinkorean|linguee|deepl\.com/],
  ['Account sign-in', /sign[\s-]?in|\blogin\b|accounts\.google|\bid\.\w+\.\w+\b|\boauth\b/],
  ['Design & creative', /figma\.com|adobe\.com|dribbble|behance\.net|canva\.com|\btypefaces?\b|\bfonts?\b|typography|\bicons?\b|\bmockups?\b|\bwireframes?\b|\billustrations?\b|color\s*palette/],
  ['Maps & navigation', /maps\.google|openstreetmap|waze\.com/],
];

function bestCategory(tab) {
  let host = '';
  try { host = new URL(tab.url).hostname.toLowerCase(); } catch {}
  // The description (from content.js, when available) often says what a
  // page is *for* when the title and host don't — see tend#1.
  const text = `${host} ${(tab.title || '').toLowerCase()} ${(tab.description || '').toLowerCase()}`;
  for (const [name, pattern] of CATEGORY_RULES) {
    if (pattern && pattern.test(text)) return name;
  }
  return null;
}

/**
 * Splits tabs into those that confidently match a known topic — grouped
 * together by that topic, regardless of how similar their embeddings are —
 * and `rest`, the tabs with no category match, for the caller to group by
 * embedding similarity instead.
 */
export function groupByCategory(tabs) {
  const grouped = new Map();
  const rest = [];
  for (const tab of tabs) {
    const category = bestCategory(tab);
    if (!category) {
      rest.push(tab);
      continue;
    }
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category).push(tab);
  }
  return { grouped, rest };
}
