"""Combine the exported postings with the hand-written sample content into data/data.json.

    py -3.10 tools/assemble.py <path to a JobNavigator checkout>        (run from the demo repo root, cwd = checkout for `import backend.seed`)

Inputs : work/export.json, data/snapshots/index.json, content/{resumes,persona,applications}.json, content/featured_*.json
Output : data/data.json   (all dates relative to reference_date; the demo shifts them to today on load)
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
import sys
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JN = Path(sys.argv[1] if len(sys.argv) > 1 else os.environ.get("JN_CHECKOUT", "")).resolve()   # path to a JobNavigator checkout (argument or $JN_CHECKOUT)
sys.path.insert(0, str(JN))

REF = date.today()
DEMO_VERSION = 1
OWNER_ID = "00000000-0000-4000-8000-0000000000a1"
MEMBER_ID = "00000000-0000-4000-8000-0000000000a2"


def ts(days_ago: float, hour: int = 14, minute: int = 0) -> str:
    d = datetime(REF.year, REF.month, REF.day, hour, minute, tzinfo=timezone.utc) - timedelta(days=days_ago)
    return d.strftime("%Y-%m-%dT%H:%M:%SZ")


def load(rel):
    return json.loads((ROOT / rel).read_text(encoding="utf-8"))


def stable(n: str, mod: int) -> int:
    return int(hashlib.sha256(n.encode()).hexdigest(), 16) % mod


# ── résumés, persona ─────────────────────────────────────────────────────────
RES = {r["key"]: r for r in load("content/resumes.json")}
RES_ID = {"growth": "res-growth", "platform": "res-platform"}
RES_NAME = {k: r["name"] for k, r in RES.items()}


def base_resumes():
    out = []
    for i, (k, r) in enumerate(RES.items()):
        out.append({"id": RES_ID[k], "name": r["name"], "is_base": True, "parent_id": None, "job_id": None,
                    "template": r["template"], "page_format": "letter", "created_at": ts(72 - i), "updated_at": ts(11 + i * 3),
                    "json_data": copy.deepcopy(r["json_data"])})
    return out


def persona():
    p = load("content/persona.json")
    pool = copy.deepcopy(RES["growth"]["json_data"])
    seen = {b for e in pool["experience"] for b in e["bullets"]}
    for e, other in zip(pool["experience"], RES["platform"]["json_data"]["experience"]):
        e["bullets"] += [b for b in other["bullets"] if b not in seen]
    p["resume_content"] = pool
    return {"id": 1, **p, "created_at": ts(72), "updated_at": ts(9)}


def tailored_json(base_key, t):
    d = copy.deepcopy(RES[base_key]["json_data"])
    d["header"]["title"] = t["title"]
    d["summary"] = t["summary"]
    assert len(t["bullets"]) == len(d["experience"])
    for exp, bullets in zip(d["experience"], t["bullets"]):
        assert len(bullets) == len(exp["bullets"]), (t["name"], exp["company"])
        exp["bullets"] = bullets
    d["skills"] = t["skills"]
    return d


def letter_json(base_key, c):
    h = RES[base_key]["json_data"]["header"]
    return {"header": {"name": h["name"], "contact_items": copy.deepcopy(h["contact_items"])},
            "recipient": c["recipient"], "greeting": c["greeting"], "body_paragraphs": c["body_paragraphs"],
            "closing": c["closing"], "signature": c["signature"]}


# ── jobs ─────────────────────────────────────────────────────────────────────
def main():
    exp = load("work/export.json")
    ix = load("data/snapshots/index.json")
    ok = ix["ok"]
    expired = set(ix.get("expired", []))   # featured, but the posting had closed before capture: no snapshot
    pool = {j["id"]: j for j in exp["featured_pool"]}
    featured = [pool[i] for i in ok]
    content = {}
    for p in sorted((ROOT / "content").glob("featured_*.json")):
        for item in json.loads(p.read_text(encoding="utf-8")):
            content[item["job_id"]] = item
    apps_rows = load("content/applications.json")

    skip_co = ("Hex Technologies", "JPMorgan", "Crossing", "hackajob", "Citi", "Randstad", "Gametime")   # duplicates or off-level titles
    app_prefix = [a["company"] for a in apps_rows]
    used_ids = set(ok)

    def find_app_job(prefix):
        for j in featured:
            if j["company"].startswith(prefix):
                return j
        for j in exp["apps"]:
            if j["company"].startswith(prefix) and j["id"] not in used_ids:
                return j
        raise KeyError(prefix)

    app_jobs = {}
    for a in apps_rows:
        j = find_app_job(a["company"])
        app_jobs[a["company"]] = j
        used_ids.add(j["id"])
    extras = [j for j in exp["apps"] if j["id"] not in used_ids and not j["company"].startswith(skip_co)
              ][:20]

    srch = {"linkedin_extension": "search-ext-li", "extension": "search-ext", "jobright": "search-jobright",
            "levels_fyi": "search-levels", "jobspy_linkedin": "search-kw", "jobspy_indeed": "search-kw", "direct": None}

    jobs, prepared = [], {}
    resumes = base_resumes()
    cover_letters = []
    jobs_by_id = {}

    def finish_job(j, days_ago, status, scores=None, reports=None, best_key=None):
        j = copy.deepcopy(j)
        j.pop("_featured", None)
        j["discovered_at"] = ts(days_ago, 9 + stable(j["id"], 8), stable(j["id"] + "m", 60))
        j["page_cached_at"] = j["discovered_at"]
        j["status"] = status
        j["seen"] = status != "new" or stable(j["id"], 3) == 0
        j["saved"] = status in ("saved", "applied")
        j["search_id"] = srch.get(j["source"])
        if scores:
            j["cv_scores"] = {RES_NAME[k]: v for k, v in scores.items()}
            best = max(scores, key=scores.get)
            j["best_cv"] = RES_NAME[best]
            j["best_score"] = scores[best]
            j["best_cv_score"] = scores[best]
        if reports:
            j["scoring_report"] = {RES_NAME[k]: v for k, v in reports.items()}
        jobs.append(j)
        jobs_by_id[j["id"]] = j
        return j

    # featured: prepared results
    feat_days = {"Anthropic": 3, "Twitch": 5, "Discord": 8, "Luma": 2, "WHOOP": 11, "MrBeast": 1, "Otter": 4, "OnePay": 6,
                 "Robinhood": 9, "Kikoff": 2, "Earnin": 7, "Mudflap": 10, "Plaid": 3, "Glean": 12, "Ramp": 5}
    feat_status = {"Ramp": "skip", "Glean": "skip",
                   "Twitch": "applied", "WHOOP": "applied", "Discord": "applied"}
    pre = ("Anthropic", "Robinhood", "Plaid", "WHOOP")   # copies with a cover letter already made
    # Two more copies tailored straight from the Persona (no base parent), so every group in
    # Résumés has some (Robinhood and Plaid above are the PM – Platform ones).
    extra_copies = {"Otter": "persona", "Kikoff": "persona"}
    feat_company = {}
    for j in featured:
        key = next(k for k in feat_days if j["company"].startswith(k))
        feat_company[j["id"]] = key
        c = content[j["id"]]
        scores = {k: v["score"] for k, v in c["scores"].items()}
        reports = {k: v["report"] for k, v in c["scores"].items()}
        t = c["tailored"]
        tj = tailored_json(t["base"], t)
        cl = c["cover_letter"]
        prepared[j["id"]] = {
            "scores": {RES_NAME[k]: {"score": v["score"], "report": v["report"]} for k, v in c["scores"].items()},
            "tailored": {"name": t["name"], "base_id": RES_ID[t["base"]], "json_data": tj, "score": t["score"]},
            "cover_letter": {"name": cl["name"], "resume_id": RES_ID[cl["resume"]], "template": "inter", "voice": "professional",
                             "length": "standard", "json_data": letter_json(cl["resume"], cl)},
            "autofill": c["autofill"],
        }
        if j["id"] in expired:
            prepared[j["id"]]["snapshot"] = False
        job_scores = dict(scores)
        row = finish_job(j, feat_days[key], feat_status.get(key, "new"), scores, reports)
        if key in pre or key in extra_copies:
            short = key.lower()
            rid = f"res-tailored-{short}"
            parent = None if extra_copies.get(key) == "persona" else RES_ID[t["base"]]
            resumes.append({"id": rid, "name": t["name"], "is_base": False, "parent_id": parent, "job_id": j["id"],
                            "template": "inter", "page_format": "letter", "created_at": row["discovered_at"], "updated_at": row["discovered_at"],
                            "json_data": tj})
            row["cv_scores"]["Tailored"] = t["score"]
            row["best_score"] = max(row["best_score"], t["score"])
            row["best_cv_score"] = row["best_score"]
        if key in pre:
            short = key.lower()
            cover_letters.append({"id": f"cl-{short}", "name": cl["name"], "job_id": j["id"], "resume_id": RES_ID[cl["resume"]],
                                  "template": "inter", "page_format": "letter", "voice": "professional", "length": "standard",
                                  "from_persona": False, "created_at": row["discovered_at"], "updated_at": row["discovered_at"],
                                  "json_data": letter_json(cl["resume"], cl)})

    # applications
    applications = []
    interview_n = 0
    for n, a in enumerate(apps_rows, 1):
        src = app_jobs[a["company"]]
        is_feat = src["id"] in prepared
        if is_feat:
            row = jobs_by_id[src["id"]]
            row["status"] = "applied"
        else:
            other = a["score"] - 5 - stable(a["company"], 8)
            scores = {a["best"]: a["score"], ("platform" if a["best"] == "growth" else "growth"): max(30, other)}
            row = finish_job(src, a["applied"] + 1 + stable(a["company"], 3), "applied", scores)
        applied_at = ts(a["applied"], 10 + stable(a["company"], 8), stable(a["company"] + "x", 60))
        trans = [{"from": None, "to": "applied", "at": applied_at, "source": "extension"}]
        prev = "applied"
        for to, days, how in a["path"]:
            trans.append({"from": prev, "to": to, "at": ts(days, 9 + stable(a["company"] + to, 9), stable(to + a["company"], 60)), "source": how})
            prev = to
        interviews = []
        for what, days, where, st in a.get("interviews", []):
            interview_n += 1
            interviews.append({"id": f"int-{interview_n}", "what": what, "when_at": ts(days, 16, 0), "where_text": where, "status": st,
                               "prep": None, "created_at": ts(abs(days) + 2)})
        tailored = next((r for r in resumes if not r["is_base"] and r["job_id"] == src["id"]), None)
        email = a.get("email")
        applications.append({
            "id": f"app-{n}", "job_id": src["id"], "status": a["path"][-1][0] if a["path"] else "applied", "applied_at": applied_at,
            "cv_version_used": tailored["name"] if tailored else RES_NAME[a["best"]], "notes": a.get("notes"),
            "next_action": a.get("next_action"), "next_action_date": ts(-abs(a["next_days"]), 12) if a.get("next_action") else None,
            "last_email_received": ts(email[0], 11) if email else None, "last_email_snippet": email[1] if email else None,
            "status_transitions": trans, "updated_at": trans[-1]["at"],
            "company": row["company"], "company_canonical": row["company"], "title": row["title"], "url": row["url"],
            "best_cv": row["best_cv"], "short_id": None, "location": row["location"], "salary_min": row["salary_min"],
            "salary_max": row["salary_max"], "source": row["source"], "has_cached_page": True, "discovered_at": row["discovered_at"],
            "tailored_resume_id": tailored["id"] if tailored else None, "tailored_resume_name": tailored["name"] if tailored else None,
            "has_cover_letter": any(c["job_id"] == src["id"] for c in cover_letters), "interviews": interviews,
        })

    # the rest of the feed: scored (light), not applied
    for k, j in enumerate(extras):
        best_key = "growth" if stable(j["company"], 3) else "platform"
        top = 42 + stable(j["id"], 44)
        scores = {best_key: top, ("platform" if best_key == "growth" else "growth"): max(25, top - 4 - stable(j["id"] + "o", 10))}
        status = "saved" if k in (1, 6, 11) else ("skip" if k in (4, 9, 15) else "new")
        finish_job(j, 1 + (k * 7) % 13, status, scores)

    # ignored: filtered out by the searches' rules; real pool rows, text only
    ign_src = {j["company"]: j for j in exp["apps"]}
    def ignored(company, days, title=None, **kw):
        j = copy.deepcopy(ign_src[company])
        if title:
            j["title"] = title
            j["id"] = str(uuid.uuid5(uuid.NAMESPACE_URL, "ignored:" + company + title))
            j["external_id"] = hashlib.sha1(j["id"].encode()).hexdigest()
            j["url"] = j["url"].split("?")[0] + "?ignored=" + j["id"][:8]
        j.update(kw)
        finish_job(j, days, "ignored")
    ignored("JPMorgan Chase", 1)                                                    # title exclude: "vice president"
    ignored("Crossing Hurdles", 3)                                                  # company exclude: staffing firm
    ignored("hackajob", 4)                                                          # company exclude: recruiter
    ignored("Randstad Digital Americas", 2, h1b_jd_flag=True, h1b_verdict="unlikely",
            h1b_jd_snippet="...candidates must be authorized to work in the U.S.; no visa sponsorship is available...")  # body exclusion
    ignored("Citi", 5, title="Principal PM, Ads (Clearance required)")              # title exclude: "principal"
    ignored("Gametime", 6, title="Product Marketing Manager, Consumer")             # title exclude: "marketing"

    # short ids by discovery order
    for n, j in enumerate(sorted(jobs, key=lambda x: x["discovered_at"]), 1):
        j["short_id"] = f"J{n}"
    sid = {j["id"]: j["short_id"] for j in jobs}
    for a in applications:
        a["short_id"] = sid[a["job_id"]]

    # ── settings, searches, companies, misc ──
    fixture = json.loads((JN / "frontend/src/demo/fixture.json").read_text(encoding="utf-8")) if (JN / "frontend/src/demo/fixture.json").exists() \
        else json.loads((ROOT / "layer/fixture.json").read_text(encoding="utf-8"))
    from backend.seed import DEFAULT_SETTINGS
    settings = dict(fixture["settings"])
    for key, (val, _d) in DEFAULT_SETTINGS.items():
        if key not in settings:
            try:
                settings[key] = json.loads(val)
            except ValueError:
                settings[key] = val
    for secret in ("dashboard_api_key", "llm_api_key", "telegram_bot_token", "linkedin_password", "linkedin_email", "jobright_email",
                   "jobright_password", "apify_api_key", "telegram_chat_id", "claude_code_oauth_token"):
        settings[secret] = ""

    def search(id_, name, mode, active, sources, include, exclude, last, found, new, **kw):
        base = copy.deepcopy(fixture["searches"][0])
        base.update({"id": id_, "name": name, "search_mode": mode, "active": active, "sources": sources, "title_include_keywords": include,
                     "title_exclude_keywords": exclude, "last_run_at": ts(last, 8), "last_jobs_found": found, "last_new_jobs": new,
                     "created_at": ts(70), "search_term": "product manager" if mode == "keyword" else None})
        base.update(kw)
        return base

    searches = [
        search("search-ext-li", "Extension LI", "linkedin_extension", True, [], [], [], 1, 0, 0, auto_scoring_depth="off", last_duration=None, hours_old=None, results_wanted=None, location=None, search_term=None),
        search("search-ext", "Extension", "extension", True, [], [], [], 2, 0, 0, auto_scoring_depth="light", last_duration=None, hours_old=None, results_wanted=None, location=None, search_term=None),
        search("search-kw", "Consumer PM - US", "keyword", True, ["linkedin", "indeed", "zip_recruiter", "google"], ["product manager"],
               ["staff", "principal", "director", "intern", "technical program"], 0, 64, 9, location="United States", auto_scoring_depth="light", last_duration=58),
        search("search-kw-remote", "Growth PM - Remote", "keyword", True, ["linkedin", "indeed"], ["growth product manager", "product manager, growth"],
               ["staff", "principal", "director"], 0, 38, 5, location="United States", is_remote=True, auto_scoring_depth="light", last_duration=41),
        search("search-levels", "Levels.fyi", "levels_fyi", True, [], ["product manager"], ["staff", "principal", "director"], 1, 120, 14, location=None, auto_scoring_depth="off", last_duration=95),
        search("search-jobright", "Jobright.ai", "jobright", False, [], [], [], 6, 0, 0, location=None, auto_scoring_depth="off", last_duration=None),
    ]

    def company(id_, name, url, kind, tier, opens, fit, active=True, interval=0):
        c = copy.deepcopy(fixture["companies"][0])
        c.update({"id": id_, "name": name, "tier": tier, "active": active, "scrape_urls": [url], "detected_scrape_types": {url: kind},
                  "open_jobs": opens, "open_jobs_week": min(opens, 2), "avg_fit": fit, "scrape_interval_minutes": interval, "last_run_at": ts(0.2, 8), "last_scraped_at": ts(0.2, 8)})
        return c

    companies = [
        company("co-duolingo", "Duolingo", "https://boards.greenhouse.io/duolingo", "greenhouse", 1, 3, 77),
        company("co-airbnb", "Airbnb", "https://boards.greenhouse.io/airbnb", "greenhouse", 1, 5, 74),
        company("co-whoop", "WHOOP", "https://jobs.ashbyhq.com/whoop", "ashby", 1, 2, 83),
        company("co-discord", "Discord", "https://boards.greenhouse.io/discord", "greenhouse", 1, 4, 80),
        company("co-twitch", "Twitch", "https://boards.greenhouse.io/twitch", "greenhouse", 2, 2, 72),
        company("co-otter", "Otter", "https://boards.greenhouse.io/otter", "greenhouse", 2, 1, 70),
        company("co-onepay", "OnePay", "https://jobs.ashbyhq.com/oneapp", "ashby", 2, 2, 74),
        company("co-robinhood", "Robinhood", "https://boards.greenhouse.io/robinhood", "greenhouse", 3, 6, 58),
        company("co-plaid", "Plaid", "https://jobs.lever.co/plaid", "lever", 2, 3, 66),
        company("co-mudflap", "Mudflap", "https://jobs.ashbyhq.com/mudflap", "ashby", 3, 1, 65, active=False),
        company("co-google", "Google", "https://www.google.com/about/careers/applications/jobs/results/?q=product%20manager", "google", 1, 6, 68, interval=240),
        company("co-microsoft", "Microsoft", "https://jobs.careers.microsoft.com/global/en/search?q=product%20manager", "playwright", 1, 5, 66, interval=240),
        company("co-anthropic", "Anthropic", "https://job-boards.greenhouse.io/anthropic", "greenhouse", 1, 4, 72, interval=240),
        company("co-pinterest", "Pinterest", "https://www.pinterestcareers.com/jobs/", "playwright", 2, 4, 75, active=False),
    ]
    for c in companies:
        c["selected_resume_ids"] = []

    activity = [
        ("scrape", "Scrape finished: 14 new postings", None, 0.2), ("score", "Scored 9 new postings", None, 0.2),
        ("email", "Interview invitation detected", "Discord", 4), ("email", "Interview invitation detected", "WHOOP", 7),
        ("email", "Offer received", "Duolingo", 5), ("email", "Rejection detected", "Realtor.com", 10),
        ("status", "Moved to interview", "Chewy", 8), ("scrape", "Scrape finished: 11 new postings", None, 1.2),
        ("email", "Rejection detected", "EBG", 6), ("scrape", "Scrape finished: 9 new postings", None, 2.2),
        ("status", "Moved to interview", "Instacart", 9), ("email", "Rejection detected", "Coinbase", 15),
    ]
    activity_log = [{"id": f"log-{i}", "type": t, "message": m, "company": c, "created_at": ts(d, 8 + i % 8)}
                    for i, (t, m, c, d) in enumerate(activity, 1)]
    runs = [{"id": f"run-{i}", "job_type": "scrape_all", "trigger": "scheduler", "status": "completed", "started_at": ts(i * 0.5, 8),
             "finished_at": ts(i * 0.5, 8, 0).replace("T08:00:00", "T08:04:00"), "duration_seconds": 215 + stable(str(i), 60),
             "result_summary": f"{6 + stable(str(i), 10)} new", "error": None, "meta": None} for i in range(1, 9)]
    costs = {"total_calls": 214, "total_cost_usd": 3.87, "by_purpose": [
        {"purpose": "scoring", "model": "claude-sonnet-5", "calls": 168, "cost_usd": 1.92, "cache_involving": True, "cache_hit_ratio": 0.74},
        {"purpose": "tailor", "model": "claude-sonnet-5", "calls": 22, "cost_usd": 0.84, "cache_involving": True, "cache_hit_ratio": 0.61},
        {"purpose": "cover_letter", "model": "claude-sonnet-5", "calls": 14, "cost_usd": 0.71, "cache_involving": True, "cache_hit_ratio": 0.66},
        {"purpose": "email_classify", "model": "claude-haiku-4-5", "calls": 8, "cost_usd": 0.04, "cache_involving": False, "cache_hit_ratio": 0},
        {"purpose": "autofill", "model": "claude-sonnet-5", "calls": 2, "cost_usd": 0.36, "cache_involving": False, "cache_hit_ratio": 0},
    ]}

    templates = []
    for kind in ("resume_templates", "cover_letter_templates"):
        rows = []
        for d in sorted((JN / "backend" / kind).iterdir()):
            if d.name == "garamond" or not (d / "template.html.j2").exists() or not (d / "meta.json").exists():
                continue
            meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
            meta["id"] = d.name
            meta.setdefault("name", d.name.replace("_", " ").title())
            meta.setdefault("description", "")
            rows.append(meta)
        templates.append(rows)

    accounts = copy.deepcopy(fixture["accounts"])
    accounts[0].update({"created_at": ts(72)})
    accounts[1].update({"created_at": ts(60)})

    data = {
        "version": f"{REF.isoformat()}-{DEMO_VERSION}", "reference_date": REF.isoformat(), "accounts": accounts,
        "settings": settings, "settings_defaults": copy.deepcopy(settings), "countries": fixture["countries"],
        "resume_templates": templates[0], "cover_letter_templates": templates[1], "scheduler_jobs": [],
        "activity_log": activity_log, "runs": runs, "llm_costs": costs,
        "jobs": sorted(jobs, key=lambda x: x["discovered_at"], reverse=True), "applications": applications,
        "searches": searches, "companies": companies, "resumes": resumes, "cover_letters": cover_letters,
        "persona": persona(), "prepared": prepared,
    }
    out = ROOT / "data/data.json"
    out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    st = {}
    for a in applications:
        st[a["status"]] = st.get(a["status"], 0) + 1
    print(f"wrote {out}: {len(jobs)} jobs ({len(prepared)} featured), {len(applications)} applications {st}, "
          f"{len(resumes)} resumes, {len(cover_letters)} cover letters, {out.stat().st_size // 1000} kB")


if __name__ == "__main__":
    main()
