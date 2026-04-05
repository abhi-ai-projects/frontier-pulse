#!/usr/bin/env python3
"""
Frontier Pulse — Overnight Batch Test Runner
=============================================
Sends prompts through the deployed /api/compare endpoint and writes
all metrics + model responses to a CSV file.

Handles the Frontier Pulse eval prompt format:
  {
    "id": "NSTST001",
    "category": "Instruction Adherence",
    "sub_category": "Negative Constraints",
    "prompt_text": "...",
    "expected_behavior": "..."
  }

Also accepts simpler formats (plain strings, {prompt:}, {text:}, etc.)

Usage:
    python3 scripts/batch_test.py --prompts scripts/prompts.json

RESUMABLE: re-running skips rows already in the output CSV.
"""

import argparse
import csv
import json
import os
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path

# ──────────────────────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────────────────────

API_URL     = "https://frontier-pulse.vercel.app/api/compare"
DELAY_SEC   = 8          # seconds between requests (keeps us well under 600/hr)
MAX_RETRIES = 3          # retries per prompt on transient errors
RETRY_WAIT  = 30         # seconds to wait after a 429 or 5xx before retrying
TIMEOUT_SEC = 60         # per-request HTTP timeout

# Map task type → the systemContext the app uses
SYSTEM_CONTEXTS = {
    "write":   "You are a professional communication expert. Help the user craft whatever they need to communicate — this could be an email, message, announcement, pitch, memo, or any other format. Follow the user's lead on format and context. Do not default to email unless the user specifies it.",
    "analyze": "You are a senior strategy and analysis expert. Analyze whatever situation, market, document, or decision the user presents. Structure your thinking clearly and surface the insights that actually matter. Follow the user's lead on scope and depth.",
    "decide":  "You are a trusted advisor helping someone think through a decision. Lay out the real tradeoffs, surface what they might be missing, and help them reach a confident conclusion. Follow the user's lead on the decision they're facing — personal or professional.",
}

def infer_task(prompt_text: str) -> str:
    """Infer write / analyze / decide from the prompt text itself."""
    p = prompt_text.lower().strip()
    write_signals = ("write a", "write an", "draft a", "draft an", "compose a",
                     "craft a", "create a story", "create a poem", "write me")
    decide_signals = ("should i", "should we", "decide", "choice between",
                      "which is better", "recommend", "tradeoffs")
    if any(p.startswith(s) for s in write_signals) or any(s in p[:60] for s in write_signals):
        return "write"
    if any(s in p[:80] for s in decide_signals):
        return "decide"
    return "analyze"

# ──────────────────────────────────────────────────────────────────────────────
# CSV schema
# ──────────────────────────────────────────────────────────────────────────────

CSV_COLUMNS = [
    # Identity
    "run_id", "original_id", "timestamp",
    # Test metadata (from the eval JSON)
    "test_category", "sub_category", "expected_behavior",
    # Prompt
    "task_context", "prompt",

    # Timing (ms)
    "claude_time_ms", "openai_time_ms", "gemini_time_ms",

    # Token usage
    "claude_input_tokens",  "claude_output_tokens",
    "openai_input_tokens",  "openai_output_tokens",
    "gemini_input_tokens",  "gemini_output_tokens",

    # Eval scores (0–100) — judged by Claude Haiku
    "claude_relevance",    "openai_relevance",    "gemini_relevance",
    "claude_faithfulness", "openai_faithfulness", "gemini_faithfulness",
    "claude_safety",       "openai_safety",       "gemini_safety",

    # Derived score columns (computed locally for analysis)
    "relevance_variance",      # max − min across 3 models
    "faithfulness_variance",
    "safety_variance",
    "overall_variance",        # mean of the three variances

    # Best model per metric
    "best_relevance_model",
    "best_faithfulness_model",
    "best_safety_model",

    # Qualitative
    "claude_approach", "openai_approach", "gemini_approach",
    "best_for",
    "claude_insight", "openai_insight", "gemini_insight",

    # Full response text
    "claude_response", "openai_response", "gemini_response",

    # Run status
    "status", "error_detail",
]


# ──────────────────────────────────────────────────────────────────────────────
# Loaders
# ──────────────────────────────────────────────────────────────────────────────

