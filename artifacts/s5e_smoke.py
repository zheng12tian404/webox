#!/usr/bin/env python3
"""Stage 5e smoke regression against live backend 8083 (demo DB)."""
import json, time, sys
import requests

B = "http://" + "127.0.0.1" + ":8083" + "/api/v1"
OUT = []
def log(m):
    line = "{} {}".format(time.strftime("%H:%M:%S"), m)
    print(line, flush=True); OUT.append(line)

def api(method, path, token=None, key=None, body=None):
    h = {"Content-Type": "application/json"}
    if token: h["Authorization"] = "Bearer " + token
    if key: h["Idempotency-Key"] = key
    r = requests.request(method, B + path, headers=h, json=body, timeout=20)
    try: j = r.json()
    except Exception: j = None
    return r.status_code, j, r.text

def check(name, ok, detail):
    log("[{}] {} | {}".format("PASS" if ok else "FAIL", name, detail))
    return ok

results = []
r = requests.get(B + "/health", timeout=10)
results.append(check("health", r.status_code == 200 and r.json()["data"]["db"] == "UP", "status={} body={}".format(r.status_code, r.text[:160])))

stamp = str(int(time.time()))[-6:]
email = "s5e_" + stamp + "@test.com"
pwd = "Abc12345"
s, j, t = api("POST", "/auth/register", body={"email": email, "password": pwd})
results.append(check("register", s == 201, "status={} body={}".format(s, t[:160])))
s, j, t = api("POST", "/auth/login", body={"email": email, "password": pwd})
tok = (j or {}).get("data", {}).get("accessToken")
results.append(check("login", s == 200 and bool(tok), "status={} role={}".format(s, (j or {}).get("data", {}).get("user", {}).get("role"))))

s, j, t = api("GET", "/menu", token=tok)
items = (j or {}).get("data", {}).get("items", [])
results.append(check("menu", s == 200 and len(items) >= 1, "status={} total={} first={}".format(s, len(items), items[0]["name"] if items else None)))

prefs = {"allergens": ["Peanuts"], "preferredCategories": [], "spicePreference": "None",
         "tastePreference": "Medium", "budgetMinCents": None, "budgetMaxCents": None, "recommendEnabled": False}
s, j, t = api("PUT", "/me/preferences", token=tok, body=prefs)
s2, j2, t2 = api("GET", "/me/preferences", token=tok)
got = (j2 or {}).get("data") or {}
results.append(check("prefs save/read", s == 200 and s2 == 200 and got.get("allergens") == ["Peanuts"], "put={} get={} allergens={}".format(s, s2, got.get("allergens"))))

dish_id = items[0]["dishId"] if items else 1
body = {"items": [{"dishId": dish_id, "qty": 1, "optionIds": []}], "address": "Stage5e Smoke Address"}
key = "s5e-smoke-" + stamp
s1, j1, t1 = api("POST", "/orders", token=tok, key=key, body=body)
oid1 = ((j1 or {}).get("data") or {}).get("orderId")
s2, j2, t2 = api("POST", "/orders", token=tok, key=key, body=body)
oid2 = ((j2 or {}).get("data") or {}).get("orderId")
results.append(check("order create", s1 == 201 and bool(oid1), "status={} orderId={} code={}".format(s1, oid1, (j1 or {}).get("code"))))
results.append(check("order idempotent replay", s2 in (200, 201) and oid2 == oid1, "status={} orderId={}".format(s2, oid2)))

s, j, t = api("GET", "/orders", token=tok)
orders = (j or {}).get("data", {}).get("items", [])
results.append(check("order list", s == 200 and any(str(o.get("orderId")) == str(oid1) for o in orders),
                     "status={} total={} first={}".format(s, (j or {}).get("data", {}).get("total"), orders[0].get("orderNo") if orders else None)))

s, j, t = api("GET", "/admin/dishes", token=tok)
results.append(check("employee /admin -> 403", s == 403, "status={} body={}".format(s, t[:120])))

log("SUMMARY {}/{} PASS".format(sum(results), len(results)))
open("/home/gem/code/req-squad/workspace/6343a752-e110-407c-8dfb-a5873425d917/artifacts/s5e-smoke.log", "w").write("\n".join(OUT) + "\n")
sys.exit(0 if all(results) else 1)