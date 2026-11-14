#!/usr/bin/env python3
"""Stage 5c continuation: For You, duplicate recovery UI, preferences page."""
import asyncio
import base64
import json
import os
import time

import requests
import websockets

OUT = os.path.dirname(os.path.abspath(__file__))
CDP = "http://127.0.0.1:9444"
APP = "http://127.0.0.1:5175"
LOG = []


def log(msg):
    line = "{} {}".format(time.strftime("%H:%M:%S"), msg)
    print(line, flush=True)
    LOG.append(line)


class C:
    def __init__(self, ws_url):
        self.ws_url = ws_url
        self.events = []
        self.pending = {}
        self.n = 0

    async def connect(self):
        self.ws = await websockets.connect(self.ws_url, max_size=20_000_000)
        asyncio.create_task(self._read())
        await self.send("Page.enable")
        await self.send("Runtime.enable")
        await self.send("Network.enable")

    async def _read(self):
        async for raw in self.ws:
            m = json.loads(raw)
            if "id" in m and m["id"] in self.pending:
                f = self.pending.pop(m["id"])
                if not f.done():
                    f.set_result(m)
            elif "method" in m:
                self.events.append(m)

    async def send(self, method, params=None, timeout=20):
        self.n += 1
        mid = self.n
        f = asyncio.get_event_loop().create_future()
        self.pending[mid] = f
        await self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        return (await asyncio.wait_for(f, timeout=timeout)).get("result", {})

    async def ev(self, script):
        r = await self.send("Runtime.evaluate", {"expression": script, "returnByValue": True})
        if "exceptionDetails" in r:
            raise RuntimeError(str(r["exceptionDetails"]))
        return r.get("result", {}).get("value")

    async def go(self, url, wait=1.5):
        await self.send("Page.navigate", {"url": url})
        await asyncio.sleep(wait)

    async def shot(self, name):
        r = await self.send("Page.captureScreenshot", {"format": "png"})
        with open(os.path.join(OUT, name), "wb") as f:
            f.write(base64.b64decode(r["data"]))
        log("screenshot -> " + name)

    async def wait_sel(self, sel, timeout=10):
        for _ in range(int(timeout * 5)):
            if await self.ev("!!document.querySelector(%s)" % json.dumps(sel)):
                return True
            await asyncio.sleep(0.2)
        return False

    def reqs(self, needle, method="POST"):
        return sum(1 for e in self.events
                   if e.get("method") == "Network.requestWillBeSent"
                   and needle in e["params"]["request"]["url"]
                   and e["params"]["request"]["method"] == method)

    def codes(self, needle):
        return [e["params"]["response"]["status"] for e in self.events
                if e.get("method") == "Network.responseReceived" and needle in e["params"]["response"]["url"]]


def set_val(sel, val):
    return ("(() => { const el = document.querySelector(%s); if (!el) return false;"
            " const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype"
            " : window.HTMLInputElement.prototype;"
            " Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, %s);"
            " el.dispatchEvent(new Event('input', {bubbles:true}));"
            " el.dispatchEvent(new Event('change', {bubbles:true})); return true; })()"
            % (json.dumps(sel), json.dumps(val)))


