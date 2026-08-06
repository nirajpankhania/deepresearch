# Example output

A complete task, captured verbatim from the deployed system: the generated
sub-queries, the sources retrieval selected, the final report, and the
claim-grounding verdicts.

```
question    Does semaglutide preserve lean muscle mass in older adults during weight loss?
status      completed
cost        $0.03 measured, across 4 Valyu transactions
sources     20 after deduplication, 8 cited
grounding   15 of 20 cited claims fully supported
```

## 1. Generated sub-queries

One Gemini Flash call. These decompose the question by *facet* rather than
rephrasing it, and each is routed to the corpus likely to hold that facet.

**1. `semaglutide clinical trial results body composition lean mass older adults`**

- Sources: `valyu/valyu-pubmed`, `valyu/valyu-clinical-trials`
- Results: 10
- Rationale: This facet provides direct evidence from completed clinical studies regarding changes in muscle mass specifically in the elderly population.

**2. `glp-1 receptor agonist molecular mechanisms muscle protein synthesis degradation`**

- Sources: `valyu/valyu-pubmed`, `valyu/valyu-biorxiv`
- Results: 10
- Rationale: This facet explores the biological pathways by which semaglutide might influence muscle tissue at a cellular level.

**3. `adverse events sarcopenia muscle weakness semaglutide elderly patients`**

- Sources: `valyu/valyu-openfda-drug-events`, `valyu/valyu-drug-labels`
- Results: 5
- Rationale: This facet identifies real-world safety signals and reported side effects related to muscle loss and weakness in older patients.

**4. `semaglutide versus tirzepatide lean mass preservation weight loss trials`**

- Sources: `valyu/valyu-medrxiv`
- Results: 10
- Rationale: This facet compares semaglutide to other modern weight loss treatments to determine if its effect on muscle preservation is unique.

## 2. Selected sources

