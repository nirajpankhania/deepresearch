# Example output

A complete task, captured verbatim from the deployed system: the generated
sub-queries, the sources retrieval selected and how they were judged, the cost
breakdown, the claim-grounding verdicts, and the final report.

```
question    Does semaglutide preserve lean muscle mass in older adults during weight loss?
status      completed
sources     20 after deduplication, 13 cited
grounding   22 of 26 cited claims fully supported
cost        $0.03 retrieval (measured) + $0.068534 model (estimated)
```

## 1. Generated sub-queries

One Flash call. Decomposed by *facet* rather than rephrasing, each routed to
the corpus likely to hold that facet. Retrieval then widens each facet across
the preprint boundary, biasing the planner's own choices up — which is why
sources appear below from corpora not listed here.

**1. `semaglutide clinical trial body composition lean mass elderly`**

- Routed to: `valyu/valyu-pubmed`, `valyu/valyu-clinical-trials`
- Results: 10 · $0.0050
- Rationale: This facet provides direct evidence from randomized controlled trials regarding changes in fat-free mass in older populations.

**2. `glp-1 receptor agonist molecular mechanisms muscle protein synthesis`**

- Routed to: `valyu/valyu-pubmed`, `valyu/valyu-biorxiv`
- Results: 10 · $0.0050
- Rationale: Exploring the molecular mechanisms helps determine if semaglutide has a protective effect on muscle tissue at a cellular level.

**3. `semaglutide adverse events sarcopenia muscle weakness reports`**

- Routed to: `valyu/valyu-drug-labels`, `valyu/valyu-openfda-drug-events`
- Results: 5 · $0.0150
- Rationale: Regulatory data and post-marketing surveillance can reveal reported side effects concerning muscle weakness or significant lean mass reduction.

**4. `semaglutide versus diet induced weight loss muscle mass retention`**

- Routed to: `valyu/valyu-pubmed`, `valyu/valyu-medrxiv`
- Results: 10 · $0.0050
- Rationale: Comparing semaglutide to other weight loss methods clarifies if muscle loss is drug-specific or a general consequence of weight loss.

## 2. Selected sources

Reranked on three axes against the original question — topical relevance,
directness, and study design. `Score` is the composite.

