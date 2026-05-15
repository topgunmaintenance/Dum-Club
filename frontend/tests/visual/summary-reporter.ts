/**
 * Plain-text summary reporter. Writes test-results/summary.txt
 * with one line per spec, picked up by the GitHub Action
 * comment-poster step.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
  Reporter,
  TestCase,
  TestResult,
  FullResult,
} from "@playwright/test/reporter";

interface RowResult {
  title: string;
  status: TestResult["status"];
  durationMs: number;
}

class SummaryReporter implements Reporter {
  private rows: RowResult[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    this.rows.push({
      title: test.titlePath().slice(1).join(" › "),
      status: result.status,
      durationMs: result.duration,
    });
  }

  onEnd(result: FullResult): void {
    const outDir = "test-results";
    try {
      fs.mkdirSync(outDir, { recursive: true });
    } catch {
      // ignore
    }
    const totals = this.rows.reduce(
      (acc, r) => {
        acc[r.status] = (acc[r.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    const lines: string[] = [];
    lines.push(`Status: ${result.status}`);
    lines.push(
      `Total: ${this.rows.length}  ` +
        Object.entries(totals)
          .map(([k, v]) => `${k}=${v}`)
          .join("  "),
    );
    lines.push("");
    for (const r of this.rows) {
      const mark =
        r.status === "passed"
          ? "✅"
          : r.status === "failed"
            ? "❌"
            : r.status === "timedOut"
              ? "⏱"
              : "⚪";
      lines.push(`${mark} ${r.title}  (${r.durationMs}ms)`);
    }
    fs.writeFileSync(path.join(outDir, "summary.txt"), lines.join("\n"));
  }
}

export default SummaryReporter;
