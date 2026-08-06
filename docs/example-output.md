# Example output

A complete task, captured verbatim from the deployed system. Shows the
generated sub-queries, the sources retrieval selected, and the final report.

```
question    Does semaglutide preserve lean muscle mass in older adults during weight loss?
date range  from 2022-01-01
status      completed
cost        $0.03 measured, across 4 Valyu transactions
sources     20 after deduplication, 10 cited in the report
```

## 1. Generated sub-queries

Produced by one Gemini Flash call. Note that these decompose the question by
*facet* rather than rephrasing it, and each is routed to the corpus likely to
hold that facet.

**1. `semaglutide body composition changes lean mass skeletal muscle older adults`**

- Sources: `valyu/valyu-pubmed`, `valyu/valyu-clinical-trials`
- Results: 10
- Rationale: This facet focuses on clinical trial data specifically measuring changes in lean body mass and skeletal muscle in geriatric populations.

**2. `GLP-1 receptor agonist mechanism muscle protein synthesis sarcopenia prevention`**

- Sources: `valyu/valyu-biorxiv`, `valyu/valyu-medrxiv`
- Results: 10
- Rationale: Investigating the biological mechanisms and pre-clinical evidence regarding how GLP-1 agonists influence muscle metabolism and protein synthesis.

**3. `semaglutide versus tirzepatide muscle mass loss comparative effectiveness`**

- Sources: `valyu/valyu-pubmed`, `web`
- Results: 10
- Rationale: Comparing semaglutide with other incretin mimetics helps determine if muscle preservation is a class effect or specific to this drug.

**4. `semaglutide adverse events muscle weakness sarcopenia geriatric population`**

- Sources: `valyu/valyu-openfda-drug-events`, `valyu/valyu-drug-labels`
- Results: 5
- Rationale: Analyzing post-market safety data and official labels for reported side effects related to muscle loss or weakness in older patients.

## 2. Selected sources

20 sources after identifier and title/author deduplication, reranked
against the original question. `relevance` is the rerank score; Valyu's own
score is per-sub-query and not comparable across them.

