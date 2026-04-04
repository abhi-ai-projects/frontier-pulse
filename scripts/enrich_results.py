#!/usr/bin/env python3
"""
enrich_results.py — Post-run CSV enrichment for Frontier Pulse batch test
Joins AUDITED_STRESS_TESTS.json audit scores (complexity, deviousness, critique)
into the batch results CSV, then generates a summary analysis.

Usage:
    python3 enrich_results.py --csv results_prompts.csv --audit AUDITED_STRESS_TESTS.json

Output:
    results_prompts_enriched.csv   — original CSV + 3 audit columns
    enrichment_summary.txt         — key insights from the enriched data
"""

import csv
import json
import argparse
import os
from collections import defaultdict

def load_audit(audit_path):
    with open(audit_path) as f:
        data = json.load(f)
    # Index by id (normalised to string)
    return {str(d["id"]): d["audit"] for d in data}

def tier(complexity, deviousness):
    """Classify a prompt into a difficulty tier."""
    if complexity >= 7 and deviousness >= 7:
        return "GOLD — high complexity + high deviousness"
    elif deviousness >= 8:
        return "TRAP — low complexity, high deviousness"
    elif complexity >= 7:
        return "HARD — high complexity, lower deviousness"
    else:
        return "BASELINE — lower difficulty"

def enrich(csv_path, audit_path, output_path):
    audit = load_audit(audit_path)

    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        original_fields = reader.fieldnames

    enriched = []
    matched = 0
    unmatched = []

    for row in rows:
        original_id = row.get("original_id", "").strip()
        audit_entry = audit.get(original_id)

        if audit_entry:
            row["audit_complexity"]   = audit_entry.get("complexity", "")
            row["audit_deviousness"]  = audit_entry.get("deviousness", "")
            row["audit_tier"]         = tier(
                int(audit_entry.get("complexity", 0)),
                int(audit_entry.get("deviousness", 0))
            )
            row["audit_critique"]     = audit_entry.get("critique", "")
            matched += 1
        else:
            row["audit_complexity"]   = ""
            row["audit_deviousness"]  = ""
            row["audit_tier"]         = "UNAUDITED"
            row["audit_critique"]     = ""
            unmatched.append(original_id)

        enriched.append(row)

    new_fields = original_fields + ["audit_complexity", "audit_deviousness", "audit_tier", "audit_critique"]

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=new_fields)
        writer.writeheader()
        writer.writerows(enriched)

    print(f"✓ Enriched CSV written to: {output_path}")
    print(f"  Matched:   {matched}/{len(rows)} rows got audit scores")
    if unmatched:
        print(f"  Unmatched: {len(unmatched)} rows (IDs: {unmatched[:5]}{'...' if len(unmatched)>5 else ''})")
    print()

    return enriched

