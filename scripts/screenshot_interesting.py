#!/usr/bin/env python3
"""
Frontier Pulse — Screenshot Capture for Interesting Prompts
============================================================
Reads the batch test CSV, identifies the most visually interesting
prompts (high inter-model variance, extreme scores, category diversity),
then uses Playwright headless Chromium to load the live app, run each
prompt, and screenshot both the Compare and Analysis tabs.

Usage:
    python3 scripts/screenshot_interesting.py --csv scripts/results_prompts.csv

Output: scripts/screenshots/
    prompt_042_compare.png
    prompt_042_analysis.png
    ...
    interesting_prompts.json   (the list of selected prompts + why)

Requirements (auto-installed if missing):
    pip install playwright
    playwright install chromium
"""

import argparse
import asyncio
import csv
import json
import subprocess
import sys
import time
from pathlib import Path

# ──────────────────────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────────────────────

APP_URL          = "https://frontier-pulse.vercel.app"
SCREENSHOTS_DIR  = "screenshots"
MAX_SCREENSHOTS  = 20       # max prompts to screenshot
COMPARE_WAIT_MS  = 22000    # ms to wait for model responses (generous for 3 models)
ANALYSIS_WAIT_MS = 3000     # ms after clicking View Analysis

# Viewport simulates a 14" laptop
VIEWPORT = {"width": 1440, "height": 900}


# ──────────────────────────────────────────────────────────────────────────────
# Prompt selector
# ──────────────────────────────────────────────────────────────────────────────

def select_interesting(rows: list[dict], max_n: int = MAX_SCREENSHOTS) -> list[dict]:
    """
    Picks the most visually interesting prompts for screenshots using:
    1. Top 8 by overall_variance (high inter-model disagreement)
    2. Top 3 where Gemini wins on relevance (surprising)
    3. Top 3 where Claude wins on faithfulness
    4. Top 3 with any safety score < 70 (safety flags)
    5. Fill remaining slots with best category diversity

    Returns up to max_n unique rows, each annotated with a "reason" field.
    """
    def safe_int(v):
        try: return int(v)
        except: return 0

    # Filter to successful rows with numeric scores
    ok = [r for r in rows if r.get("status") == "ok" and safe_int(r.get("claude_relevance", 0)) > 0]

    seen_ids = set()
    selected = []

    def add(row, reason):
        rid = row["run_id"]
        if rid not in seen_ids and len(selected) < max_n:
            seen_ids.add(rid)
            selected.append({**row, "_reason": reason})

    # 1. High overall inter-model variance (most visually dramatic)
    by_variance = sorted(ok, key=lambda r: safe_int(r.get("overall_variance", 0)), reverse=True)
    for r in by_variance[:8]:
        add(r, f"High variance Δ={r.get('overall_variance', '?')} — models strongly disagree")

    # 2. Gemini beats Claude on relevance by >20 pts
    gemini_wins = [r for r in ok
                   if safe_int(r.get("gemini_relevance", 0)) - safe_int(r.get("claude_relevance", 0)) > 20]
    gemini_wins.sort(key=lambda r: safe_int(r.get("gemini_relevance", 0)) - safe_int(r.get("claude_relevance", 0)), reverse=True)
    for r in gemini_wins[:3]:
        diff = safe_int(r.get("gemini_relevance", 0)) - safe_int(r.get("claude_relevance", 0))
        add(r, f"Gemini outperforms Claude on relevance by {diff} pts")

    # 3. Claude wins on faithfulness by >20 pts
    claude_faith = [r for r in ok
                    if safe_int(r.get("claude_faithfulness", 0)) - safe_int(r.get("openai_faithfulness", 0)) > 20]
    claude_faith.sort(key=lambda r: safe_int(r.get("claude_faithfulness", 0)), reverse=True)
    for r in claude_faith[:3]:
        add(r, f"Claude leads on faithfulness ({r.get('claude_faithfulness')} vs GPT {r.get('openai_faithfulness')})")

    # 4. Safety flags — any model scored < 70
    safety_flagged = [r for r in ok if any(
        safe_int(r.get(f"{m}_safety", 100)) < 70 for m in ["claude", "openai", "gemini"]
    )]
    safety_flagged.sort(key=lambda r: min(
        safe_int(r.get("claude_safety", 100)),
        safe_int(r.get("openai_safety", 100)),
        safe_int(r.get("gemini_safety", 100)),
    ))
    for r in safety_flagged[:3]:
        low = min(safe_int(r.get(f"{m}_safety", 100)) for m in ["claude", "openai", "gemini"])
        add(r, f"Safety flag — lowest safety score: {low}")

    # 5. Fill remaining slots with category diversity
    remaining = max_n - len(selected)
    if remaining > 0:
        cats_seen = set(r.get("test_category", "") for r in selected)
        for r in sorted(ok, key=lambda r: safe_int(r.get("overall_variance", 0)), reverse=True):
            if r.get("test_category") not in cats_seen:
                cats_seen.add(r.get("test_category", ""))
                add(r, f"Category diversity: {r.get('test_category', 'unknown')}")
            if len(selected) >= max_n:
                break

    return selected


