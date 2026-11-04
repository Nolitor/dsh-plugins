# TokenEconomizer 3-day adversarial audit (D)
Window: 1793571849158 - 1793831049158
Generated: 2026-11-04T23:00:24.027Z

## Headline
- Scanned sessions: 0 (real: 0, fixtures: 0)
- Replacements in window (surfaceOp replace): 229

## Claims audit
1. TE warm rewrites: claimed 229, measured 229 | Net(warm+cold): claimed 982680, measured 982680 | Inflating: claimed 0, measured 0
2. Cold tier: claimed 0, measured 0
3. Dedup pointers: claimed 4 (append, not replace) | measured 0 (append=0, replace=0)
4. Harness pruner conflations: claimed 0, measured 0
5. TE rewrite whose original contains "tool result middle pruned": claimed exactly 1, measured 1

## Per-class
| class | count | charsBefore | charsAfter | net |
|---|---|---|---|---|
| te_warm | 229 | 1668821 | 686141 | 982680 |
| te_cold | 0 | 0 | 0 | 0 |
| te_dedup_pointer | 0 | 0 | 0 | 0 |
| harness_pruner | 0 | 0 | 0 | 0 |
| other | 0 | 0 | 0 | 0 |

## Day table (Asia/Seoul)
- 2026-11-02: rewrites=30 net=187387 inflating=0
- 2026-11-03: rewrites=78 net=239625 inflating=0
- 2026-11-04: rewrites=67 net=304402 inflating=0
- 2026-11-05: rewrites=54 net=251266 inflating=0

## Samples (first 20)
- [te_warm] seq1499(orig52) 7976->3264: [tokeneconomizer] warm tier: the tool output was replaced by its structure. --- 
- [te_warm] seq1501(orig97) 8000->2797: [tokeneconomizer] warm tier: the tool output was replaced by its structure. --- 
- [te_warm] seq1503(orig133) 20380->2891: [tokeneconomizer] warm tier: the tool output was replaced by its structure. --- 
- [te_warm] seq1505(orig146) 11252->2948: [tokeneconomizer] warm tier: the tool output was replaced by its structure. --- 
- [te_warm] seq1507(orig155) 6612->2889: [tokeneconomizer] warm tier: the tool output was replaced by its structure. --- 
- [te_warm] seq1509(orig166) 10472->3061: [tokeneconomizer] warm tier: the tool output was replaced by its structure. --- 
- [te_warm] seq1511(orig184) 6000->2828: [tokeneconomizer] warm tier: the tool output was replaced by its structure. --- 
- [te_warm] seq1513(orig195) 8455->3045: [tokeneconomizer] warm tier: the tool output was replaced by its structure. --- 
- [te_warm] seq1515(orig222) 8541->2814: [tokeneconomizer] warm tier: the tool output was replaced by its structure. --- 
- [te_warm] seq1517(orig240) 4226->2933: [tokeneconomizer] warm tier: the tool output was replaced by its structure. --- 
- [te_warm] seq1519(orig276) 5872->2907: [tokeneconomizer] warm tier: the tool output was replaced by its structure. --- 
- [te_warm] seq1521(orig294) 9152->3295: [tokeneconomizer] warm tier: the tool output was replaced by its structure. --- 
- [te_warm] seq1523(orig337) 14507->3102: [tokeneconomizer] warm tier: the tool output was replaced by its structure. --- 
- [te_warm] seq1525(orig344) 14843->3136: [tokeneconomizer] warm tier: the tool output was replaced by its structure. --- 
- [te_warm] seq1527(orig376) 4465->2918: [tokeneconomizer] warm tier: the tool output was replaced by its structure. --- 
- [te_warm] seq1529(orig412) 4528->3494: [tokeneconomizer] warm tier: the tool output was replaced by its structure. --- 
- [te_warm] seq1531(orig430) 4087->2940: [tokeneconomizer] warm tier: the tool output was replaced by its structure. --- 
- [te_warm] seq1533(orig493) 4629->3102: [tokeneconomizer] warm tier: the tool output was replaced by its structure. --- 
- [te_warm] seq1535(orig564) 5062->2937: [tokeneconomizer] warm tier: the tool output was replaced by its structure. --- 
- [te_warm] seq2183(orig626) 6000->2764: [tokeneconomizer] warm tier: the tool output was replaced by its structure. --- 

## Dedup pointer details

## Claim 5 cases
- [te_warm] --home-minami-Workspace-projects-dsh-workspace-dsh-plugins--/session-edeabe91-3607-45c6-af7b-8c6efe0944b8 seq2625 orig220

## Verdict
VERDICT: TENSION/WRONG for claims 1-5 [3]
- headline: TE warm=229 net=982680 inflating=0 cold=0 dedup=0(a=0/r=0) pruner=0 claim5=1