"""Smoke test of a built demo. Runs Playwright (python) against the demo's base URL.

    python smoke.py http://host.docker.internal:4173/JobNavigator-demo      (any host; the path is the demo base)

Checks: every screen loads without console errors; a deep link reloads; a featured job is scored and tailored
from its prepared results; the PDF route returns a rendered template; Reset restores the sample data; and the
page never talks to anything but its own origin and Google Fonts. Exit 1 on any failure.
"""
import json
import sys
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip("/")
ORIGIN = "{0.scheme}://{0.netloc}".format(urlsplit(BASE))
PATH = urlsplit(BASE).path
ALLOWED = {urlsplit(BASE).netloc, "fonts.googleapis.com", "fonts.gstatic.com"}
SCREENS = [("/feed", "Perplexity"), ("/searches", "Consumer PM"), ("/companies", "Duolingo"), ("/applications", "Duolingo"),
           ("/resumes", "PM – Consumer Growth"), ("/cover-letters", "WHOOP"), ("/persona", "Reyes"), ("/stats", ""), ("/settings", "not affiliated")]
fails, requests, console, bad = [], [], [], []


def check(ok, msg):
    print(("ok   " if ok else "FAIL ") + msg)
    if not ok:
        fails.append(msg)


def api(page, method, url, body=None):
    return page.evaluate(
        """async ([m, u, b]) => { const r = await fetch(u, {method: m, headers: {'Content-Type': 'application/json'}, body: b ? JSON.stringify(b) : undefined});
            const t = await r.text(); let d = t; try { d = JSON.parse(t) } catch (e) {} return {status: r.status, data: d} }""",
        [method, url, body])


with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 950}, locale="en-US", accept_downloads=True)
    page = ctx.new_page()
    page.on("request", lambda r: requests.append(r.url))
    # a deep link is answered by Pages' 404.html (status 404, page renders): the browser logs that as a console error,
    # so failed *resources* are checked through their responses instead
    page.on("console", lambda m: console.append(m.text) if m.type == "error" and "Failed to load resource" not in m.text else None)
    page.on("response", lambda r: bad.append(f"{r.status} {r.url}") if r.status >= 400 and r.request.resource_type != "document" else None)
    page.on("pageerror", lambda e: console.append(f"pageerror: {e}"))
    page.on("dialog", lambda d: d.dismiss())

    data = json.loads(ctx.request.get(f"{BASE}/demo-data/data.json").text())
    featured = list(data["prepared"])
    n_apps, n_resumes = len(data["applications"]), len(data["resumes"])
    # a featured job that has no tailored résumé yet
    tailored_for = {r["job_id"] for r in data["resumes"] if r.get("job_id")}
    target = next(j for j in featured if j not in tailored_for)

    page.goto(f"{BASE}/feed", wait_until="networkidle")
    welcome = page.get_by_text("Welcome to JobNavigator")
    check(welcome.count() == 1, "the welcome tour shows on a first visit")
    if welcome.count():
        page.locator('[aria-label="Close"]').first.click()
        page.wait_for_timeout(300)

    for path, marker in SCREENS:
        console.clear()
        page.goto(f"{BASE}{path}", wait_until="networkidle")
        page.wait_for_timeout(700)
        body = page.inner_text("body")
        check(bool(marker) is False or marker.lower() in body.lower(), f"{path} shows {marker!r}")
        check("demo" in body.lower() and "sample data" in body.lower(), f"{path} has the demo marker")
        check("something went wrong" not in body.lower(), f"{path} has no error screen")
        check(not console, f"{path} console clean {console[:2]}")

    # deep link + reload
    page.goto(f"{BASE}/applications", wait_until="networkidle")
    page.reload(wait_until="networkidle")
    check("duolingo" in page.inner_text("body").lower(), "deep link /applications survives a reload")

    # feed: a featured posting opens with its snapshot
    page.goto(f"{BASE}/feed?job={featured[0]}", wait_until="networkidle")
    page.wait_for_timeout(1200)
    check(page.locator("iframe").count() >= 1 or "requirement" in page.inner_text("body").lower(), "feed opens a featured job")
    snap = api(page, "GET", f"/api/jobs/{featured[0]}/cached-page")
    check(isinstance(snap["data"], str) and snap["data"].lstrip().lower().startswith("<!doctype") and 'id="root"' not in snap["data"],
          "featured job serves its snapshot")

    # prepared AI actions
    r = api(page, "POST", f"/api/analyze/{target}?depth=full", {})
    check(r["status"] == 202, "scoring a featured job answers 202")
    page.wait_for_timeout(3600)
    job = api(page, "GET", f"/api/jobs/{target}")["data"]
    check(len(job["cv_scores"]) >= 2 and job["scoring_report"], "scoring a featured job writes both scores and the report")
    check(api(page, "GET", "/api/monitor/active")["data"] == [], "monitor is empty after the run")
    base_id = next(r["id"] for r in data["resumes"] if r["is_base"])
    r = api(page, "POST", "/api/resumes/tailor", {"base_resume_id": base_id, "job_id": target})
    check(r["status"] == 202, "tailoring a featured job answers 202")
    page.wait_for_timeout(3600)
    res = api(page, "GET", "/api/resumes")["data"]
    check(len(res) == n_resumes + 1, f"tailoring added a résumé ({len(res)} vs {n_resumes})")
    other = next(j["id"] for j in data["jobs"] if j["id"] not in data["prepared"])
    r = api(page, "POST", f"/api/analyze/{other}?depth=full", {})
    check(r["status"] == 200 and "featured jobs only" in json.dumps(r["data"]), "a non-featured job gets the friendly message")

    # PDF: the editor previews the rendered template; the print button hands the same HTML to the browser
    page.goto(f"{BASE}/resumes/{base_id}", wait_until="networkidle")
    page.wait_for_timeout(2500)
    texts = []
    for f in page.frames:
        try:
            texts.append(f.inner_text("body"))
        except Exception:
            pass
    check(any("Daniel Reyes" in t and "Brightpath" in t for t in texts), "the résumé editor renders the template (PDF preview)")
    dx = ctx.request.get(f"{BASE}/demo-data/docx/{base_id}.docx")
    check(dx.ok and dx.body()[:2] == b"PK", "pre-made docx is served")

    # edit persists across reload, Reset restores
    page.goto(f"{BASE}/feed", wait_until="networkidle")
    page.reload(wait_until="networkidle")
    check(len(api(page, "GET", "/api/resumes")["data"]) == n_resumes + 1, "edits survive a reload")
    page.get_by_role("button", name="Reset demo").click()
    page.get_by_role("button", name="Reset", exact=True).click()
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(800)
    check(len(api(page, "GET", "/api/resumes")["data"]) == n_resumes, "Reset restores the sample data")
    check(api(page, "GET", "/api/applications")["data"]["total"] == n_apps, f"{n_apps} applications after reset")

    # network
    check(not bad, f"no failed sub-resource requests {bad[:3]}")
    outside = sorted({u for u in requests if urlsplit(u).scheme in ("http", "https") and urlsplit(u).netloc not in ALLOWED})
    check(not outside, f"no request leaves the origin or Google Fonts {outside[:3]}")
    browser.close()

print("SMOKE OK" if not fails else f"{len(fails)} FAILED")
sys.exit(1 if fails else 0)
