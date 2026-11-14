#!/usr/bin/env python3
"""Stage 5c product re-verification driver (isolated Chrome via CDP 9444)."""
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
AUTH = json.load(open(os.path.join(OUT, "fresh-login.json")))["data"]
AUTH_STORE = json.dumps({
    "accessToken": AUTH["accessToken"],
    "refreshToken": AUTH["refreshToken"],
    "user": AUTH["user"],
})
PREFS_STORE = json.dumps({
    "allergens": ["Peanuts"],
    "preferredCategories": ["Japanese"],
    "spicePreference": "Mild",
    "tastePreference": "Medium",
    "budgetMinCents": 1000,
    "budgetMaxCents": 1500,
    "recommendEnabled": True,
})
LOG = []


def log(msg):
    line = "{} {}".format(time.strftime("%H:%M:%S"), msg)
    print(line, flush=True)
    LOG.append(line)


class CDPClient:
    def __init__(self, ws_url):
        self.ws_url = ws_url
        self.ws = None
        self.next_id = 0
        self.events = []
        self.pending = {}

    async def connect(self):
        self.ws = await websockets.connect(self.ws_url, max_size=20_000_000)
        self.reader = asyncio.create_task(self._read())
        await self.send("Page.enable")
        await self.send("Runtime.enable")
        await self.send("Network.enable")

    async def _read(self):
        async for raw in self.ws:
            msg = json.loads(raw)
            if "id" in msg and msg["id"] in self.pending:
                fut = self.pending.pop(msg["id"])
                if not fut.done():
                    fut.set_result(msg)
            elif "method" in msg:
                self.events.append(msg)

    async def send(self, method, params=None, timeout=20):
        self.next_id += 1
        mid = self.next_id
        fut = asyncio.get_event_loop().create_future()
        self.pending[mid] = fut
        await self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        msg = await asyncio.wait_for(fut, timeout=timeout)
        if "error" in msg:
            raise RuntimeError("{} -> {}".format(method, msg["error"]))
        return msg.get("result", {})

    async def eval(self, script, await_promise=False):
        res = await self.send(
            "Runtime.evaluate",
            {"expression": script, "returnByValue": True, "awaitPromise": await_promise},
        )
        if "exceptionDetails" in res:
            raise RuntimeError("eval failed: {}".format(res["exceptionDetails"]))
        return res.get("result", {}).get("value")

    async def navigate(self, url, wait=1.5):
        await self.send("Page.navigate", {"url": url})
        await asyncio.sleep(wait)

    async def screenshot(self, path):
        res = await self.send("Page.captureScreenshot", {"format": "png"})
        with open(path, "wb") as f:
            f.write(base64.b64decode(res["data"]))
        log("screenshot -> " + path)

    def count_requests(self, needle, method="POST"):
        return sum(
            1
            for e in self.events
            if e.get("method") == "Network.requestWillBeSent"
            and needle in e["params"]["request"]["url"]
            and e["params"]["request"]["method"] == method
        )

    def response_codes(self, needle):
        out = []
        for e in self.events:
            if e.get("method") == "Network.responseReceived" and needle in e["params"]["response"]["url"]:
                out.append(e["params"]["response"]["status"])
        return out


JS_CART_LINES = (
    "(JSON.parse(localStorage.getItem('webox.cart.v1')||'{\"state\":{\"lines\":[]}}')"
    ".state.lines||[]).length"
)
JS_CART_CONTENT = "localStorage.getItem('webox.cart.v1')"
JS_MODAL = "!!document.querySelector('[data-testid=allergen-modal]')"
JS_MODAL_TEXT = "document.querySelector('[data-testid=allergen-modal]').innerText"
JS_SUCCESS = "!!document.querySelector('[data-testid=order-success]')"


def set_val_js(sel, val):
    return (
        "(() => { const el = document.querySelector('%s'); if (!el) return false;"
        " const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype"
        " : window.HTMLInputElement.prototype;"
        " Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, %s);"
        " el.dispatchEvent(new Event('input', {bubbles:true}));"
        " el.dispatchEvent(new Event('change', {bubbles:true})); return true; })()"
    ) % (sel, json.dumps(val))