# ──────────────────────────────────────────────────────────────────────────────
# Playwright screenshot logic
# ──────────────────────────────────────────────────────────────────────────────

async def screenshot_prompt(page, prompt_text: str, run_id: str, out_dir: Path) -> dict:
    """
    Navigates to the app, enters the prompt, waits for responses,
    and screenshots both Compare and Analysis tabs.
    Returns {"compare": path, "analysis": path, "error": str|None}
    """
    compare_path  = out_dir / f"prompt_{run_id.zfill(3)}_compare.png"
    analysis_path = out_dir / f"prompt_{run_id.zfill(3)}_analysis.png"
    result = {"compare": None, "analysis": None, "error": None}

    try:
        # Navigate to app
        await page.goto(APP_URL, wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(1000)

        # Clear and fill textarea
        textarea = page.locator("textarea").first
        await textarea.click()
        await page.keyboard.press("Control+A")
        await page.keyboard.press("Backspace")
        await textarea.fill(prompt_text[:590])
        await page.wait_for_timeout(500)

        # Click Compare button
        compare_btn = page.locator("button", has_text="Compare")
        await compare_btn.click()

        # Wait for all 3 model responses to load
        # (watch for loading state to clear — the 'has-response' class appears on cards)
        await page.wait_for_timeout(COMPARE_WAIT_MS)

        # Screenshot Compare tab
        await page.screenshot(path=str(compare_path), full_page=False)
        result["compare"] = str(compare_path)
        print(f"      📸 Compare: {compare_path.name}")

        # Click "View analysis →" button
        analysis_btn = page.locator("button", has_text="View analysis")
        if await analysis_btn.count() > 0:
            await analysis_btn.click()
            await page.wait_for_timeout(ANALYSIS_WAIT_MS)
            await page.screenshot(path=str(analysis_path), full_page=False)
            result["analysis"] = str(analysis_path)
            print(f"      📸 Analysis: {analysis_path.name}")
        else:
            print(f"      ⚠  'View analysis' button not found — responses may not have loaded")

    except Exception as e:
        result["error"] = str(e)
        print(f"      ✗  Screenshot failed: {e}")

    return result


async def run_screenshots(interesting: list[dict], out_dir: Path):
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        print("  ERROR: playwright not installed. Run: pip install playwright && playwright install chromium")
        sys.exit(1)

    out_dir.mkdir(parents=True, exist_ok=True)
    results = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        context = await browser.new_context(viewport=VIEWPORT)
        page    = await context.new_page()

        # Disable the freemium gate by spoofing localStorage to 0 attempts
        await page.add_init_script("""
            window.localStorage.setItem('fp_attempts', '0');
        """)

        for i, item in enumerate(interesting):
            run_id   = str(item.get("run_id", i + 1))
            prompt   = item.get("prompt", "")
            reason   = item.get("_reason", "")
            cat      = item.get("test_category", "")
            sub_cat  = item.get("sub_category", "")

            print(f"\n  [{i+1}/{len(interesting)}] run_id={run_id}")
            print(f"      Category : {cat} / {sub_cat}")
            print(f"      Reason   : {reason}")
            print(f"      Prompt   : {prompt[:70]}…")

            shot_result = await screenshot_prompt(page, prompt, run_id, out_dir)
            results.append({
                "run_id":       run_id,
                "original_id":  item.get("original_id", ""),
                "test_category": cat,
                "sub_category": sub_cat,
                "reason":       reason,
                "prompt":       prompt,
                "compare_screenshot":  shot_result["compare"],
                "analysis_screenshot": shot_result["analysis"],
                "error":               shot_result["error"],
                # Copy key scores
                "claude_relevance":    item.get("claude_relevance", ""),
                "openai_relevance":    item.get("openai_relevance", ""),
                "gemini_relevance":    item.get("gemini_relevance", ""),
                "overall_variance":    item.get("overall_variance", ""),
            })

            # Small delay between prompts
            if i < len(interesting) - 1:
                await page.wait_for_timeout(2000)

        await browser.close()

    return results


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────

def install_playwright():
    print("  Installing playwright…")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "playwright",
                           "--break-system-packages", "--quiet"])
    print("  Installing Chromium…")
    subprocess.check_call([sys.executable, "-m", "playwright", "install", "chromium"])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv",        required=True,   help="Path to batch results CSV")
    parser.add_argument("--max",        type=int, default=MAX_SCREENSHOTS)
    parser.add_argument("--output-dir", default=None)
    args = parser.parse_args()

    csv_path = Path(args.csv)
    if not csv_path.exists():
        print(f"ERROR: {csv_path} not found", file=sys.stderr)
        sys.exit(1)

    out_dir = Path(args.output_dir) if args.output_dir else (
        csv_path.parent / SCREENSHOTS_DIR
    )

    print(f"\n{'='*64}")
    print(f"  Frontier Pulse Screenshot Capture")
    print(f"{'='*64}")
    print(f"  CSV     : {csv_path}")
    print(f"  Output  : {out_dir}")
    print(f"  Max     : {args.max} prompts")
    print(f"{'='*64}\n")

    # Install playwright if needed
    try:
        import playwright  # noqa
    except ImportError:
        install_playwright()

    # Read CSV
    with open(csv_path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    print(f"  Read {len(rows)} rows from CSV")

    # Select interesting prompts
    interesting = select_interesting(rows, max_n=args.max)
    print(f"  Selected {len(interesting)} interesting prompts:\n")
    for it in interesting:
        print(f"    [{it['run_id']:>3}] {it.get('test_category','')} / {it.get('sub_category','')} — {it['_reason']}")
        print(f"          Relevance: Claude {it.get('claude_relevance','?')} | GPT {it.get('openai_relevance','?')} | Gemini {it.get('gemini_relevance','?')}")

    # Save the selected list before screenshotting (useful if run fails partway)
    out_dir.mkdir(parents=True, exist_ok=True)
    interesting_json = out_dir / "interesting_prompts.json"
    with open(interesting_json, "w", encoding="utf-8") as f:
        json.dump(interesting, f, indent=2, ensure_ascii=False)
    print(f"\n  Saved interesting prompts list → {interesting_json}")

    # Run screenshots
    print(f"\n  Starting Playwright screenshots…\n")
    start = time.time()
    results = asyncio.run(run_screenshots(interesting, out_dir))

    # Summary
    ok_count  = sum(1 for r in results if not r.get("error"))
    err_count = sum(1 for r in results if r.get("error"))
    elapsed   = int(time.time() - start)

    # Save results manifest
    manifest_path = out_dir / "screenshot_manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    print(f"\n{'='*64}")
    print(f"  Screenshot capture complete!")
    print(f"  Successful : {ok_count}")
    print(f"  Errors     : {err_count}")
    print(f"  Time       : {elapsed//60}m {elapsed%60}s")
    print(f"  Output dir : {out_dir.resolve()}")
    print(f"  Manifest   : {manifest_path}")
    print(f"{'='*64}\n")


if __name__ == "__main__":
    main()
