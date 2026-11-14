#!/usr/bin/env python3
"""Stage 5c: full preferences save/refresh + For You badges."""
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
        r = await self.send("Runtime.evaluate", {"expression": s, "returnByValue": True})
        if "exceptionDetails" in r:
            raise RuntimeError(str(r["exceptionDetails"]))
        return r.get("result", {}).get("value")

    async def go(self, url, w=1.5):
        await self.send("Page.navigate", {"url": url})
        await asyncio.sleep(w)

    async def shot(self, n):
        r = await self.send("Page.captureScreenshot", {"format": "png"})
        open(os.path.join(OUT, n), "wb").write(base64.b64decode(r["data"]))
        log("screenshot -> " + n)


def setv(sel, val, proto="HTMLInputElement"):
    return ("(() => { const el = document.querySelector(%s); if (!el) return false;"
            " Object.getOwnPropertyDescriptor(window.%s.prototype, 'value').set.call(el, %s);"
            " el.dispatchEvent(new Event('input', {bubbles:true}));"
            " el.dispatchEvent(new Event('change', {bubbles:true})); return true; })()"
            % (json.dumps(sel), proto, json.dumps(val)))


READ_FORM = ("({peanuts: document.querySelector('[data-testid=pref-allergen-Peanuts]')?.getAttribute('aria-pressed'),"
             " japanese: document.querySelector('[data-testid=pref-category-Japanese]')?.getAttribute('aria-pressed'),"
             " spice: document.querySelector('#pref-spice')?.value ?? null,"
             " taste: document.querySelector('[data-testid=pref-taste]')?.value ?? null,"
             " min: document.querySelector('[data-testid=pref-budget-min]')?.value ?? null,"
             " max: document.querySelector('[data-testid=pref-budget-max]')?.value ?? null,"
             " recommend: document.querySelector('[data-testid=pref-recommend-toggle]')?.checked ?? null})")


async def main():
    t = requests.put(CDP + "/json/new?about:blank", timeout=10).json()
    c = C(t["webSocketDebuggerUrl"])
    await c.connect()
    await c.go(APP + "/preferences", 2.5)
    log("start path=" + str(await c.ev("location.pathname")))
    log("form initial=" + str(await c.ev(READ_FORM)))

    # Toggle Japanese on, keep Peanuts, set Mild / Rich, budget 10-15, recommend on.
    await c.ev("document.querySelector('[data-testid=pref-category-Japanese]').click(); 'x'")
    await c.ev(setv("#pref-spice", "Mild", "HTMLSelectElement"))
    await c.ev(setv("[data-testid=pref-taste]", "Rich", "HTMLSelectElement"))
    await c.ev(setv("[data-testid=pref-budget-min]", "10"))
    await c.ev(setv("[data-testid=pref-budget-max]", "15"))
    await c.ev("(() => { const el=document.querySelector('[data-testid=pref-recommend-toggle]');"
               " if (!el.checked) el.click(); return el.checked; })()")
    log("form to save=" + str(await c.ev(READ_FORM)))
    await c.ev("document.querySelector('[data-testid=pref-save]').click(); 'save'")
    await asyncio.sleep(2.0)
    log("saved banner=" + str(await c.ev("!!document.querySelector('[data-testid=pref-saved-toast]')")))
    log("toast=" + str(await c.ev("document.querySelector('[data-testid=toast]')?.innerText || null")))
    log("error=" + str(await c.ev("document.querySelector('[data-testid=pref-error]')?.innerText || null")))
    await c.shot("b7-preferences-saved.png")

    await c.go(APP + "/preferences", 2.5)
    log("form after full refresh=" + str(await c.ev(READ_FORM)))
    await c.shot("b8-preferences-after-refresh.png")

    # For You should now highlight Japanese/Mild dishes.
    await c.go(APP + "/menu?sort=for-you", 2.5)
    badges = await c.ev("document.querySelectorAll('[data-testid^=for-you-]').length")
    cards = await c.ev("document.querySelectorAll('[data-testid^=menu-card-]').length")
    names = await c.ev("[...document.querySelectorAll('[data-testid^=for-you-]')].map(e=>e.getAttribute('data-testid'))")
    log("for-you badges={} cards={} ids={}".format(badges, cards, names))
    await c.shot("b4-for-you.png")

    open(os.path.join(OUT, "browser-cdp3.log"), "w").write("\n".join(LOG) + "\n")
    log("DONE")


if __name__ == "__main__":
    asyncio.run(main())