def summarise(enriched, output_path):
    # Only rows with audit data and status=ok
    valid = [r for r in enriched if r.get("audit_complexity") and r.get("status","").lower()=="ok"]
    if not valid:
        print("No valid rows with audit data to summarise.")
        return

    lines = []
    lines.append("=" * 70)
    lines.append("FRONTIER PULSE BATCH TEST — ENRICHMENT SUMMARY")
    lines.append("=" * 70)
    lines.append(f"\nTotal enriched rows with audit data: {len(valid)}")
    lines.append("")

    # ── Tier breakdown ──────────────────────────────────────────────
    tier_groups = defaultdict(list)
    for r in valid:
        tier_groups[r["audit_tier"]].append(r)

    lines.append("── PERFORMANCE BY DIFFICULTY TIER ─────────────────────────────")
    for t in ["GOLD — high complexity + high deviousness",
              "TRAP — low complexity, high deviousness",
              "HARD — high complexity, lower deviousness",
              "BASELINE — lower difficulty"]:
        rows_t = tier_groups.get(t, [])
        if not rows_t:
            continue
        def avg(key):
            vals = [int(r[key]) for r in rows_t if r.get(key,"").isdigit()]
            return sum(vals)/len(vals) if vals else 0
        lines.append(f"\n  {t} ({len(rows_t)} prompts)")
        lines.append(f"    Claude  relevance={avg('claude_relevance'):.1f}  faithfulness={avg('claude_faithfulness'):.1f}  safety={avg('claude_safety'):.1f}")
        lines.append(f"    GPT     relevance={avg('openai_relevance'):.1f}  faithfulness={avg('openai_faithfulness'):.1f}  safety={avg('openai_safety'):.1f}")
        lines.append(f"    Gemini  relevance={avg('gemini_relevance'):.1f}  faithfulness={avg('gemini_faithfulness'):.1f}  safety={avg('gemini_safety'):.1f}")

    # ── High-variance gold tier ─────────────────────────────────────
    lines.append("\n── TOP 10 HIGH-VARIANCE GOLD-TIER PROMPTS ─────────────────────")
    gold = [r for r in valid if r["audit_tier"].startswith("GOLD") and r.get("overall_variance","")]
    gold_sorted = sorted(gold, key=lambda r: float(r.get("overall_variance",0) or 0), reverse=True)
    for r in gold_sorted[:10]:
        prompt_short = r.get("prompt","")[:80].replace("\n"," ")
        lines.append(f"\n  [{r.get('original_id',r.get('run_id','?'))}] variance={r.get('overall_variance','?')}")
        lines.append(f"  complexity={r.get('audit_complexity')}  deviousness={r.get('audit_deviousness')}")
        lines.append(f"  Prompt: {prompt_short}...")
        lines.append(f"  Best: relevance={r.get('best_relevance_model','?')}  faithfulness={r.get('best_faithfulness_model','?')}")

    # ── Category × deviousness ──────────────────────────────────────
    lines.append("\n── MODEL WIN RATES BY CATEGORY ─────────────────────────────────")
    cat_groups = defaultdict(list)
    for r in valid:
        cat_groups[r.get("test_category","unknown")].append(r)
    for cat, rows_c in sorted(cat_groups.items()):
        wins = defaultdict(int)
        for r in rows_c:
            winner = r.get("best_relevance_model","")
            if winner:
                wins[winner] += 1
        total = len(rows_c)
        win_str = "  ".join(f"{m}={wins[m]}/{total} ({100*wins[m]//total}%)" for m in ["claude","openai","gemini"])
        lines.append(f"\n  {cat}")
        lines.append(f"    {win_str}")

    # ── Deviousness degradation ────────────────────────────────────
    lines.append("\n── RELEVANCE SCORE vs DEVIOUSNESS LEVEL ────────────────────────")
    dev_groups = defaultdict(list)
    for r in valid:
        d = r.get("audit_deviousness","")
        if d:
            dev_groups[int(d)].append(r)
    lines.append(f"  {'Dev':>4}  {'N':>4}  {'Claude':>8}  {'GPT':>8}  {'Gemini':>8}")
    for dev_level in sorted(dev_groups.keys()):
        rows_d = dev_groups[dev_level]
        def avg_score(key):
            vals = [int(r[key]) for r in rows_d if r.get(key,"").isdigit()]
            return f"{sum(vals)/len(vals):.1f}" if vals else "  n/a"
        lines.append(f"  {dev_level:>4}  {len(rows_d):>4}  {avg_score('claude_relevance'):>8}  {avg_score('openai_relevance'):>8}  {avg_score('gemini_relevance'):>8}")

    summary_text = "\n".join(lines)
    with open(output_path, "w") as f:
        f.write(summary_text)
    print(summary_text)
    print(f"\n✓ Summary written to: {output_path}")

def main():
    parser = argparse.ArgumentParser(description="Enrich Frontier Pulse batch CSV with audit scores")
    parser.add_argument("--csv",   required=True, help="Path to results_prompts.csv")
    parser.add_argument("--audit", required=True, help="Path to AUDITED_STRESS_TESTS.json")
    parser.add_argument("--out",   default=None,  help="Output CSV path (default: <input>_enriched.csv)")
    args = parser.parse_args()

    if not os.path.exists(args.csv):
        print(f"ERROR: CSV not found: {args.csv}"); return
    if not os.path.exists(args.audit):
        print(f"ERROR: Audit file not found: {args.audit}"); return

    out_csv = args.out or args.csv.replace(".csv", "_enriched.csv")
    summary_path = out_csv.replace(".csv", "_summary.txt")

    enriched = enrich(args.csv, args.audit, out_csv)
    summarise(enriched, summary_path)

if __name__ == "__main__":
    main()
