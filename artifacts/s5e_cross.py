#!/usr/bin/env python3
"""Stage 5e: independent re-verification of S5C-D-001 (cross-account prefs/cart isolation)."""
import asyncio, base64, json, os, time
import requests, websockets

OUT = os.path.dirname(os.path.abspath(__file__))
CDP = "http://127.0.0.1:9446"
APP = "http://" + "127.0.0.1" + ":5175"
A_EMAIL = "s5c_pa_225849@test.com"
B_EMAIL = "s5c_clean_230749@test.com"
PASS = "Test12345"
LOG = []

def log(m):
    line = "{} {}".format(time.strftime("%H:%M:%S"), m)
    print(line, flush=True)
    LOG.append(line)

class C:
    def __init__(self, u):
        self.u = u; self.p = {}; self.n = 0
    async def connect(self):
        self.ws = await websockets.connect(self.u, max_size=20000000)
        asyncio.create_task(self.read())
        for m in ("Page.enable", "Runtime.enable", "Network.enable"):
            await self.send(m)
    async def read(self):
        async for raw in self.ws:
            m = json.loads(raw)
            if "id" in m and m["id"] in self.p:
                f = self.p.pop(m["id"])
                if not f.done(): f.set_result(m)
    async def send(self, method, params=None):
        self.n += 1
        f = asyncio.get_event_loop().create_future(); self.p[self.n] = f
        await self.ws.send(json.dumps({"id": self.n, "method": method, "params": params or {}}))
        return (await asyncio.wait_for(f, 30)).get("result", {})
    async def ev(self, s):
        r = await self.send("Runtime.evaluate", {"expression": s, "returnByValue": True, "awaitPromise": True})
        if "exceptionDetails" in r:
            return "EXCEPTION:" + str(r["exceptionDetails"].get("text"))
        return r.get("result", {}).get("value")
    async def go(self, url, w=2.0):
        await self.send("Page.navigate", {"url": url}); await asyncio.sleep(w)
    async def shot(self, n):
        r = await self.send("Page.captureScreenshot", {"format": "png"})
        open(os.path.join(OUT, n), "wb").write(base64.b64decode(r["data"]))
        log("screenshot -> " + n)

def setv(sel, val):
    return ("(() => { const el=document.querySelector(%s); if(!el) return false;"
            " Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(el,%s);"
            " el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true; })()"
            % (json.dumps(sel), json.dumps(val)))

STORAGE = ("JSON.stringify({auth:localStorage.getItem('webox.auth.v1'),prefs:localStorage.getItem('webox.prefs.v1'),"
           "cart:localStorage.getItem('webox.cart.v1')})")
PREFS_API = "fetch('/api/v1/me/preferences',{credentials:'include'}).then(r=>r.json()).then(e=>JSON.stringify(e.data))"

async def login(c, email):
    await c.go(APP + "/login", 1.2)
    await c.ev(setv("[data-testid=login-email]", email))
    await c.ev(setv("[data-testid=login-password]", PASS))
    await c.ev("document.querySelector('[data-testid=login-submit]').click(); 'clicked'")
    await asyncio.sleep(2.8)
    log("login {} -> path={} user={}".format(email, await c.ev("location.pathname"),
        await c.ev("(() => { try { return JSON.parse(localStorage.getItem('webox.auth.v1')).user.email; } catch(e) { return null; } })()")))

async def logout(c):
    await c.ev("document.querySelector('[data-testid=logout]')?.click(); 'clicked'")
    await asyncio.sleep(2.0)
    log("logout -> path=" + str(await c.ev("location.pathname")) + " storage=" + str(await c.ev(STORAGE)))

async def put_prefs(c, allergens):
    body = {"allergens": allergens, "preferredCategories": [], "spicePreference": "None",
            "tastePreference": "Medium", "budgetMinCents": None, "budgetMaxCents": None, "recommendEnabled": False}
    log("PUT prefs {} -> {}".format(allergens, await c.ev(
        "fetch('/api/v1/me/preferences',{method:'PUT',credentials:'include',headers:{'Content-Type':'application/json'},"
        "body:%s}).then(r=>r.status).then(s=>'status='+s)" % json.dumps(json.dumps(body)))))
    await asyncio.sleep(0.6)
    log("GET prefs -> " + str(await c.ev(PREFS_API)))

async def add_kung_pao(c, tag):
    await c.go(APP + "/menu", 2.8)
    found = await c.ev("!!document.querySelector('[data-testid=add-to-cart-1]')")
    log("{} menu card present={} path={}".format(tag, found, await c.ev("location.pathname")))
    if not found:
        return None
    await c.ev("document.querySelector('[data-testid=add-to-cart-1]').click(); 'clicked'")
    await asyncio.sleep(2.5)
    modal = await c.ev("!!document.querySelector('[data-testid=allergen-modal]')")
    log("{} allergen modal present={}".format(tag, modal))
    log("{} modal text={}".format(tag, await c.ev("document.querySelector('[data-testid=allergen-modal]')?.innerText || null")))
    return modal

async def main():
    t = requests.put(CDP + "/json/new?about:blank", timeout=10).json()
    c = C(t["webSocketDebuggerUrl"]); await c.connect()

    # Scenario 1: A(Peanuts) -> logout -> B(no allergen) -> Kung Pao must NOT warn
    await login(c, A_EMAIL)
    await put_prefs(c, ["Peanuts"])
    await c.go(APP + "/preferences", 2.0)
    await c.ev("document.querySelector('[data-testid=pref-save]')?.click(); 'save'")
    await asyncio.sleep(1.5)
    m1 = await add_kung_pao(c, "A-first")
    log("RESULT A first modal={} (expect True)".format(m1))
    if m1:
        await c.ev("document.querySelector('[data-testid=allergen-add-anyway]').click(); 'ok'")
        await asyncio.sleep(0.8)
    log("A cart after confirm=" + str(await c.ev("localStorage.getItem('webox.cart.v1')")))
    await c.shot("s5e-a-peanuts-modal.png")
    await logout(c)

    # Scenario 2: B login -> no modal; logout leaves no prefs/cart
    await login(c, B_EMAIL)
    await put_prefs(c, [])
    await c.go(APP + "/preferences", 1.5)
    await c.ev("document.querySelector('[data-testid=pref-save]')?.click(); 'save'")
    await asyncio.sleep(1.2)
    m2 = await add_kung_pao(c, "B")
    log("RESULT B modal={} (expect False)".format(m2))
    log("B cart store=" + str(await c.ev("localStorage.getItem('webox.cart.v1')")))
    await c.shot("s5e-b-no-modal.png")
    await logout(c)

    # Scenario 3: A re-login -> warning again
    await login(c, A_EMAIL)
    m3 = await add_kung_pao(c, "A-again")
    log("RESULT A again modal={} (expect True)".format(m3))
    await c.shot("s5e-a-modal-again.png")
    await logout(c)
    log("FINAL storage=" + str(await c.ev(STORAGE)))

    ok = (m1 is True) and (m2 is False) and (m3 is True)
    log("VERDICT S5C-D-001: " + ("PASS" if ok else "FAIL"))
    open(os.path.join(OUT, "s5e-cross-account.log"), "w").write("\n".join(LOG) + "\n")
    log("DONE")

if __name__ == "__main__":
    asyncio.run(main())