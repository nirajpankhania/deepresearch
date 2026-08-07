/**
 * Widening a facet's corpus, with soft bias back toward what the planner chose.
 *
 * Hard routing has a specific blind spot: a clinical facet sent to PubMed cannot
 * surface the medRxiv preprint reporting last month's trial, and in a
 * fast-moving field that preprint may be the only evidence there is. The reverse
 * holds too — a facet sent to bioRxiv cannot see the peer-reviewed version.
 *
 * So each corpus is paired with its counterpart across the preprint boundary,
 * and the planner's own choices are biased up so the widened corpus stays a
 * supplement rather than a replacement. This is cost-neutral: `max_num_results`
 * bounds the results regardless of how many corpora are searched, so widening
 * changes *which* ten come back, not how many.
 *
 * ⚠️ `source_biases` keys are **domains, not dataset ids**. Dataset ids are
 * accepted and silently ignored — the API even range-checks the value, so a
 * wrong key looks entirely correct and does nothing. Verified empirically:
 * biasing `valyu/valyu-pubmed` changed nothing, biasing
 * `pubmed.ncbi.nlm.nih.gov` shifted composition from 6/2/2 to 8/1/1.
 */

/** Dataset to the domain its results are served from. Verified against live results. */
const DATASET_DOMAIN: Record<string, string> = {
  'valyu/valyu-pubmed': 'pubmed.ncbi.nlm.nih.gov',
  'valyu/valyu-arxiv': 'arxiv.org',
  'valyu/valyu-biorxiv': 'www.biorxiv.org',
  'valyu/valyu-medrxiv': 'www.medrxiv.org',
  'valyu/valyu-chemrxiv': 'chemrxiv.org',
  'valyu/valyu-clinical-trials': 'clinicaltrials.gov',
  'valyu/valyu-patents': 'patents.google.com',
};

/**
 * Counterparts across the preprint boundary.
 *
 * Deliberately narrow. This is not "search everything and let the reranker
 * sort it out" — it pairs corpora that publish the *same work at different
 * stages*, which is where hard routing actually loses evidence.
 */
const COUNTERPARTS: Record<string, string[]> = {
  'valyu/valyu-pubmed': ['valyu/valyu-biorxiv', 'valyu/valyu-medrxiv'],
  'valyu/valyu-clinical-trials': ['valyu/valyu-medrxiv'],
  'valyu/valyu-biorxiv': ['valyu/valyu-pubmed'],
  'valyu/valyu-medrxiv': ['valyu/valyu-pubmed'],
  'valyu/valyu-chemrxiv': ['valyu/valyu-arxiv'],
};

/** The planner's own choices, boosted so the widened corpus stays a supplement. */
const PRIMARY_BIAS = 3;
/** Counterparts surface only when they are notably better matches. */
const COUNTERPART_BIAS = -2;

export interface WidenedSources {
  includedSources: string[];
  /** Keyed by domain. Empty when nothing was widened, so no pointless parameter is sent. */
  sourceBiases: Record<string, number>;
}

export function widenSources(primary: string[]): WidenedSources {
  const chosen = new Set(primary);
  const added = new Set<string>();

  for (const source of primary) {
    for (const counterpart of COUNTERPARTS[source] ?? []) {
      if (!chosen.has(counterpart)) added.add(counterpart);
    }
  }

  if (added.size === 0) return { includedSources: primary, sourceBiases: {} };

  const sourceBiases: Record<string, number> = {};
  for (const source of chosen) {
    const domain = DATASET_DOMAIN[source];
    if (domain) sourceBiases[domain] = PRIMARY_BIAS;
  }
  for (const source of added) {
    const domain = DATASET_DOMAIN[source];
    if (domain) sourceBiases[domain] = COUNTERPART_BIAS;
  }

  return { includedSources: [...chosen, ...added], sourceBiases };
}