| # | Title | Dataset | Date | Identifier | Relevance | Cited |
|---|---|---|---|---|---|---|
| 1 | [Impact of Incretin-Based Therapy on Skeletal Muscle Health](https://pubmed.ncbi.nlm.nih.gov/PMC12471476) | `pubmed` | 2025-09-18 | `10.3390/medicina61091691` | 1 | ✓ |
| 2 | [GLP-1 Receptor Agonists for Obesity Management in Older Adults: …](https://pubmed.ncbi.nlm.nih.gov/PMC13272609) | `pubmed` | 2026-06-17 | `10.1007/s13668-026-00777-x` | 1 | ✓ |
| 3 | [Pharmacological weight loss with incretin-based therapies does n…](https://www.medrxiv.org/content/10.1101/2025.07.28.25332295) | `medrxiv` | 2025-01-01 | `10.1101/2025.07.28.25332295` | 0.7 | ✓ |
| 4 | [Semaglutide-induced weight loss improves mitochondrial energy ef…](https://www.biorxiv.org/content/10.1101/2024.11.13.623431) | `biorxiv` | 2024-01-01 | `10.1101/2024.11.13.623431` | 0.7 | ✓ |
| 5 | [Females are protected from semaglutide-induced muscle loss in *o…](https://doi.org/10.64898/2026.03.03.709376) | `biorxiv` | 2026-01-01 | `10.64898/2026.03.03.709376` | 0.7 | ✓ |
| 6 | [Impact of Semaglutide on fat mass, lean mass and muscle function…](https://pubmed.ncbi.nlm.nih.gov/PMC12673431) | `pubmed` | 2025-10-09 | `10.1111/dom.70141` | 0.7 | ✓ |
| 7 | [The Influence of Glucagon-like Peptide-1 Receptor Agonists and O…](https://pubmed.ncbi.nlm.nih.gov/PMC12733374) | `pubmed` | 2025-12-17 | `10.3390/ijms262412130` | 0.7 | ✓ |
| 8 | [Effect of Semaglutide on Physical Function, Body Composition, an…](https://pubmed.ncbi.nlm.nih.gov/PMC11437224) | `pubmed` | 2024-09-13 | `10.2196/62667` | 0.7 | ✓ |
| 9 | [Moving beyond the scale: musculoskeletal risks, evidence gaps an…](https://pubmed.ncbi.nlm.nih.gov/PMC12592101) | `pubmed` | 2025-10-24 | `10.3389/fragi.2025.1640030` | 0.7 | ✓ |
| 10 | [Preserving musculoskeletal health through resistance training in…](https://www.medrxiv.org/content/10.1101/2025.06.24.25330195) | `medrxiv` | 2025-01-01 | `10.1101/2025.06.24.25330195` | 0.4 | ✓ |
| 11 | [Glucagon-Like Peptide-1 Receptor Activation Stimulates PKA-Media…](https://www.biorxiv.org/content/10.1101/2022.04.21.489078) | `biorxiv` | 2023-01-01 | `10.1101/2022.04.21.489078` | 0.4 |  |
| 12 | [DNA-based delivery of incretin receptor agonists using MYO Techn…](https://www.biorxiv.org/content/10.1101/2025.05.30.656889) | `biorxiv` | 2025-01-01 | `10.1101/2025.05.30.656889` | 0.4 |  |
| 13 | [Tirzepatide Versus Semaglutide on Weight Loss in Type 2 Diabetes…](https://pubmed.ncbi.nlm.nih.gov/PMC11970626) | `pubmed` | 2025-04-04 | `10.1002/edm2.70045` | 0.4 |  |
| 14 | [Tirzepatide Versus Semaglutide for Weight Loss in Overweight and…](https://pubmed.ncbi.nlm.nih.gov/PMC12263181) | `pubmed` | 2025-06-15 | `10.7759/cureus.86080` | 0.4 |  |
| 15 | [Comparative Efficacy and Tolerability of Tirzepatide Versus Sema…](https://pubmed.ncbi.nlm.nih.gov/PMC12444735) | `pubmed` | 2025-08-17 | `10.7759/cureus.90335` | 0.4 |  |
| 16 | [Comparative Efficacy and Safety of Tirzepatide versus Semaglutid…](https://pubmed.ncbi.nlm.nih.gov/PMC13215652) | `pubmed` | 2026-04-02 | `10.3126/nje.v16i1.92323` | 0.4 |  |
| 17 | [Effects of Tirzepatide on Skeletal Muscle Mass in Adults: A Syst…](https://pubmed.ncbi.nlm.nih.gov/PMC12394919) | `pubmed` | 2025-07-29 | `10.7759/cureus.89020` | 0.4 |  |
| 18 | [Weight loss in people with type 1 diabetes over 12 months: Real‐…](https://pubmed.ncbi.nlm.nih.gov/PMC12673458) | `pubmed` | 2025-10-06 | `10.1111/dom.70172` | 0.4 |  |
| 19 | [Comparative real-world outcomes of tirzepatide vs semaglutide in…](https://pubmed.ncbi.nlm.nih.gov/PMC13319829) | `pubmed` | 2026-06-30 | `10.1177/14791641261465360` | 0.4 |  |
| 20 | [WEGOVY (SEMAGLUTIDE) INJECTION, SOLUTION WEGOVY (SEMAGLUTIDE) TA…](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=ee06186f-2aa3-4990-a760-757579d8f77b) | `drug-labels` | — | `—` | 0 |  |

### Deduplication

Sources that absorbed duplicates. Most are Valyu returning one document as
several chunked results, which share a DOI; their text is rejoined rather
than discarded.

- **[1]** Impact of Incretin-Based Therapy on Skeletal Muscle Heal — merged 1 (doi×1)
- **[2]** GLP-1 Receptor Agonists for Obesity Management in Older  — merged 1 (doi×1)
- **[3]** Pharmacological weight loss with incretin-based therapie — merged 1 (doi×1)
- **[8]** Effect of Semaglutide on Physical Function, Body Composi — merged 1 (doi×1)
- **[9]** Moving beyond the scale: musculoskeletal risks, evidence — merged 1 (doi×1)
- **[10]** Preserving musculoskeletal health through resistance tra — merged 1 (doi×1)
- **[11]** Glucagon-Like Peptide-1 Receptor Activation Stimulates P — merged 1 (doi×1)
- **[12]** DNA-based delivery of incretin receptor agonists using M — merged 1 (doi×1)
- **[13]** Tirzepatide Versus Semaglutide on Weight Loss in Type 2  — merged 1 (doi×1)
- **[14]** Tirzepatide Versus Semaglutide for Weight Loss in Overwe — merged 1 (doi×1)
- **[17]** Effects of Tirzepatide on Skeletal Muscle Mass in Adults — merged 1 (doi×1)
- **[20]** WEGOVY (SEMAGLUTIDE) INJECTION, SOLUTION WEGOVY (SEMAGLU — merged 4 (url×4)

## 3. Final report

Rendered verbatim. Citation numbers correspond to the table above.

---

Based on the provided sources, semaglutide treatment leads to a loss of lean mass alongside a greater loss of fat mass. While absolute lean mass decreases, some studies suggest the proportion of lean mass relative to total body mass is preserved or may even increase, and muscle function appears to be maintained. The corpus does not contain published results from studies focused specifically on older adults, though it identifies this as a key area of concern and ongoing research.

## Effects on Body Composition

Semaglutide induces significant weight loss, which consists of reductions in both fat mass and lean mass [1, 5]. A key concern with pharmacological weight loss is the potential for losing fat-free mass, which includes skeletal muscle, particularly in populations prone to sarcopenia like older adults [7, 9].

The proportion of lean mass lost varies across studies. A substudy of the large STEP-1 trial found that weight loss from semaglutide was composed of approximately 40% lean body mass and 60% fat mass [1]. However, smaller controlled trials suggest a more favorable ratio. One 12-week study reported that fat mass loss was about three times greater than lean mass loss [1, 6]. Another study, SEMALEAN, used a high dose of semaglutide (2.4 mg) in patients with obesity and found an initial significant decrease in lean mass at seven months, which then stabilized through the 12-month mark [6]. In that same study, the proportion of lean mass relative to total body mass increased between months 7 and 12 [6]. Similarly, a study cited in a review noted that while total lean mass decreased by 9.7%, its proportion relative to total body mass increased by 3.0 percentage points [6]. Other short-term studies also show a proportional preservation of muscle mass, where the percentage of skeletal muscle mass remained the same despite a reduction in absolute mass [1].

Systematic reviews have reported that approximately 20-30% of the total weight lost during treatment with GLP-1 receptor agonists like semaglutide is from lean mass [10].

## Impact on Muscle Function

Despite the reduction in absolute lean mass, several studies indicate that muscle function is preserved during semaglutide treatment. In patients with type 2 diabetes, bioimpedance studies observed that while fat-free mass index declined modestly in the first 12 weeks before stabilizing, hand grip strength and muscle quality index (defined as strength per muscle mass) remained unchanged over 26 weeks to one year of treatment [1].

The SEMALEAN study, which used gold-standard methods to assess body composition and function, reported that handgrip strength actually increased between 7 and 12 months of treatment [6]. This study also found that the prevalence of sarcopenic obesity among participants decreased from 49% at baseline to 33% at 12 months [6].

## Evidence in Older Adults

The provided sources do not contain published results from randomized controlled trials that specifically assess the effects of semaglutide on lean muscle mass in older adults. This is a significant gap, as older adults are considered a "sarcopenia-prone" population where disproportionate lean mass loss is a particular concern [7]. The "adverse musculoskeletal risks" associated with pharmacologically induced weight loss in older adults are a focus of emerging research [9].

A scoping review on GLP-1 agonists in older adults noted that the effects of a similar drug, liraglutide, on body composition in this population remain "insufficiently characterized" [2]. The provided text for this review's section on semaglutide was incomplete [2].

Highlighting the importance of this question, a protocol for an open-label randomized controlled trial was found in the corpus [8]. This study is specifically designed to investigate the effect of semaglutide on body composition, physical function, and biomarkers of aging in older adults with overweight and insulin resistance. Results from this trial are anticipated in late 2024 and should provide direct evidence to answer the question [8]. Furthermore, the concern about muscle loss has led to research into combination strategies; one early-phase trial found that adding a muscle-promoting agent to semaglutide significantly reduced lean mass loss compared to semaglutide alone, underscoring the functional benefits of preserving muscle [9].

## Limitations

The primary limitation of this report is that the provided sources lack published data from studies focused specifically on the effects of semaglutide on lean muscle mass in older adults. The corpus identifies this as an evidence gap and includes a protocol for an ongoing trial designed to address this question, but no results are available yet [8]. The findings on body composition and muscle function are derived from studies on general adult populations with obesity or type 2 diabetes, which may have included older individuals but did not report age-specific outcomes [1, 6]. Some sources were preclinical studies in mice, and their relevance to human physiology is uncertain [3, 4, 5]. The search was restricted to research from January 2022 onwards, so relevant older studies may have been omitted. Finally, the provided text for some sources was incomplete, which may have limited the available information [2, 3].

## Sources

1. [Impact of Incretin-Based Therapy on Skeletal Muscle Health](https://pubmed.ncbi.nlm.nih.gov/PMC12471476)
   Andrijana Koceva, Andrej Janež, Mojca Jensterle et al. · 2025-09-18 · valyu/valyu-pubmed · DOI 10.3390/medicina61091691  
2. [GLP-1 Receptor Agonists for Obesity Management in Older Adults: A Scoping Review on the Risk of Sarcopenia and Sarcopenic Obesity](https://pubmed.ncbi.nlm.nih.gov/PMC13272609)
   Hilal Simsek, Asli Ucar · 2026-06-17 · valyu/valyu-pubmed · DOI 10.1007/s13668-026-00777-x  
3. [Pharmacological weight loss with incretin-based therapies does not result in a disproportionate loss of muscle mass or function in obese mice and humans](https://www.medrxiv.org/content/10.1101/2025.07.28.25332295)
   Henning Tim Langer, Natalie K. Gilmore, Chris M. T. Hayden et al. · 2025-01-01 · valyu/valyu-medrxiv · DOI 10.1101/2025.07.28.25332295  
4. [Semaglutide-induced weight loss improves mitochondrial energy efficiency in skeletal muscle](https://www.biorxiv.org/content/10.1101/2024.11.13.623431)
   Ran Hee Choi, Takuya Karasawa, Cesar A. Meza et al. · 2024-01-01 · valyu/valyu-biorxiv · DOI 10.1101/2024.11.13.623431  
5. [Females are protected from semaglutide-induced muscle loss in *ob/ob* mice](https://doi.org/10.64898/2026.03.03.709376)
   Subhasmita Rout, Takuya Karasawa, Shinya Watanabe et al. · 2026-01-01 · valyu/valyu-biorxiv · DOI 10.64898/2026.03.03.709376  
6. [Impact of Semaglutide on fat mass, lean mass and muscle function in patients with obesity: The  SEMALEAN  study Alissou et al.](https://pubmed.ncbi.nlm.nih.gov/PMC12673431)
   Mathieu Alissou, Thomas Demangeat, Vanessa Folope et al. · 2025-10-09 · valyu/valyu-pubmed · DOI 10.1111/dom.70141  
7. [The Influence of Glucagon-like Peptide-1 Receptor Agonists and Other Incretin Hormone Agonists on Body Composition](https://pubmed.ncbi.nlm.nih.gov/PMC12733374)
   Lampros Chrysavgis, Niki Gerasimoula Mourelatou, Maria-Evangelia Koloutsou et al. · 2025-12-17 · valyu/valyu-pubmed · DOI 10.3390/ijms262412130  
8. [Effect of Semaglutide on Physical Function, Body Composition, and Biomarkers of Aging in Older Adults With Overweight and Insulin Resistance: Protocol for an Open-Labeled Randomized Controlled Trial](https://pubmed.ncbi.nlm.nih.gov/PMC11437224)
   Tiffany Leung, Tiffany M Cortes, Libia Vasquez et al. · 2024-09-13 · valyu/valyu-pubmed · DOI 10.2196/62667  
9. [Moving beyond the scale: musculoskeletal risks, evidence gaps and emerging combination strategies to optimize the quality of weight loss pharmacotherapy in older adults Reid and Bhasin 10.3389/fragi.2025.1640030](https://pubmed.ncbi.nlm.nih.gov/PMC12592101)
   Kieran F. Reid, Shalender Bhasin · 2025-10-24 · valyu/valyu-pubmed · DOI 10.3389/fragi.2025.1640030  
10. [Preserving musculoskeletal health through resistance training in individuals undergoing Glucagon-like Peptide-1 Receptor Agonist Therapy: a controlled interrupted time-series analysis (Stage 1 Registered Report)](https://www.medrxiv.org/content/10.1101/2025.06.24.25330195)
   James Steele, Myles N Moore, Pramuk Mahanma et al. · 2025-01-01 · valyu/valyu-medrxiv · DOI 10.1101/2025.06.24.25330195  
11. [Glucagon-Like Peptide-1 Receptor Activation Stimulates PKA-Mediated Phosphorylation of Raptor and this Contributes to the Weight Loss Effect of Liraglutide](https://www.biorxiv.org/content/10.1101/2022.04.21.489078)
   Thao D. V. Le, Dianxin Liu, Blair J. Ellis et al. · 2023-01-01 · valyu/valyu-biorxiv · DOI 10.1101/2022.04.21.489078  
12. [DNA-based delivery of incretin receptor agonists using MYO Technology leads to durable weight loss in a diet-induced obesity model](https://www.biorxiv.org/content/10.1101/2025.05.30.656889)
   Linda Sasset, Andrew Cameron, Carleigh Sussman et al. · 2025-01-01 · valyu/valyu-biorxiv · DOI 10.1101/2025.05.30.656889  
13. [Tirzepatide Versus Semaglutide on Weight Loss in Type 2 Diabetes Patients: A Systematic Review and Meta‐Analysis of Direct Comparative Studies](https://pubmed.ncbi.nlm.nih.gov/PMC11970626)
   Jimmy Wen, Burhaan Syed, Denise Nadora et al. · 2025-04-04 · valyu/valyu-pubmed · DOI 10.1002/edm2.70045  
14. [Tirzepatide Versus Semaglutide for Weight Loss in Overweight and Obese Adults: A Systematic Review and Meta-Analysis of Direct Comparative Studies](https://pubmed.ncbi.nlm.nih.gov/PMC12263181)
   Alexander Muacevic, John R Adler, Nazish Munawar et al. · 2025-06-15 · valyu/valyu-pubmed · DOI 10.7759/cureus.86080  
15. [Comparative Efficacy and Tolerability of Tirzepatide Versus Semaglutide at Varying Doses for Weight Loss in Non-diabetic Adults With Obesity: A Network Meta-Analysis of Randomized Controlled Trials](https://pubmed.ncbi.nlm.nih.gov/PMC12444735)
   Alexander Muacevic, John R Adler, Alousious Kasagga et al. · 2025-08-17 · valyu/valyu-pubmed · DOI 10.7759/cureus.90335  
16. [Comparative Efficacy and Safety of Tirzepatide versus Semaglutide: A Systematic Review and Meta-Analysis with Cardiometabolic Implications](https://pubmed.ncbi.nlm.nih.gov/PMC13215652)
   Azhar Hafiz Baba, Rameez Akhtar, Anurag Rawat et al. · 2026-04-02 · valyu/valyu-pubmed · DOI 10.3126/nje.v16i1.92323  
17. [Effects of Tirzepatide on Skeletal Muscle Mass in Adults: A Systematic Review](https://pubmed.ncbi.nlm.nih.gov/PMC12394919)
   Alexander Muacevic, John R Adler, Roberto A Hidalgo Ramos et al. · 2025-07-29 · valyu/valyu-pubmed · DOI 10.7759/cureus.89020  
18. [Weight loss in people with type 1 diabetes over 12 months: Real‐world data comparing tirzepatide, semaglutide and liraglutide Al Ozairi et al.](https://pubmed.ncbi.nlm.nih.gov/PMC12673458)
   Ebaa Al Ozairi, Mohammad Irshad, Jumana Alkandari et al. · 2025-10-06 · valyu/valyu-pubmed · DOI 10.1111/dom.70172  
19. [Comparative real-world outcomes of tirzepatide vs semaglutide in patients with obesity and type2 diabetes: A retrospective propensity-matched cohort study](https://pubmed.ncbi.nlm.nih.gov/PMC13319829)
   Abdul Qadeer, Marwah Bintay Khalid, Ridwan Syed et al. · 2026-06-30 · valyu/valyu-pubmed · DOI 10.1177/14791641261465360  
20. [WEGOVY (SEMAGLUTIDE) INJECTION, SOLUTION WEGOVY (SEMAGLUTIDE) TABLET [NOVO NORDISK PHARMACEUTICAL INDUSTRIES, LP]](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=ee06186f-2aa3-4990-a760-757579d8f77b)
   valyu/valyu-drug-labels  
   Also available: <https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=adec4fd2-6858-4c99-91d4-531f5f2a2d79>  
   Also available: <https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=27f15fac-7d98-4114-a2ec-92494a91da98>  
   Also available: <https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=42bdd912-2393-44c4-b7e0-47672ca28991>  
   Also available: <https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=f5e548d0-cc79-4c34-a3f5-e20a5b8b6564>