def load_prompts(path: str) -> list[dict]:
    """
    Normalises any reasonable JSON format into:
      {
        "original_id": str,
        "prompt": str,
        "task": "write" | "analyze" | "decide",
        "test_category": str,
        "sub_category": str,
        "expected_behavior": str,
      }
    """
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)

    items = []
    for i, entry in enumerate(raw):
        if isinstance(entry, str):
            text = entry.strip()
            items.append({
                "original_id": str(i + 1),
                "prompt": text,
                "task": infer_task(text),
                "test_category": "",
                "sub_category": "",
                "expected_behavior": "",
            })
            continue

        if not isinstance(entry, dict):
            print(f"  ⚠  Skipping unknown entry type at index {i}: {type(entry)}")
            continue

        # ── Extract prompt text ──────────────────────────────────
        # Primary field is "prompt_text" (Frontier Pulse eval format)
        text = (
            entry.get("prompt_text")
            or entry.get("prompt")
            or entry.get("text")
            or entry.get("content")
            or entry.get("question")
            or ""
        ).strip()

        if not text:
            print(f"  ⚠  Skipping entry {i} — no prompt text found: {entry}")
            continue

        # ── Extract metadata ─────────────────────────────────────
        original_id      = str(entry.get("id", i + 1))
        test_category    = entry.get("category", "")
        sub_category     = entry.get("sub_category", entry.get("subcategory", ""))
        expected_behavior= entry.get("expected_behavior", entry.get("expected", ""))

        # ── Determine task context ───────────────────────────────
        # If entry has an explicit write/analyze/decide task field, use it.
        # Otherwise infer from the prompt text.
        task_hint = (
            entry.get("task")
            or entry.get("task_type")
            or ""
        ).lower()
        if task_hint in ("write", "writing"):
            task = "write"
        elif task_hint in ("decide", "decision"):
            task = "decide"
        elif task_hint in ("analyze", "analysis"):
            task = "analyze"
        else:
            task = infer_task(text)

        items.append({
            "original_id":       original_id,
            "prompt":            text,
            "task":              task,
            "test_category":     test_category,
            "sub_category":      sub_category,
            "expected_behavior": expected_behavior,
        })

    return items


