// A second, free attempt at labeling the tabs the keyword matcher (see
// categories.js) couldn't place — using the on-device MiniLM model already
// loaded for clustering, instead of giving up to a generic word/hostname
// label.
//
// Tested against real data (see conversation/commit history): MiniLM's
// zero-shot category guesses are sometimes right (e.g. a font foundry's real
// description correctly scored "Design & creative" highest) but sometimes
// confidently wrong — a Cloudflare captcha page scored "Video & streaming"
// as its *single highest-confidence* match of a whole test batch. A bare
// confidence floor doesn't catch that case; the giveaway was that the
// correct call's top-2 scores were clearly separated, while the wrong calls'
// were either a near-tie or had no real competition worth comparing. So
// this requires both a confidence floor AND a minimum margin over the
// second-best category — this still won't be perfect, but it blocks the
// close-call guesses that are least trustworthy.

import { embedTexts } from './embeddings.js';

const CATEGORIES = [
  ['Social media', 'a social media website or social network feed'],
  ['Programming', 'a programming, coding, or software development website'],
  ['Shopping', 'an online shopping or e-commerce website'],
  ['Email & productivity', 'an email inbox or productivity and office tool'],
  ['Video & streaming', 'a video, movie, or streaming entertainment website'],
  ['Music', 'a music streaming or audio website'],
  ['News', 'a news article or current events website'],
  ['Research & reading', 'an encyclopedia, research paper, or long-form article'],
  ['Travel', 'a travel booking, flights, or hotel website'],
  ['Finance', 'a banking, finance, or payments website'],
  ['Languages', 'a language learning or translation website'],
  ['Account sign-in', 'an account login or sign-in page'],
  ['Design & creative', 'a design, art, or creative tool website'],
  ['Maps & navigation', 'a maps or navigation website'],
];
// Deliberately not adding more candidates (e.g. "Leisure/hobby") without
// testing them first: adding "Security check" and "Leisure / hobby" here
// once shifted an already-correct case ("Free Faces" -> Design & creative)
// into losing by 0.004 to the new, wrong "Security check" candidate — this
// list is sensitive enough to re-verify against real text before extending.

const MIN_CONFIDENCE = 0.24;
const MIN_MARGIN = 0.04; // gap required over the second-best category

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

let vectorsPromise;
function categoryVectors() {
  vectorsPromise ??= embedTexts(CATEGORIES.map(([, phrase]) => phrase)).catch((err) => {
    vectorsPromise = null; // allow a retry
    throw err;
  });
  return vectorsPromise;
}

/** @param {number[] | undefined} vector */
export async function modelCategory(vector) {
  if (!vector) return null;
  const vecs = await categoryVectors();
  const scored = vecs.map((v, i) => [CATEGORIES[i][0], dot(vector, v)]).sort((a, b) => b[1] - a[1]);
  const [bestName, best] = scored[0];
  const second = scored[1]?.[1] ?? -Infinity;
  return best >= MIN_CONFIDENCE && best - second >= MIN_MARGIN ? bestName : null;
}