async def main():
    t = requests.put(CDP + "/json/new?about:blank", timeout=10).json()
    c = C(t["webSocketDebuggerUrl"])
    await c.connect()
    await c.go(APP + "/menu", 2.5)
    path = await c.ev("location.pathname")
    log("startup path=" + str(path))
    if path != "/menu":
        await c.go(APP + "/login", 1.5)
        email = open(os.path.join(OUT, "fresh.email")).read().strip()
        pw = open(os.path.join(OUT, "fresh.pass")).read().strip()
        await c.ev(set_val("[data-testid=login-email]", email))
        await c.ev(set_val("[data-testid=login-password]", pw))
        await c.ev("document.querySelector('[data-testid=login-submit]').click(); 'x'")
        await asyncio.sleep(2.5)
        log("after login path=" + str(await c.ev("location.pathname")))
    log("user=" + str(await c.ev("document.querySelector('header')?.innerText?.replace(/\\n/g,' | ')")))

    # ---------- AC-022 For You ----------
    log("## AC-022 For You toggle (retry)")
    await c.go(APP + "/menu", 2.0)
    before = await c.ev("document.querySelectorAll('[data-testid^=for-you-]').length")
    await c.ev("document.querySelector('[data-testid=sort-for-you]').click(); 'clicked'")
    await asyncio.sleep(2.5)
    log("url={} before_badges={} after_badges={}".format(
        await c.ev("location.pathname + location.search"), before,
        await c.ev("document.querySelectorAll('[data-testid^=for-you-]').length")))
    await c.shot("b4-for-you.png")

    # ---------- Duplicate recovery ----------
    log("## AC-026/053 duplicate order recovery entry (retry)")
    await c.ev("document.querySelector('[data-testid=add-to-cart-2]')?.click(); 'add2'")
    await asyncio.sleep(1.0)
    await c.go(APP + "/cart", 1.5)
    log("cart lines=" + str(await c.ev("document.querySelectorAll('[data-testid^=cart-line-]').length")))
    await c.ev("document.querySelector('[data-testid=cart-checkout]').click(); 'co'")
    await asyncio.sleep(2.5)
    log("checkout path=" + str(await c.ev("location.pathname")))
    log("checkout-empty={} submit={}".format(
        await c.ev("!!document.querySelector('[data-testid=checkout-empty]')"),
        await c.ev("!!document.querySelector('[data-testid=checkout-submit]')")))
    ok = await c.wait_sel("[data-testid=checkout-submit]", 10)
    log("submit appeared=" + str(ok))
    if not ok:
        log("page text=" + str(await c.ev("document.body.innerText.slice(0,500)")))
    else:
        log("address filled=" + str(await c.ev(set_val("[data-testid=checkout-address]", "Building A, 12F"))))
        c.events.clear()
        await c.ev("document.querySelector('[data-testid=checkout-submit]').click(); 'submit'")
        await asyncio.sleep(3.0)
        log("POST responses=" + str(c.codes("/api/v1/orders")))
        log("error code=" + str(await c.ev("document.querySelector('[data-testid=checkout-error]')?.dataset.errorCode")))
        log("error text=" + str(await c.ev("document.querySelector('[data-testid=checkout-error]')?.innerText")))
        log("existing-order link=" + str(await c.ev("!!document.querySelector('[data-testid=checkout-existing-order]')")))
        log("view-orders link=" + str(await c.ev("!!document.querySelector('[data-testid=checkout-view-orders]')")))
        await c.shot("b6-duplicate-recovery.png")

    # ---------- Preferences save + refresh ----------
    log("## AC-021/022/023 preferences page save + refresh")
    await c.go(APP + "/preferences", 2.0)
    form0 = await c.ev("({peanuts: document.querySelector('[data-testid=pref-allergen-Peanuts]')?.getAttribute('aria-pressed'),"
                       " japanese: document.querySelector('[data-testid=pref-category-Japanese]')?.getAttribute('aria-pressed'),"
                       " taste: document.querySelector('[data-testid=pref-taste]')?.value ?? null,"
                       " min: document.querySelector('[data-testid=pref-budget-min]')?.value ?? null,"
                       " max: document.querySelector('[data-testid=pref-budget-max]')?.value ?? null})")
    log("form before save=" + str(form0))
    await c.ev("document.querySelector('[data-testid=pref-save]').click(); 'save'")
    await asyncio.sleep(2.0)
    log("saved banner=" + str(await c.ev("!!document.querySelector('[data-testid=pref-saved-toast]')")))
    log("toast=" + str(await c.ev("document.querySelector('[data-testid=toast]')?.innerText || document.querySelector('[data-testid=toast-error]')?.innerText || null")))
    log("error=" + str(await c.ev("document.querySelector('[data-testid=pref-error]')?.innerText || null")))
    await c.shot("b7-preferences-saved.png")
    await c.go(APP + "/preferences", 2.0)
    form1 = await c.ev("({peanuts: document.querySelector('[data-testid=pref-allergen-Peanuts]')?.getAttribute('aria-pressed'),"
                       " japanese: document.querySelector('[data-testid=pref-category-Japanese]')?.getAttribute('aria-pressed'),"
                       " taste: document.querySelector('[data-testid=pref-taste]')?.value ?? null,"
                       " min: document.querySelector('[data-testid=pref-budget-min]')?.value ?? null,"
                       " max: document.querySelector('[data-testid=pref-budget-max]')?.value ?? null})")
    log("form after refresh=" + str(form1))
    await c.shot("b8-preferences-after-refresh.png")

    with open(os.path.join(OUT, "browser-cdp2.log"), "w") as f:
        f.write("\n".join(LOG) + "\n")
    log("DONE")


if __name__ == "__main__":
    asyncio.run(main())