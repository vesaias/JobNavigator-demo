"""Split the snapshotted featured postings into batches of 5 for the content writers.

    py tools/make_batches.py            (run from the repo root)
Writes work/batch_N.json: [{id, company, title, location, salary, url, description, targets}]
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# Fit targets chosen for a realistic spread: {company prefix: (best resume key, best score, other score)}
TARGETS = {
    "WHOOP": ("growth", 90, 72), "Discord": ("growth", 88, 79), "Twitch": ("growth", 81, 66), "Perplexity": ("growth", 84, 70),
    "OnePay": ("growth", 78, 74), "Otter": ("growth", 76, 64), "Kikoff": ("growth", 74, 63), "Earnin": ("growth", 71, 67),
    "Mudflap": ("growth", 69, 61), "Plaid": ("platform", 73, 70), "MrBeast": ("growth", 67, 58),
    "Luma": ("growth", 58, 52), "Robinhood": ("platform", 55, 49), "Glean": ("platform", 49, 41), "Ramp": ("platform", 47, 40),
}
# the four strong matches get a tailored resume and cover letter in the shipped data already
PRECREATED = ["WHOOP", "Discord", "Twitch", "Perplexity"]


def target(company):
    return next((v for k, v in TARGETS.items() if company.startswith(k)), None)


def main():
    exp = json.loads((ROOT / "work/export.json").read_text(encoding="utf-8"))
    ok = json.loads((ROOT / "data/snapshots/index.json").read_text(encoding="utf-8"))["ok"]
    by_id = {j["id"]: j for j in exp["featured_pool"]}
    jobs = []
    for i in ok:
        j = by_id[i]
        t = target(j["company"])
        jobs.append({
            "id": j["id"], "company": j["company"], "title": j["title"], "location": j["location"],
            "salary": [j["salary_min"], j["salary_max"]], "url": j["url"],
            "description": (j["description"] or "")[:5500],
            "targets": {"best_resume": t[0], "best_score": t[1], "other_score": t[2]},
            "precreated_tailored_and_letter": any(j["company"].startswith(p) for p in PRECREATED),
        })
    (ROOT / "work").mkdir(exist_ok=True)
    for n in range(0, len(jobs), 5):
        (ROOT / f"work/batch_{n // 5 + 1}.json").write_text(json.dumps(jobs[n:n + 5], indent=1, ensure_ascii=False), encoding="utf-8")
    print(len(jobs), "jobs,", (len(jobs) + 4) // 5, "batches")
    for j in jobs:
        print(j["id"], j["company"], j["targets"])


if __name__ == "__main__":
    main()