| # | Title | Corpus | Date | Identifier | Rel. | Cited |
|---|---|---|---|---|---|---|
| 1 | [Effect of Semaglutide on Physical Function, Body Compositi…](https://pubmed.ncbi.nlm.nih.gov/PMC11437224) | `pubmed` | 2024-09-13 | `10.2196/62667` | 1 | ✓ |
| 2 | [Impact of Incretin-Based Therapy on Skeletal Muscle Health](https://pubmed.ncbi.nlm.nih.gov/PMC12471476) | `pubmed` | 2025-09-18 | `10.3390/medicina61091691` | 0.7 | ✓ |
| 3 | [Impact of Selected Glucagon-like Peptide-1 Receptor Agonis…](https://pubmed.ncbi.nlm.nih.gov/PMC11311305) | `pubmed` | 2024-07-27 | `10.3390/ijms25158214` | 0.7 | ✓ |
| 4 | [Body Composition Changes with Semaglutide: A Systematic Re…](https://www.medrxiv.org/content/10.1101/2025.09.29.25336760) | `medrxiv` | 2025-01-01 | `10.1101/2025.09.29.25336760` | 0.7 | ✓ |
| 5 | [GLP-1 Receptor Agonists for Obesity Management in Older Ad…](https://pubmed.ncbi.nlm.nih.gov/PMC13272609) | `pubmed` | 2026-06-17 | `10.1007/s13668-026-00777-x` | 0.7 | ✓ |
| 6 | [Moving beyond the scale: musculoskeletal risks, evidence g…](https://pubmed.ncbi.nlm.nih.gov/PMC12592101) | `pubmed` | 2025-10-24 | `10.3389/fragi.2025.1640030` | 0.7 | ✓ |
| 7 | [Obesity pharmacotherapy in older adults: a narrative revie…](https://pubmed.ncbi.nlm.nih.gov/PMC11971046) | `pubmed` | 2024-05-06 | `10.1038/s41366-024-01529-z` | 0.7 | ✓ |
| 8 | [Glucagon Like Peptide-1-Induced Glucose Metabolism in Diff…](https://pubmed.ncbi.nlm.nih.gov/PMC3429413) | `pubmed` | 2012-08-28 | `10.1371/journal.pone.0044284` | 0.4 | ✓ |
| 9 | [Glucagon-Like Peptide-1 Receptor Activation Stimulates PKA…](https://www.biorxiv.org/content/10.1101/2022.04.21.489078) | `biorxiv` | 2023-01-01 | `10.1101/2022.04.21.489078` | 0.4 |  |
| 10 | [Comparative Effectiveness of Semaglutide and Tirzepatide f…](https://www.medrxiv.org/content/10.1101/2023.11.21.23298775) | `medrxiv` | 2023-01-01 | `10.1101/2023.11.21.23298775` | 0.4 |  |
| 11 | [Weight trajectories after last Tirzepatide or Semaglutide …](https://doi.org/10.64898/2026.01.26.26344839) | `medrxiv` | 2026-01-01 | `10.64898/2026.01.26.26344839` | 0.4 |  |
| 12 | [Trajectory of weight regain after cessation of GLP-1 recep…](https://www.medrxiv.org/content/10.1101/2025.06.09.25328726) | `medrxiv` | 2025-01-01 | `10.1101/2025.06.09.25328726` | 0.4 |  |
| 13 | [Adverse Event Comparison between Glucagon-like Peptide-1 R…](https://www.medrxiv.org/content/10.1101/2024.04.21.24306138) | `medrxiv` | 2024-01-01 | `10.1101/2024.04.21.24306138` | 0.4 |  |
| 14 | [Comparison of semaglutide and lifestyle counseling for wei…](https://doi.org/10.64898/2025.12.01.25341393) | `medrxiv` | 2025-01-01 | `10.64898/2025.12.01.25341393` | 0.4 |  |
| 15 | [Effects of tirzepatide therapy on body weight and body com…](https://pubmed.ncbi.nlm.nih.gov/PMC13388208) | `pubmed` | 2026-06-19 | `10.3389/fendo.2026.1834580` | 0.4 |  |
| 16 | [Pleiotropic Effects of GLP-1 and Analogs on Cell Signaling…](https://pubmed.ncbi.nlm.nih.gov/PMC6266510) | `pubmed` | 2018-11-23 | `10.3389/fendo.2018.00672` | 0 |  |
| 17 | [Differences in signalling, trafficking and glucoregulatory…](https://www.biorxiv.org/content/10.1101/803833) | `biorxiv` | 2019-01-01 | `10.1101/803833` | 0 |  |
| 18 | [Rational design by structural biology of industrializable,…](https://www.biorxiv.org/content/10.1101/2022.04.11.487850) | `biorxiv` | 2022-01-01 | `10.1101/2022.04.11.487850` | 0 |  |
| 19 | [Physiology and Emerging Biochemistry of the Glucagon-Like …](https://pubmed.ncbi.nlm.nih.gov/PMC3359799) | `pubmed` | 2012-05-14 | `10.1155/2012/470851` | 0 |  |
| 20 | [Trends and Disparities in Newer GLP1 Receptor Agonist Init…](https://www.medrxiv.org/content/10.1101/2025.01.20.25320839) | `medrxiv` | 2025-01-01 | `10.1101/2025.01.20.25320839` | 0 |  |

**Deduplication.** Most merges are Valyu returning one document as several
chunked results sharing a DOI; their text is rejoined rather than discarded.

- **[1]** Effect of Semaglutide on Physical Function, Body C — 1 merged (doi×1)
- **[4]** Body Composition Changes with Semaglutide: A Syste — 1 merged (doi×1)
- **[5]** GLP-1 Receptor Agonists for Obesity Management in  — 1 merged (doi×1)
- **[6]** Moving beyond the scale: musculoskeletal risks, ev — 1 merged (doi×1)
- **[7]** Obesity pharmacotherapy in older adults: a narrati — 1 merged (doi×1)
- **[8]** Glucagon Like Peptide-1-Induced Glucose Metabolism — 1 merged (doi×1)
- **[10]** Comparative Effectiveness of Semaglutide and Tirze — 1 merged (doi×1)
- **[14]** Comparison of semaglutide and lifestyle counseling — 1 merged (doi×1)
- **[15]** Effects of tirzepatide therapy on body weight and  — 1 merged (doi×1)
- **[18]** Rational design by structural biology of industria — 1 merged (doi×1)

## 3. Claim grounding

Every citation-bearing sentence re-read against the source it cites.
**15 of 20 fully supported.**

Claims that did not fully verify:

- **unsupported** — “The available evidence is scarce and indirect [7].”
  <br>*The source text discusses the 'obesity paradox' and the rationale for pharmacological intervention but does not state that evidence is scarce and indirect.*
- **unsupported** — “A narrative review on obesity pharmacotherapy in this population notes that "scarce evidence exists" for agents like semaglutide [7].”
  <br>*The provided text does not contain the phrase 'scarce evidence exists' for semaglutide; it discusses the obesity paradox and incretin receptor agonists generally.*
- **unsupported** — “The section intended to discuss semaglutide-based clinical evidence from the SUSTAIN trials cuts off before presenting any findings [5].”
  <br>*The provided text discusses liraglutide and ends with a sentence about liraglutide; it does not mention the SUSTAIN trials or semaglutide clinical evidence.*
- **unsupported** — “In vitro studies on muscle cells also found that semaglutide and liraglutide could counteract atrophy-related molecular changes [3].”
  <br>*While the source mentions molecular markers of atrophy, it does not specifically detail in vitro studies on muscle cells counteracting these changes.*
- **partial** — “One is a protocol for a future study [1], another is the introduction to a meta-analysis that does not include its findings [4], and a third contains an incomplete sentence at the critical point of discussing semaglutide's effects on body composition [5].”
  <br>*The first two points are supported, but the third source ends with an incomplete sentence about liraglutide, not semaglutide.*

## 4. Final report

Verbatim. Citation numbers correspond to the source table above.

---

Based on the provided sources, there is no definitive answer as to whether semaglutide preserves lean muscle mass in older adults during weight loss. The available evidence is scarce and indirect [7]. One clinical trial of a combination therapy implies that semaglutide used alone does result in a loss of lean mass in older adults, while preclinical studies in animals suggest a potential for muscle-protective effects [2, 3, 6].

## Evidence from Human Clinical Trials

The sources contain limited direct evidence from human clinical trials on semaglutide's effect on lean mass in older adults. A narrative review on obesity pharmacotherapy in this population notes that "scarce evidence exists" for agents like semaglutide [7].

The most direct finding comes from a Phase 2 trial that tested semaglutide in combination with another drug. In this trial, adding the investigational agent enobosarm to semaglutide "reduced lean mass loss by 71%" compared to treatment with semaglutide alone [6]. This result suggests that semaglutide by itself causes a loss of lean muscle mass, which can be partially prevented with an adjunctive therapy [6].

The need for more research in this area is highlighted by a protocol for an upcoming open-label randomized controlled trial. This planned study aims to investigate the effect of semaglutide on body composition, physical function, and biomarkers of aging specifically in older adults with overweight and insulin resistance [1]. Similarly, the introduction to a systematic review and meta-analysis (a preprint) notes that evidence regarding semaglutide's effect on body composition is "mixed," with some studies reporting minimal loss of lean body mass and others suggesting more substantial reductions [4]. However, neither of these sources provides results from their respective studies [1, 4].

A scoping review on GLP-1 receptor agonists in older adults also touches on the topic, but the provided text is incomplete. It mentions that the effects of a similar drug, liraglutide, on body composition in older adults are "insufficiently characterized" [5]. The section intended to discuss semaglutide-based clinical evidence from the SUSTAIN trials cuts off before presenting any findings [5].

## Preclinical and Mechanistic Evidence

While clinical data on older adults is limited, preclinical studies in animal and cell models suggest that GLP-1 receptor agonists (RAs) like semaglutide may have beneficial effects on muscle tissue [2, 3].

In mouse models of diabetes and high-fat diets, semaglutide was found to increase muscle mass and fiber size, restore muscle strength, and reduce fat infiltration in muscle [2]. Another study in obese mice observed that semaglutide improved sarcopenic adiposity and reversed obesity-related changes in muscle fiber types [3]. In a different mouse model of muscle atrophy, semaglutide attenuated muscle wasting and preserved grip strength [2].

Mechanistically, these protective effects in preclinical models are linked to the suppression of molecular markers for muscle protein degradation (atrogin-1 and MuRF-1) and an increase in factors that promote muscle growth (MyoD and MyoG) [2, 3]. In vitro studies on muscle cells also found that semaglutide and liraglutide could counteract atrophy-related molecular changes [3]. Furthermore, GLP-1 has been shown to promote glucose uptake in human muscle satellite cells, and the GLP-1 receptor is expressed in human muscle tissue, suggesting a potential for direct physiological relevance [8].

## Limitations

The provided sources do not contain sufficient evidence to fully answer the question. The primary limitations are:
*   The corpus lacks results from any completed clinical trial that directly measured changes in lean muscle mass in older adults treated with semaglutide alone for weight loss.
*   The most relevant human data comes from a trial of a *combination therapy*, which allows for an inference about semaglutide but does not directly report on its isolated effects on lean mass [6].
*   Several sources that appear highly relevant do not contain results. One is a protocol for a future study [1], another is the introduction to a meta-analysis that does not include its findings [4], and a third contains an incomplete sentence at the critical point of discussing semaglutide's effects on body composition [5].
*   Evidence suggesting a muscle-protective effect of semaglutide is derived entirely from preclinical studies in mice and cell cultures [2, 3]. These findings may not translate to clinical outcomes in older humans undergoing significant weight loss.

## Sources

1. [Effect of Semaglutide on Physical Function, Body Composition, and Biomarkers of Aging in Older Adults With Overweight and Insulin Resistance: Protocol for an Open-Labeled Randomized Controlled Trial](https://pubmed.ncbi.nlm.nih.gov/PMC11437224)
   Tiffany Leung, Tiffany M Cortes, Libia Vasquez et al. · 2024-09-13 · valyu/valyu-pubmed · DOI 10.2196/62667  
2. [Impact of Incretin-Based Therapy on Skeletal Muscle Health](https://pubmed.ncbi.nlm.nih.gov/PMC12471476)
   Andrijana Koceva, Andrej Janež, Mojca Jensterle et al. · 2025-09-18 · valyu/valyu-pubmed · DOI 10.3390/medicina61091691  
3. [Impact of Selected Glucagon-like Peptide-1 Receptor Agonists on Serum Lipids, Adipose Tissue, and Muscle Metabolism—A Narrative Review](https://pubmed.ncbi.nlm.nih.gov/PMC11311305)
   Zsolt Szekeres, Andras Nagy, Kamilla Jahner et al. · 2024-07-27 · valyu/valyu-pubmed · DOI 10.3390/ijms25158214  
4. [Body Composition Changes with Semaglutide: A Systematic Review and Meta-Analysis](https://www.medrxiv.org/content/10.1101/2025.09.29.25336760)
   Guilherme Giorelli, Milton Mizumoto, Silvia Sartoretto et al. · 2025-01-01 · valyu/valyu-medrxiv · DOI 10.1101/2025.09.29.25336760  
5. [GLP-1 Receptor Agonists for Obesity Management in Older Adults: A Scoping Review on the Risk of Sarcopenia and Sarcopenic Obesity](https://pubmed.ncbi.nlm.nih.gov/PMC13272609)
   Hilal Simsek, Asli Ucar · 2026-06-17 · valyu/valyu-pubmed · DOI 10.1007/s13668-026-00777-x  
6. [Moving beyond the scale: musculoskeletal risks, evidence gaps and emerging combination strategies to optimize the quality of weight loss pharmacotherapy in older adults Reid and Bhasin 10.3389/fragi.2025.1640030](https://pubmed.ncbi.nlm.nih.gov/PMC12592101)
   Kieran F. Reid, Shalender Bhasin · 2025-10-24 · valyu/valyu-pubmed · DOI 10.3389/fragi.2025.1640030  
7. [Obesity pharmacotherapy in older adults: a narrative review of evidence](https://pubmed.ncbi.nlm.nih.gov/PMC11971046)
   Alex E. Henney, John P. H. Wilding, Uazman Alam et al. · 2024-05-06 · valyu/valyu-pubmed · DOI 10.1038/s41366-024-01529-z  
8. [Glucagon Like Peptide-1-Induced Glucose Metabolism in Differentiated Human Muscle Satellite Cells Is Attenuated by Hyperglycemia Hyperglycemia Attenuates GLP-1 Glucose Uptake](https://pubmed.ncbi.nlm.nih.gov/PMC3429413)
   Charlotte J. Green, Tora I. Henriksen, Bente K. Pedersen et al. · 2012-08-28 · valyu/valyu-pubmed · DOI 10.1371/journal.pone.0044284  
9. [Glucagon-Like Peptide-1 Receptor Activation Stimulates PKA-Mediated Phosphorylation of Raptor and this Contributes to the Weight Loss Effect of Liraglutide](https://www.biorxiv.org/content/10.1101/2022.04.21.489078)
   Thao D. V. Le, Dianxin Liu, Blair J. Ellis et al. · 2023-01-01 · valyu/valyu-biorxiv · DOI 10.1101/2022.04.21.489078  
10. [Comparative Effectiveness of Semaglutide and Tirzepatide for Weight Loss in Adults with Overweight and Obesity in the US: A Real-World Evidence Study](https://www.medrxiv.org/content/10.1101/2023.11.21.23298775)
   Patricia J Rodriguez, Brianna M Goodwin Cartwright, Samuel Gratzl et al. · 2023-01-01 · valyu/valyu-medrxiv · DOI 10.1101/2023.11.21.23298775  
11. [Weight trajectories after last Tirzepatide or Semaglutide prescription across a federated health network](https://doi.org/10.64898/2026.01.26.26344839)
   Karthik Murugadoss, Gowtham Varma, AJ Venkatakrishnan et al. · 2026-01-01 · valyu/valyu-medrxiv · DOI 10.64898/2026.01.26.26344839  
12. [Trajectory of weight regain after cessation of GLP-1 receptor agonists: a systematic review and nonlinear meta-regression](https://www.medrxiv.org/content/10.1101/2025.06.09.25328726)
   Brajan Budini, Steven Luo, Martin Tam et al. · 2025-01-01 · valyu/valyu-medrxiv · DOI 10.1101/2025.06.09.25328726  
13. [Adverse Event Comparison between Glucagon-like Peptide-1 Receptor Agonists and Other Anti-Obesity Medications Following Bariatric Surgery](https://www.medrxiv.org/content/10.1101/2024.04.21.24306138)
   Jason M Samuels, Kevin Niswender, Christianne L. Roumie et al. · 2024-01-01 · valyu/valyu-medrxiv · DOI 10.1101/2024.04.21.24306138  
14. [Comparison of semaglutide and lifestyle counseling for weight loss using electronic health records](https://doi.org/10.64898/2025.12.01.25341393)
   William Powell, Diego R Mazzotti, Stephen D Herrmann et al. · 2025-01-01 · valyu/valyu-medrxiv · DOI 10.64898/2025.12.01.25341393  
15. [Effects of tirzepatide therapy on body weight and body composition in adults with overweight and obesity](https://pubmed.ncbi.nlm.nih.gov/PMC13388208)
   Haley Corso, Austin J. Graybeal, Emily Hoelscher et al. · 2026-06-19 · valyu/valyu-pubmed · DOI 10.3389/fendo.2026.1834580  
16. [Pleiotropic Effects of GLP-1 and Analogs on Cell Signaling, Metabolism, and Function](https://pubmed.ncbi.nlm.nih.gov/PMC6266510)
   Jordan Rowlands, Julian Heng, Philip Newsholme et al. · 2018-11-23 · valyu/valyu-pubmed · DOI 10.3389/fendo.2018.00672  
17. [Differences in signalling, trafficking and glucoregulatory properties of glucagon-like peptide-1 receptor agonists exendin-4 and lixisenatide](https://www.biorxiv.org/content/10.1101/803833)
   Philip Pickford, Maria Lucey, Zijian Fang et al. · 2019-01-01 · valyu/valyu-biorxiv · DOI 10.1101/803833  
18. [Rational design by structural biology of industrializable, long-acting antihyperglycemic GLP-1 receptor agonists](https://www.biorxiv.org/content/10.1101/2022.04.11.487850)
   Lei Sun, Zhi-Ming Zheng, Chang-Sheng Shao et al. · 2022-01-01 · valyu/valyu-biorxiv · DOI 10.1101/2022.04.11.487850  
19. [Physiology and Emerging Biochemistry of the Glucagon-Like Peptide-1 Receptor](https://pubmed.ncbi.nlm.nih.gov/PMC3359799)
   Francis S. Willard, Kyle W. Sloop · 2012-05-14 · valyu/valyu-pubmed · DOI 10.1155/2012/470851  
20. [Trends and Disparities in Newer GLP1 Receptor Agonist Initiation among Real-World Adult Patients Eligible for Obesity Treatment](https://www.medrxiv.org/content/10.1101/2025.01.20.25320839)
   Rotana M. Radwan, Yao An Lee, Pareeta Kotecha et al. · 2025-01-01 · valyu/valyu-medrxiv · DOI 10.1101/2025.01.20.25320839