def already_done(csv_path: Path) -> set[int]:
    """Returns run_ids already written to the CSV (for resume support)."""
    done = set()
    if not csv_path.exists():
        return done
    with open(csv_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            try:
                done.add(int(row["run_id"]))
            except (KeyError, ValueError):
                pass
    return done


# ──────────────────────────────────────────────────────────────────────────────
# API call
# ──────────────────────────────────────────────────────────────────────────────

def call_api(prompt: str, task: str) -> dict:
    system_context = SYSTEM_CONTEXTS.get(task, SYSTEM_CONTEXTS["analyze"])
    safe_prompt    = prompt[:590]  # API enforces 600-char limit
    payload        = json.dumps({"prompt": safe_prompt, "systemContext": system_context}).encode()

    headers = {
        "Content-Type":  "application/json",
        "User-Agent":    "FrontierPulse-BatchRunner/1.0",
        # Origin spoofs a browser request so the server-side Origin check passes.
        # The X-Batch-Key header bypasses the rate limiter entirely.
        "Origin":        "https://frontierpulse.org",
        "X-Batch-Key":   os.environ.get("BATCH_SECRET", ""),
    }
    req = urllib.request.Request(
        API_URL,
        data    = payload,
        headers = headers,
        method  = "POST",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT_SEC) as resp:
        return json.loads(resp.read().decode())


# ──────────────────────────────────────────────────────────────────────────────
# Row builders
# ──────────────────────────────────────────────────────────────────────────────

def _best_model(models: list[str], scores: list[int]) -> str:
    if not any(scores):
        return ""
    best_idx = scores.index(max(scores))
    return models[best_idx]

def extract_row(run_id: int, item: dict, data: dict, ts: str) -> dict:
    ins = data.get("insights") or {}
    tim = data.get("timing")   or {}
    use = data.get("usage")    or {}

    def t(m):  return tim.get(m, 0)
    def ui(m): return (use.get(m) or {}).get("input", 0)
    def uo(m): return (use.get(m) or {}).get("output", 0)

    cr = ins.get("claudeRelevance",    0)
    or_= ins.get("openaiRelevance",    0)
    gr = ins.get("geminiRelevance",    0)
    cf = ins.get("claudeFaithfulness", 0)
    of = ins.get("openaiFaithfulness", 0)
    gf = ins.get("geminiFaithfulness", 0)
    cs = ins.get("claudeSafety",       0)
    os_= ins.get("openaiSafety",       0)
    gs = ins.get("geminiSafety",       0)

    rv = max(cr, or_, gr) - min(cr, or_, gr)
    fv = max(cf, of, gf) - min(cf, of, gf)
    sv = max(cs, os_, gs) - min(cs, os_, gs)

    models = ["claude", "openai", "gemini"]

    return {
        "run_id":            run_id,
        "original_id":       item["original_id"],
        "timestamp":         ts,
        "test_category":     item["test_category"],
        "sub_category":      item["sub_category"],
        "expected_behavior": item["expected_behavior"],
        "task_context":      item["task"],
        "prompt":            item["prompt"],

        "claude_time_ms":    t("claude"),
        "openai_time_ms":    t("openai"),
        "gemini_time_ms":    t("gemini"),

        "claude_input_tokens":  ui("claude"),
        "claude_output_tokens": uo("claude"),
        "openai_input_tokens":  ui("openai"),
        "openai_output_tokens": uo("openai"),
        "gemini_input_tokens":  ui("gemini"),
        "gemini_output_tokens": uo("gemini"),

        "claude_relevance":    cr,
        "openai_relevance":    or_,
        "gemini_relevance":    gr,
        "claude_faithfulness": cf,
        "openai_faithfulness": of,
        "gemini_faithfulness": gf,
        "claude_safety":       cs,
        "openai_safety":       os_,
        "gemini_safety":       gs,

        "relevance_variance":    rv,
        "faithfulness_variance": fv,
        "safety_variance":       sv,
        "overall_variance":      round((rv + fv + sv) / 3, 1),

        "best_relevance_model":    _best_model(models, [cr, or_, gr]),
        "best_faithfulness_model": _best_model(models, [cf, of, gf]),
        "best_safety_model":       _best_model(models, [cs, os_, gs]),

        "claude_approach": ins.get("claudeApproach", ""),
        "openai_approach": ins.get("openaiApproach", ""),
        "gemini_approach": ins.get("geminiApproach", ""),
        "best_for":        ins.get("bestFor", ""),
        "claude_insight":  ins.get("claude", ""),
        "openai_insight":  ins.get("openai", ""),
        "gemini_insight":  ins.get("gemini", ""),

        "claude_response":  data.get("claude",  ""),
        "openai_response":  data.get("openai",  ""),
        "gemini_response":  data.get("gemini",  ""),

        "status":       "ok",
        "error_detail": "",
    }


def error_row(run_id: int, item: dict, ts: str, err: str) -> dict:
    row = {col: "" for col in CSV_COLUMNS}
    row.update({
        "run_id": run_id, "original_id": item["original_id"],
        "timestamp": ts, "test_category": item["test_category"],
        "sub_category": item["sub_category"], "prompt": item["prompt"],
        "status": "error", "error_detail": err,
    })
    return row


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompts", required=True)
    parser.add_argument("--output",  default=None)
    args = parser.parse_args()

    prompts_path = Path(args.prompts)
    if not prompts_path.exists():
        print(f"ERROR: {prompts_path} not found", file=sys.stderr)
        sys.exit(1)

    csv_path = Path(args.output) if args.output else (
        prompts_path.parent / f"results_{prompts_path.stem}.csv"
    )

    print(f"\n{'='*64}")
    print(f"  Frontier Pulse Batch Test Runner")
    print(f"{'='*64}")
    print(f"  Prompts : {prompts_path}")
    print(f"  Output  : {csv_path}")
    print(f"  API     : {API_URL}")
    print(f"  Delay   : {DELAY_SEC}s between requests")
    print(f"{'='*64}\n")

    prompts  = load_prompts(str(prompts_path))
    total    = len(prompts)
    done_ids = already_done(csv_path)

    # Print category breakdown
    cats = {}
    for p in prompts:
        cats[p["test_category"]] = cats.get(p["test_category"], 0) + 1
    print(f"  Loaded {total} prompts across {len(cats)} categories:")
    for cat, n in sorted(cats.items(), key=lambda x: -x[1]):
        print(f"    {cat or '(none)':40s}  {n}")
    if done_ids:
        print(f"\n  Resuming — {len(done_ids)} already complete, skipping them")
    print()

    is_fresh = not csv_path.exists() or len(done_ids) == 0
    csv_file = open(csv_path, "a" if not is_fresh else "w", newline="", encoding="utf-8")
    writer   = csv.DictWriter(csv_file, fieldnames=CSV_COLUMNS)
    if is_fresh:
        writer.writeheader()
        csv_file.flush()

    done = len(done_ids)
    errors = 0
    start_ts = time.time()

    try:
        for i, item in enumerate(prompts):
            run_id = i + 1
            if run_id in done_ids:
                continue

            ts = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
            cat_label = f"{item['test_category']}" + (f" / {item['sub_category']}" if item['sub_category'] else "")
            print(f"  [{run_id:>3}/{total}] [{item['task']:>7}] [{cat_label}]")
            print(f"           {item['prompt'][:80]}{'…' if len(item['prompt']) > 80 else ''}")

            success = False
            for attempt in range(1, MAX_RETRIES + 1):
                try:
                    data = call_api(item["prompt"], item["task"])
                    row  = extract_row(run_id, item, data, ts)
                    writer.writerow(row)
                    csv_file.flush()
                    done += 1
                    success = True

                    ins = data.get("insights") or {}
                    cr  = ins.get("claudeRelevance",  "?")
                    or_ = ins.get("openaiRelevance",  "?")
                    gr  = ins.get("geminiRelevance",  "?")
                    ct  = data.get("timing", {}).get("claude", 0)
                    ot  = data.get("timing", {}).get("openai", 0)
                    gt  = data.get("timing", {}).get("gemini", 0)
                    rv  = row["relevance_variance"]
                    flag = "  ★ HIGH VARIANCE" if isinstance(rv, (int, float)) and rv > 25 else ""
                    print(f"           ✓  Relevance  Claude:{cr:>3} | GPT:{or_:>3} | Gemini:{gr:>3}  Δ={rv}{flag}")
                    print(f"              Timing     Claude:{ct/1000:.1f}s | GPT:{ot/1000:.1f}s | Gemini:{gt/1000:.1f}s")
                    break

                except urllib.error.HTTPError as e:
                    if e.code in (429, 503):
                        wait = RETRY_WAIT * attempt
                        print(f"           ⚠  HTTP {e.code} — waiting {wait}s (attempt {attempt}/{MAX_RETRIES})")
                        time.sleep(wait)
                    else:
                        print(f"           ✗  HTTP {e.code}: {e.reason}")
                        break
                except Exception as ex:
                    print(f"           ✗  Error (attempt {attempt}/{MAX_RETRIES}): {ex}")
                    if attempt < MAX_RETRIES:
                        time.sleep(RETRY_WAIT)

            if not success:
                writer.writerow(error_row(run_id, item, ts, f"Failed after {MAX_RETRIES} attempts"))
                csv_file.flush()
                errors += 1

            # Progress + ETA
            elapsed   = time.time() - start_ts
            completed = done - len(done_ids)
            remaining = total - done
            avg       = elapsed / max(completed, 1)
            eta_m, eta_s = divmod(int(remaining * avg), 60)
            print(f"           Progress: {done}/{total} ({done/total*100:.1f}%)  ETA: ~{eta_m}m {eta_s}s\n")

            if run_id < total:
                time.sleep(DELAY_SEC)

    finally:
        csv_file.close()

    elapsed_total = time.time() - start_ts
    m, s = divmod(int(elapsed_total), 60)
    print(f"\n{'='*64}")
    print(f"  Run complete!")
    print(f"  Prompts   : {total}")
    print(f"  Successful: {done - errors}")
    print(f"  Errors    : {errors}")
    print(f"  Time      : {m}m {s}s")
    print(f"  Output    : {csv_path.resolve()}")
    print(f"{'='*64}\n")

    # Write a flag file so the screenshot script knows we're done
    flag_path = csv_path.parent / f".batch_done_{csv_path.stem}"
    flag_path.write_text(str(csv_path.resolve()))
    print(f"  Flag file written: {flag_path}")

    if errors:
        print(f"\n  ⚠  {errors} failures — re-run to retry them.")


if __name__ == "__main__":
    main()