| # | Title | Corpus | Design | Score | Cited |
|---|---|---|---|---|---|
| 1 | [GLP-1 Receptor Agonists for Obesity Management in Ol…](https://pubmed.ncbi.nlm.nih.gov/PMC13272609) | `pubmed` | review | 0.868 | ✓ |
| 2 | [Impact of Semaglutide on fat mass, lean mass and mus…](https://pubmed.ncbi.nlm.nih.gov/PMC12673431) | `pubmed` | observational | 0.865 | ✓ |
| 3 | [Moving beyond the scale: musculoskeletal risks, evid…](https://pubmed.ncbi.nlm.nih.gov/PMC12592101) | `pubmed` | review | 0.848 | ✓ |
| 4 | [Body Composition Changes with Semaglutide: A Systema…](https://www.medrxiv.org/content/10.1101/2025.09.29.25336760) | `medrxiv` | meta-analysis | 0.834 | ✓ |
| 5 | [Bone mineral density and turnover response to GLP-1 …](https://pubmed.ncbi.nlm.nih.gov/PMC12695752) | `pubmed` | observational | 0.803 | ✓ |
| 6 | [Pharmacological weight loss with incretin-based ther…](https://www.medrxiv.org/content/10.1101/2025.07.28.25332295) | `medrxiv` | observational | 0.777 | ✓ |
| 7 | [Lean Mass and Musculoskeletal Preservation in GLP-1-…](https://pubmed.ncbi.nlm.nih.gov/PMC13303403) | `pubmed` | review | 0.773 | ✓ |
| 8 | [The Influence of Glucagon-like Peptide-1 Receptor Ag…](https://pubmed.ncbi.nlm.nih.gov/PMC12733374) | `pubmed` | review | 0.745 | ✓ |
| 9 | [Not All Weight Loss Is Equal: Towards Muscle‐Preserv…](https://pubmed.ncbi.nlm.nih.gov/PMC13121907) | `pubmed` | review | 0.698 | ✓ |
| 10 | [Semaglutide-induced lean mass loss: clinical concern…](https://pubmed.ncbi.nlm.nih.gov/PMC13236199) | `pubmed` | review | 0.698 | ✓ |
| 11 | [15-PGDH Inhibition Overcomes Muscle Regenerative Def…](https://doi.org/10.64898/2026.02.26.708119) | `biorxiv` | in-vitro | 0.665 | ✓ |
| 12 | [Understanding Impact of Anti‐Obesity Medications on …](https://pubmed.ncbi.nlm.nih.gov/PMC13008602) | `pubmed` | review | 0.622 | ✓ |
| 13 | [Semaglutide promotes intramuscular fat formation aft…](https://doi.org/10.64898/2026.06.16.732451) | `biorxiv` | in-vitro | 0.549 | ✓ |
| 14 | [Glucagon Like Peptide-1-Induced Glucose Metabolism i…](https://pubmed.ncbi.nlm.nih.gov/PMC3429413) | `pubmed` | in-vitro | 0.393 |  |
| 15 | [Novel Site-Specific Fatty Chain-Modified GLP-1 Recep…](https://pubmed.ncbi.nlm.nih.gov/PMC6412877) | `pubmed` | in-vitro | 0.338 |  |
| 16 | [DNA-based delivery of incretin receptor agonists usi…](https://www.biorxiv.org/content/10.1101/2025.05.30.656889) | `biorxiv` | in-vitro | 0.321 |  |
| 17 | [Physiology and Emerging Biochemistry of the Glucagon…](https://pubmed.ncbi.nlm.nih.gov/PMC3359799) | `pubmed` | review | 0.248 |  |
| 18 | [Signaling architecture of the glucagon-like peptide-…](https://pubmed.ncbi.nlm.nih.gov/PMC12807469) | `pubmed` | review | 0.248 |  |
| 19 | [Dynamics of GLP-1R peptide agonist engagement are co…](https://www.biorxiv.org/content/10.1101/2021.03.10.434902) | `biorxiv` | modelling | 0.2 |  |
| 20 | [WEGOVY (SEMAGLUTIDE) INJECTION, SOLUTION WEGOVY (SEM…](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=ee06186f-2aa3-4990-a760-757579d8f77b) | `drug-labels` | other | 0.18 |  |

Corpora represented: {'pubmed': 13, 'medrxiv': 2, 'biorxiv': 4, 'drug-labels': 1}

## 3. Cost

Retrieval is measured from the search responses and backed by transaction ids.
Model cost is estimated from reported token counts against list prices — the
two are never added as if equally trustworthy.

| Stage | Model | In | Out | Reasoning | Cost |
|---|---|---|---|---|---|
| planning | `gemini-3-flash-preview` | 819 | 255 | 1,420 | $0.0044 |
| reranking | `gemini-3-flash-preview` | 6,392 | 1,401 | 0 | $0.0054 |
| synthesising | `gemini-2.5-pro` | 11,295 | 1,155 | 2,738 | $0.0530 |
| grounding | `gemini-3-flash-preview` | 6,449 | 1,479 | 0 | $0.0056 |

Retrieval **$0.03** measured across 4 transactions · model **$0.068534** estimated · total **$0.0985**

## 4. Claim grounding

Every citation-bearing sentence re-read against the source it cites. **22 of 26 fully supported.**

Claims that did not fully verify:

- **unsupported** — “Similarly, another study using DXA scans reported an overall decrease in total lean mass of 9.7% from baseline with semaglutide, but the proportion of lean mass relative to total body mass increased by 3.0 percentage points [2].”
  <br>*The source text is truncated and does not contain the specific figures of 9.7% or 3.0 percentage points.*
- **unsupported** — “In the STEP clinical trial program, the weight loss from semaglutide was primarily from fat, but the proportion of lean mass loss ranged from approximately 20% to 40% of the total weight reduction [10].”
  <br>*The source text does not mention the STEP clinical trial program or the specific 20% to 40% range for lean mass loss.*
- **unsupported** — “Likewise, the QUALITY trial found that combining enobosarm with semaglutide led to superior preservation of stair-climbing power and lower-extremity strength compared to semaglutide alone [3].”
  <br>*The source mentions the QUALITY trial but does not provide specific results regarding stair-climbing power or lower-extremity strength.*
- **partial** — “Much of the evidence on mechanisms and mitigation strategies comes from preclinical studies in mice and monkeys, and the human relevance of these findings is not yet determined [6, 11, 12, 13].”
  <br>*The sources describe preclinical studies in mice and monkeys, but they do not explicitly state that the human relevance is 'not yet determined'.*

## 5. Final report

Verbatim. Citation numbers correspond to the table above.

---

Based on the provided sources, there is no direct clinical trial evidence to definitively conclude whether semaglutide preserves lean muscle mass in older adults during weight loss. Evidence from studies in general adult populations and preclinical models indicates that semaglutide-induced weight loss includes a significant reduction in lean mass. However, some data suggest the proportion of lean mass relative to total body mass may increase, and combination therapies are being explored to mitigate lean mass loss.

## Semaglutide and Lean Mass Loss

While semaglutide is an effective medication for weight loss, a key concern is the quality of that loss, as preserving muscle is critical for metabolic health and function [4, 8]. Studies show that weight loss induced by glucagon-like peptide-1 (GLP-1) receptor agonists like semaglutide is not exclusively from fat; a portion comes from fat-free or lean mass [9]. One source states that 25-40% of the total weight lost with GLP-1 medications may be from skeletal muscle mass or other fat-free mass [9].

A clinical study in adults with obesity (the SEMALEAN study) found that 12 months of treatment with 2.4 mg of semaglutide led to a significant initial decrease in lean mass by month seven, which then stabilized through month 12 [2]. Despite this absolute loss, the proportion of lean mass relative to total body mass increased between months seven and 12 [2]. Similarly, another study using DXA scans reported an overall decrease in total lean mass of 9.7% from baseline with semaglutide, but the proportion of lean mass relative to total body mass increased by 3.0 percentage points [2]. In the STEP clinical trial program, the weight loss from semaglutide was primarily from fat, but the proportion of lean mass loss ranged from approximately 20% to 40% of the total weight reduction [10].

Preclinical research in obese mice supports these findings, showing that while semaglutide significantly reduced fat mass by 46%, it also caused a significant decrease in lean body mass (LBM) [6]. In this mouse model, the loss of LBM contributed to roughly 32% of the total weight loss [6].

## Evidence in Older Adults

The provided sources do not contain clinical trial results detailing the effects of semaglutide monotherapy on the body composition of older adults [1, 5]. The impact of GLP-1 agonists on body composition in older adults is described as "insufficiently characterized" [1]. A key concern is that disproportionate lean mass loss during treatment could lead to frailty and adverse outcomes in sarcopenia-prone populations, such as older adults [8].

Indirect evidence comes from a trial of a combination therapy. The Phase 2b QUALITY trial investigated semaglutide with and without enobosarm, a compound designed to preserve muscle [3]. The results showed that adding enobosarm to semaglutide reduced the loss of lean mass by 71% compared to treatment with semaglutide alone, which strongly suggests that semaglutide by itself causes significant lean mass loss [3]. Other combination therapies are also being developed to preserve skeletal muscle during semaglutide treatment, including agents like bimagrumab and trevogrumab, which have shown promise in preclinical models [12].

## Muscle Quality and Function

The preservation of muscle involves more than just mass; it also includes quality and function [7]. One mouse study raised concerns about muscle quality, finding that semaglutide promoted the formation of intramuscular adipose tissue (IMAT) after a muscle injury [13]. The accumulation of IMAT is associated with poor muscle quality and impaired function [13].

In contrast, the SEMALEAN study in humans reported that handgrip strength, a measure of muscle function, actually increased between months seven and 12 of semaglutide treatment, even as absolute lean mass was lost earlier in the treatment period [2]. Likewise, the QUALITY trial found that combining enobosarm with semaglutide led to superior preservation of stair-climbing power and lower-extremity strength compared to semaglutide alone [3]. This highlights the importance of assessing a "quality of weight loss" framework that includes not only body composition but also functional performance [7].

## Limitations

The provided sources do not offer a complete answer to the research question. The most significant limitation is the absence of specific clinical trial results on the effects of semaglutide monotherapy on lean mass in older adults.
*   One source describing a pilot trial in older adults that used DXA scans to measure lean mass did not include the study's results [5].
*   A systematic review and meta-analysis designed to clarify the effects of semaglutide on body composition was also missing its results section [4].
*   Much of the evidence on mechanisms and mitigation strategies comes from preclinical studies in mice and monkeys, and the human relevance of these findings is not yet determined [6, 11, 12, 13].
*   The evidence that is available comes from studies of general adult populations, which may not be fully generalizable to older adults, who are at higher risk for sarcopenia [2, 8].
*   Finally, understanding the impact of these medications on skeletal muscle is complicated by the use of different measurement methods across studies, such as DXA and bioelectrical impedance analysis (BIA) [7, 12].

## Sources

1. [GLP-1 Receptor Agonists for Obesity Management in Older Adults: A Scoping Review on the Risk of Sarcopenia and Sarcopenic Obesity](https://pubmed.ncbi.nlm.nih.gov/PMC13272609)
   Hilal Simsek, Asli Ucar · 2026-06-17 · valyu/valyu-pubmed · DOI 10.1007/s13668-026-00777-x  
2. [Impact of Semaglutide on fat mass, lean mass and muscle function in patients with obesity: The  SEMALEAN  study Alissou et al.](https://pubmed.ncbi.nlm.nih.gov/PMC12673431)
   Mathieu Alissou, Thomas Demangeat, Vanessa Folope et al. · 2025-10-09 · valyu/valyu-pubmed · DOI 10.1111/dom.70141  
3. [Moving beyond the scale: musculoskeletal risks, evidence gaps and emerging combination strategies to optimize the quality of weight loss pharmacotherapy in older adults Reid and Bhasin 10.3389/fragi.2025.1640030](https://pubmed.ncbi.nlm.nih.gov/PMC12592101)
   Kieran F. Reid, Shalender Bhasin · 2025-10-24 · valyu/valyu-pubmed · DOI 10.3389/fragi.2025.1640030  
4. [Body Composition Changes with Semaglutide: A Systematic Review and Meta-Analysis](https://www.medrxiv.org/content/10.1101/2025.09.29.25336760)
   Guilherme Giorelli, Milton Mizumoto, Silvia Sartoretto et al. · 2025-01-01 · valyu/valyu-medrxiv · DOI 10.1101/2025.09.29.25336760  
5. [Bone mineral density and turnover response to GLP-1 receptor agonists in older adults with overweight/obesity and prediabetes/type 2 diabetes: a 20-week pilot trial  <i> post hoc </i>  analysis Dinkla et al. 10.3389/fragi.2025.1691007](https://pubmed.ncbi.nlm.nih.gov/PMC12695752)
   Lauren Dinkla, Kristen M. Beavers, Ronna Robbins et al. · 2025-11-06 · valyu/valyu-pubmed · DOI 10.3389/fragi.2025.1691007  
6. [Pharmacological weight loss with incretin-based therapies does not result in a disproportionate loss of muscle mass or function in obese mice and humans](https://www.medrxiv.org/content/10.1101/2025.07.28.25332295)
   Henning Tim Langer, Natalie K. Gilmore, Chris M. T. Hayden et al. · 2025-01-01 · valyu/valyu-medrxiv · DOI 10.1101/2025.07.28.25332295  
7. [Lean Mass and Musculoskeletal Preservation in GLP-1-Based Obesity Treatment: Nutrition, Exercise, Supplementation, and Monitoring Strategies](https://pubmed.ncbi.nlm.nih.gov/PMC13303403)
   Roko Šantić, Lovre Martinović, Nikola Pavlović et al. · 2026-05-27 · valyu/valyu-pubmed · DOI 10.3390/metabo16060364  
8. [The Influence of Glucagon-like Peptide-1 Receptor Agonists and Other Incretin Hormone Agonists on Body Composition](https://pubmed.ncbi.nlm.nih.gov/PMC12733374)
   Lampros Chrysavgis, Niki Gerasimoula Mourelatou, Maria-Evangelia Koloutsou et al. · 2025-12-17 · valyu/valyu-pubmed · DOI 10.3390/ijms262412130  
9. [Not All Weight Loss Is Equal: Towards Muscle‐Preserving Therapies in Obesity](https://pubmed.ncbi.nlm.nih.gov/PMC13121907)
   Joseph D. Abraham, Muhammad Shahzeb Khan, Stefan D. Anker · 2026-04-27 · valyu/valyu-pubmed · DOI 10.1002/jcsm.70298  
10. [Semaglutide-induced lean mass loss: clinical concern or physiological adaptation](https://pubmed.ncbi.nlm.nih.gov/PMC13236199)
   Muhammad Qaseem, Naveed Ahmad, Ehtisham Haider et al. · 2026-05-11 · valyu/valyu-pubmed · DOI 10.1097/ms9.0000000000005145  
11. [15-PGDH Inhibition Overcomes Muscle Regenerative Deficit Seen With GLP1-Receptor Agonist–Induced Weight Loss](https://doi.org/10.64898/2026.02.26.708119)
   Minas Nalbandian, Jameel Lone, Emmeran Le Moal et al. · 2026-01-01 · valyu/valyu-biorxiv · DOI 10.64898/2026.02.26.708119  
12. [Understanding Impact of Anti‐Obesity Medications on Skeletal Muscle Mass Change Is Confounded by Measurement Methods](https://pubmed.ncbi.nlm.nih.gov/PMC13008602)
   Arden McMath, Dympna Gallagher · 2025-11-24 · valyu/valyu-pubmed · DOI 10.1111/obr.70041  
13. [Semaglutide promotes intramuscular fat formation after injury](https://doi.org/10.64898/2026.06.16.732451)
   Christian Noble, Dawson Geller, Nikhil Urs et al. · 2026-01-01 · valyu/valyu-biorxiv · DOI 10.64898/2026.06.16.732451  
14. [Glucagon Like Peptide-1-Induced Glucose Metabolism in Differentiated Human Muscle Satellite Cells Is Attenuated by Hyperglycemia Hyperglycemia Attenuates GLP-1 Glucose Uptake](https://pubmed.ncbi.nlm.nih.gov/PMC3429413)
   Charlotte J. Green, Tora I. Henriksen, Bente K. Pedersen et al. · 2012-08-28 · valyu/valyu-pubmed · DOI 10.1371/journal.pone.0044284  
15. [Novel Site-Specific Fatty Chain-Modified GLP-1 Receptor Agonist with Potent Antidiabetic Effects](https://pubmed.ncbi.nlm.nih.gov/PMC6412877)
   Xia Zhong, Zhu Chen, Qiong Chen et al. · 2019-02-21 · valyu/valyu-pubmed · DOI 10.3390/molecules24040779  
16. [DNA-based delivery of incretin receptor agonists using MYO Technology leads to durable weight loss in a diet-induced obesity model](https://www.biorxiv.org/content/10.1101/2025.05.30.656889)
   Linda Sasset, Andrew Cameron, Carleigh Sussman et al. · 2025-01-01 · valyu/valyu-biorxiv · DOI 10.1101/2025.05.30.656889  
17. [Physiology and Emerging Biochemistry of the Glucagon-Like Peptide-1 Receptor](https://pubmed.ncbi.nlm.nih.gov/PMC3359799)
   Francis S. Willard, Kyle W. Sloop · 2012-05-14 · valyu/valyu-pubmed · DOI 10.1155/2012/470851  
18. [Signaling architecture of the glucagon-like peptide-1 receptor](https://pubmed.ncbi.nlm.nih.gov/PMC12807469)
   Gregory Austin, Alejandra Tomas · 2026-01-16 · valyu/valyu-pubmed · DOI 10.1172/jci194752  
19. [Dynamics of GLP-1R peptide agonist engagement are correlated with kinetics of G protein activation](https://www.biorxiv.org/content/10.1101/2021.03.10.434902)
   Giuseppe Deganutti, Yi-Lynn Liang, Xin Zhang et al. · 2021-01-01 · valyu/valyu-biorxiv · DOI 10.1101/2021.03.10.434902  
20. [WEGOVY (SEMAGLUTIDE) INJECTION, SOLUTION WEGOVY (SEMAGLUTIDE) TABLET [NOVO NORDISK PHARMACEUTICAL INDUSTRIES, LP]](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=ee06186f-2aa3-4990-a760-757579d8f77b)
   valyu/valyu-drug-labels  
   Also available: <https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=27f15fac-7d98-4114-a2ec-92494a91da98>  
   Also available: <https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=adec4fd2-6858-4c99-91d4-531f5f2a2d79>  
   Also available: <https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=42bdd912-2393-44c4-b7e0-47672ca28991>  
   Also available: <https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=f5e548d0-cc79-4c34-a3f5-e20a5b8b6564>
