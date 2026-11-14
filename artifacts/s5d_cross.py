#!/usr/bin/env python3
"""Stage 5d: cross-account preferences/cart isolation (S5C-D-001)."""
import asyncio
import base64
import json
import os
import time

import requests
import websockets

OUT = os.path.dirname(os.path.abspath(__file__))
CDP = "http://127.0.0.1:9445"
APP = "http://127.0.0.1:5175"
LOG = []

A_EMAIL = "s5c_pa_225849@test.com"
B_EMAIL = "s5c_clean_230749@test.com"
PASS = "Test12345"


def log(m):
    line = "{} {}".format(time.strftime("%H:%M:%S"), m)
    print(line, flush=True)
    LOG.append(line)


class C:
    def __init__(self, u):
        self.u = u
        self.p = {}
        self.e = []
        self.n = 0

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
                if not f.done():
                    f.set_result(m)
            elif "method" in m:
                self.e.append(m)

    async def send(self, method, params=None):
        self.n += 1
        f = asyncio.get_event_loop().create_future()
        self.p[self.n] = f
        await self.ws.send(json.dumps({"id": self.n, "method": method, "params": params or {}}))
        return (await asyncio.wait_for(f, 30)).get("result", {})

    async def ev(self, s):
        r = await self.send("Runtime.evaluate", {"expression": s, "returnByValue": True, "awaitPromise": True})
        if "exceptionDetails" in r:
            raise RuntimeError(str(r["exceptionDetails"]))
        return r.get("result", {}).get("value")

    async def go(self, url, w=2.0):
        await self.send("Page.navigate", {"url": url})
        await asyncio.sleep(w)

    async def shot(self, n):
        r = await self.send("Page.captureScreenshot", {"format": "png"})
        open(os.path.join(OUT, n), "wb").write(base64.b64decode(r["data"]))
        log("screenshot -> " + n)


def setv(sel, val):
    return ("(() => { const el = document.querySelector(%s); if (!el) return false;"
            " Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, %s);"
            " el.dispatchEvent(new Event('input', {bubbles:true}));"
            " el.dispatchEvent(new Event('change', {bubbles:true})); return true; })()"
            % (json.dumps(sel), json.dumps(val)))


STORAGE = ("JSON.stringify({auth: localStorage.getItem('webox.auth.v1'),"
           " prefs: localStorage.getItem('webox.prefs.v1'),"
           " cart: localStorage.getItem('webox.cart.v1')})")

PREFS_API = ("fetch('/api/v1/me/preferences', {credentials:'include'}).then(r=>r.json())"
             ".then(e=>JSON.stringify(e.data))")


async def login(c, email):
    await c.go(APP + "/login", 1.5)
    await c.ev(setv("[data-testid=login-email]", email))
    await c.ev(setv("[data-testid=login-password]", PASS))
    await c.ev("document.querySelector('[data-testid=login-submit]').click(); 'clicked'")
    await asyncio.sleep(3.0)
    log("login {} -> path={} user={}".format(
        email,
        await c.ev("location.pathname"),
        await c.ev("(() => { try { return JSON.parse(localStorage.getItem('webox.auth.v1')).user.email; }"
                   " catch(e) { return null; } })()")))


async def logout(c):
    await c.ev("(() => { const b=document.querySelector('[data-testid=logout]'); if(!b) return 'no-btn'; b.click(); return 'clicked'; })()")
    await asyncio.sleep(2.5)
    log("after logout path=" + str(await c.ev("location.pathname")))
    log("storage after logout=" + str(await c.ev(STORAGE)))
    log("prefs store after logout=" + str(await c.ev(
        "(() => { const p=localStorage.getItem('webox.prefs.v1'); return p===null?'null':p; })()")))
    log("cart store after logout=" + str(await c.ev(
        "(() => { const p=localStorage.getItem('webox.cart.v1'); return p===null?'null':p; })()")))


