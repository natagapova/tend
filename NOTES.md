# Future ideas

## Site/tool recommendations from close/keep behavior

Idea: use the `decisions` log (currently just logged, unused) to recommend
websites or tools the user might find useful, based on what they tend to
keep open vs. close.

Not scoped or designed yet. Open questions before this is buildable:

- **Where do candidates come from?** The extension only knows about tabs the
  user has actually opened — it has no catalog of other sites to suggest.
  Needs either a search/lookup API or a curated candidate list.
- **Privacy tradeoff.** Everything today is local-only (tabs and embeddings
  never leave the machine). Recommending unseen sites likely means sending
  *something* (topic interests, at minimum) to an external service — a real
  architecture decision, not a detail.
- **Ranking, not training.** A content-based approach is probably enough to
  start: embed candidate sites with the same MiniLM model already bundled,
  and rank by similarity to kept tabs / away from closed ones. No heavy
  model training required — mainly a ranking signal.
- **What "closed" means as signal.** The popup now only logs closes (see
  `decide()` in `src/background/index.js`); there's no explicit "keep" click.
  An earlier design logged an implicit "keep" when sibling tabs in the same
  cluster got closed, but clusters are recomputed from scratch every popup
  open (not a stable, persistent grouping), so "same cluster" is a moving
  target across sessions — that approach needs more thought if revisited.

Revisit once there's a concrete answer for where candidates come from.
