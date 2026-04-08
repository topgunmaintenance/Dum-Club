#!/usr/bin/env python3
"""Seed / verify demo data for Topgun AI.

Reads the JSON files in sample_data/ and prints a summary. This script is
intentionally dependency-free so it can run without a venv.

Usage:
    python scripts/seed_demo_data.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SAMPLE_DIR = ROOT / "sample_data"


def load(name: str) -> object:
    path = SAMPLE_DIR / name
    if not path.exists():
        print(f"[seed] MISSING: {path}", file=sys.stderr)
        sys.exit(1)
    return json.loads(path.read_text())


def main() -> int:
    documents = load("documents.json")
    queries = load("queries.json")
    insights = load("insights.json")

    print("Topgun AI — demo data summary")
    print("-----------------------------")
    print(f"  documents: {len(documents)}")
    print(f"  queries:   {len(queries)}")
    print(f"  clusters:  {len(insights['recurring_clusters'])}")
    print(f"  hotspots:  {len(insights['ata_hotspots'])}")
    print(f"  widgets:   {len(insights['fleet_widgets'])}")
    print()
    print("Ready. The backend will load these on startup when TOPGUN_DEMO_MODE=true.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