async def set_a_allergen(c):
    await c.go(APP + "/preferences", 2.5)
    pressed = await c.ev("document.querySelector('[data-testid=pref-allergen-Peanuts]')?.getAttribute('aria-pressed')")
    log("A Peanuts pressed before=" + str(pressed))
    if pressed != "true":
        await c.ev("document.querySelector('[data-testid=pref-allergen-Peanuts]').click(); 'toggled'")
    await c.ev("document.querySelector('[data-testid=pref-save]').click(); 'save'")
    await asyncio.sleep(2.0)
    log("A prefs API=" + str(await c.ev(PREFS_API)))
    log("A prefs store=" + str(await c.ev("localStorage.getItem('webox.prefs.v1')")))
    await c.shot("s5d-a-login.png")


async def ensure_b_no_allergen(c):
    log("B prefs API(before)=" + str(await c.ev(PREFS_API)))
    await c.ev(
        "fetch('/api/v1/me/preferences',{method:'PUT',credentials:'include',"
        "headers:{'Content-Type':'application/json'},body:JSON.stringify({allergens:[],preferredCategories:[],"
        "spicePreference:'None',tastePreference:'Medium',budgetMinCents:null,budgetMaxCents:null,"
        "recommendEnabled:false})}).then(r=>r.status).then(s=>'put='+s)")
    await asyncio.sleep(1.0)
    log("B prefs API(after)=" + str(await c.ev(PREFS_API)))


async def add_kung_pao(c, tag):
    await c.go(APP + "/menu", 3.0)
    found = await c.ev("!!document.querySelector('[data-testid=add-to-cart-1]')")
    log("{} menu card present={} path={}".format(tag, found, await c.ev("location.pathname")))
    if not found:
        return False
    await c.ev("document.querySelector('[data-testid=add-to-cart-1]').click(); 'clicked'")
    await asyncio.sleep(3.0)
    modal = await c.ev("!!document.querySelector('[data-testid=allergen-modal]')")
    cart = await c.ev("localStorage.getItem('webox.cart.v1')")
    log("{} allergen modal present={}".format(tag, modal))
    log("{} cart store={}".format(tag, cart))
    return modal, cart


async def main():
    t = requests.put(CDP + "/json/new?about:blank", timeout=10).json()
    c = C(t["webSocketDebuggerUrl"])
    await c.connect()

    # ---- Scenario 1: A(Peanuts) -> logout -> B(no allergen) -> Kung Pao must NOT warn
    await login(c, A_EMAIL)
    await set_a_allergen(c)
    # Put an item in A's cart so cart persistence cleanup is observable.
    modal_a, cart_a = await add_kung_pao(c, "A-before-logout")
    log("A modal before logout={} (expected True, cart 0 until confirm)".format(modal_a))
    if modal_a:
        await c.ev("document.querySelector('[data-testid=allergen-add-anyway]').click(); 'ok'")
        await asyncio.sleep(1.0)
    log("A cart after confirm=" + str(await c.ev("localStorage.getItem('webox.cart.v1')")))
    await logout(c)

    await login(c, B_EMAIL)
    await ensure_b_no_allergen(c)
    log("B prefs store after login=" + str(await c.ev("localStorage.getItem('webox.prefs.v1')")))
    res = await add_kung_pao(c, "B")
    log("RESULT B modal present={} (expected False)".format(res[0] if res else "card-missing"))
    await c.shot("s5d-b-no-modal.png")

    # ---- Scenario 2: B -> logout -> A(Peanuts) -> Kung Pao must warn
    await logout(c)
    await login(c, A_EMAIL)
    log("A prefs store after re-login=" + str(await c.ev("localStorage.getItem('webox.prefs.v1')")))
    res2 = await add_kung_pao(c, "A")
    log("RESULT A modal present={} (expected True)".format(res2[0] if res2 else "card-missing"))
    log("A modal text=" + str(await c.ev("document.querySelector('[data-testid=allergen-modal]')?.innerText || null")))
    await c.shot("s5d-a-modal.png")

    # ---- Post-logout storage assertion (explicit second check)
    await logout(c)
    log("FINAL storage=" + str(await c.ev(STORAGE)))

    open(os.path.join(OUT, "s5d-cross-account.log"), "w").write("\n".join(LOG) + "\n")
    log("DONE")


if __name__ == "__main__":
    asyncio.run(main())