async def main():
    target = requests.put(CDP + "/json/new?about:blank", timeout=10).json()
    c = CDPClient(target["webSocketDebuggerUrl"])
    await c.connect()
    log("CDP connected: " + target["id"])

    email = open(os.path.join(OUT, "fresh.email")).read().strip()
    password = open(os.path.join(OUT, "fresh.pass")).read().strip()
    await c.navigate(APP + "/login", 1.5)
    await c.eval(set_val_js("[data-testid=login-email]", email))
    await c.eval(set_val_js("[data-testid=login-password]", password))
    await c.eval("document.querySelector('[data-testid=login-submit]').click(); 'login'")
    await asyncio.sleep(2.0)
    path = await c.eval("location.pathname")
    cards = await c.eval("document.querySelectorAll('[data-testid^=menu-card-]').length")
    user = await c.eval("document.querySelector('[data-testid=nav-cart]') ? 'session-ok' : 'no-nav'")
    log("login -> url={} cards={} nav={}".format(path, cards, user))
    if path != "/menu":
        raise RuntimeError("login failed, still at " + str(path))
    await c.eval("localStorage.removeItem('webox.cart.v1'); 'cart cleared'")

    # ---------- AC-021 card shortcut allergen modal ----------
    log("## AC-021 card add: click add-to-cart-1 (Kung Pao, Peanuts)")
    c.events.clear()
    await c.eval("document.querySelector('[data-testid=add-to-cart-1]').click(); 'clicked'")
    await asyncio.sleep(1.5)
    modal = await c.eval(JS_MODAL)
    log("allergen modal present=" + str(modal))
    if modal:
        log("modal text=" + str(await c.eval(JS_MODAL_TEXT)))
    log("cart lines with modal open=" + str(await c.eval(JS_CART_LINES)))
    await c.screenshot(os.path.join(OUT, "b2-allergen-modal.png"))

    log("## AC-021 Cancel -> must not add")
    await c.eval("document.querySelector('[data-testid=allergen-cancel]').click(); 'cancel'")
    await asyncio.sleep(0.6)
    log("modal after cancel=" + str(await c.eval(JS_MODAL)))
    log("cart lines after cancel=" + str(await c.eval(JS_CART_LINES)))

    log("## AC-021 Add anyway -> cart +1")
    await c.eval("document.querySelector('[data-testid=add-to-cart-1]').click(); 'clicked'")
    await asyncio.sleep(1.2)
    await c.eval("document.querySelector('[data-testid=allergen-add-anyway]').click(); 'confirm'")
    await asyncio.sleep(0.8)
    cart = await c.eval(JS_CART_CONTENT)
    log("cart content=" + str(cart))
    await c.screenshot(os.path.join(OUT, "b3-cart-after-allergen.png"))

    # ---------- AC-022 For You ----------
    log("## AC-022 For You toggle")
    await c.navigate(APP + "/menu", 1.5)
    await c.eval("document.querySelector('[data-testid=sort-for-you]').click(); 'clicked'")
    await asyncio.sleep(1.2)
    fy = await c.eval("document.querySelectorAll('[data-testid^=for-you-]').length")
    cards = await c.eval("document.querySelectorAll('[data-testid^=menu-card-]').length")
    log("for-you badges={} cards={}".format(fy, cards))
    first = await c.eval("[...document.querySelectorAll('[data-testid^=menu-card-] h3')].slice(0,6).map(e=>e.innerText)")
    log("first cards=" + str(first))
    await c.screenshot(os.path.join(OUT, "b4-for-you.png"))

    # ---------- AC-014/015/053 same-tick double submit ----------
    log("## AC-014/015/053 same-tick double click on Place Order")
    await c.navigate(APP + "/cart", 1.2)
    lines = await c.eval("document.querySelectorAll('[data-testid^=cart-line-]').length")
    log("cart page lines=" + str(lines))
    await c.eval("document.querySelector('[data-testid=cart-checkout]').click(); 'checkout'")
    await asyncio.sleep(2.0)
    log("checkout url=" + str(await c.eval("location.pathname")))
    filled = await c.eval(set_val_js("[data-testid=checkout-address]", "Building A, 12F"))
    log("address filled=" + str(filled))
    await asyncio.sleep(0.5)
    c.events.clear()
    result = await c.eval(
        "(() => { const b = document.querySelector('[data-testid=checkout-submit]');"
        " if (!b) return 'no-button'; b.click(); b.click(); return 'double-clicked'; })()"
    )
    log("double click result=" + str(result))
    await asyncio.sleep(3.0)
    log("POST /orders count={} responses={}".format(
        c.count_requests("/api/v1/orders", "POST"), c.response_codes("/api/v1/orders")))
    log("url after submit=" + str(await c.eval("location.pathname")))
    success = await c.eval(JS_SUCCESS)
    log("success page=" + str(success))
    if success:
        log("order no=" + str(await c.eval("document.querySelector('[data-testid=order-no]').innerText")))
    log("cart after success=" + str(await c.eval(JS_CART_CONTENT)))
    await c.screenshot(os.path.join(OUT, "b5-double-submit-success.png"))

    # ---------- AC-026/053 duplicate recovery ----------
    log("## AC-026/053 duplicate order recovery entry")
    await c.navigate(APP + "/menu", 1.5)
    await c.eval("document.querySelector('[data-testid=add-to-cart-2]').click(); 'add2'")
    await asyncio.sleep(1.2)
    await c.navigate(APP + "/cart", 1.0)
    lines = await c.eval("document.querySelectorAll('[data-testid^=cart-line-]').length")
    log("cart lines for duplicate attempt=" + str(lines))
    await c.eval("document.querySelector('[data-testid=cart-checkout]').click(); 'checkout'")
    await asyncio.sleep(1.8)
    await c.eval(set_val_js("[data-testid=checkout-address]", "Building A, 12F"))
    await asyncio.sleep(0.4)
    c.events.clear()
    await c.eval("document.querySelector('[data-testid=checkout-submit]').click(); 'submit'")
    await asyncio.sleep(2.5)
    log("duplicate POST responses=" + str(c.response_codes("/api/v1/orders")))
    code = await c.eval("document.querySelector('[data-testid=checkout-error]')?.dataset.errorCode")
    text = await c.eval("document.querySelector('[data-testid=checkout-error]')?.innerText")
    link = await c.eval("!!document.querySelector('[data-testid=checkout-existing-order]')")
    log("error code=" + str(code))
    log("error text=" + str(text))
    log("existing-order link=" + str(link))
    await c.screenshot(os.path.join(OUT, "b6-duplicate-recovery.png"))

    # ---------- AC-021/022/023 preferences page save ----------
    log("## AC-021/022/023 preferences page save + refresh")
    await c.navigate(APP + "/preferences", 1.5)
    await c.eval("document.querySelector('[data-testid=pref-save]')?.click(); 'save'")
    await asyncio.sleep(1.5)
    toast = await c.eval(
        "document.querySelector('[data-testid=toast]')?.innerText"
        " || document.querySelector('[data-testid=toast-error]')?.innerText || null")
    saved = await c.eval("!!document.querySelector('[data-testid=pref-saved-toast]')")
    log("prefs save toast=" + str(toast))
    log("pref-saved-toast=" + str(saved))
    await c.navigate(APP + "/preferences", 1.5)
    form = await c.eval(
        "({peanuts: document.querySelector('[data-testid=pref-allergen-Peanuts]')?.getAttribute('aria-pressed'),"
        " japanese: document.querySelector('[data-testid=pref-category-Japanese]')?.getAttribute('aria-pressed'),"
        " taste: document.querySelector('[data-testid=pref-taste]')?.value ?? null,"
        " budgetMin: document.querySelector('[data-testid=pref-budget-min]')?.value ?? null,"
        " budgetMax: document.querySelector('[data-testid=pref-budget-max]')?.value ?? null})"
    )
    log("prefs form after refresh=" + str(form))
    await c.screenshot(os.path.join(OUT, "b7-preferences.png"))

    with open(os.path.join(OUT, "browser-cdp.log"), "w") as f:
        f.write("\n".join(LOG) + "\n")
    log("DONE")


if __name__ == "__main__":
    asyncio.run(main())