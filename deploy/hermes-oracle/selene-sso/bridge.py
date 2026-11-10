"""Minimal same-site Nous dashboard SSO bridge for Hermes WebUI.

Reuses only the official dashboard's verified /api/auth/me response.
Does not receive Portal credentials, JWT signing keys or refresh tokens.
"""
import base64
import hashlib
import hmac
import http.client
import json
import sys
import os
import re
import secrets
import threading
import time
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlencode, urlsplit

KI_HOST = "ki.lorzen.net"
SELENE_HOST = "selene-sso.lorzen.net"
KI_ORIGIN = "https://" + KI_HOST
SELENE_ORIGIN = "https://" + SELENE_HOST
PREFIX = "/selene-sso"
STATE_COOKIE = "__Host-selene_sso_state"
SESSION_COOKIE = "__Host-selene_sso_session"
USER_PATTERN = re.compile(r"^[A-Za-z0-9_.:@-]{1,128}$")
STATE_PATTERN = re.compile(r"^[A-Za-z0-9_-]{25,128}$")
SECRET = secrets.token_bytes(32)
LOCK = threading.Lock()
STATES = {}
CODES = {}
SESSION_SECONDS = 3600
PENDING_SECONDS = 300

def b64(data):
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")

def unb64(text):
    return base64.urlsafe_b64decode(text + "=" * ((-len(text)) % 4))

def cookies(header):
    jar = SimpleCookie()
    if header and len(header) <= 16000:
        try:
            jar.load(header)
        except Exception:
            return {}
    return {key: morsel.value for key, morsel in jar.items()}

def mint_session(user_id):
    payload = json.dumps({"sub": user_id, "exp": int(time.time()) + SESSION_SECONDS,
                          "aud": "hermes-selene", "iss": "hermes-dashboard-nous"},
                         separators=(",", ":"), sort_keys=True).encode("utf-8")
    part = b64(payload)
    signature = b64(hmac.new(SECRET, part.encode("ascii"), hashlib.sha256).digest())
    return part + "." + signature

def verify_session(value):
    try:
        payload_b64, signature = value.split(".")
        if len(value) > 1200:
            return None
        expected = b64(hmac.new(SECRET, payload_b64.encode("ascii"), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            return None
        claims = json.loads(unb64(payload_b64))
        if (claims.get("aud") != "hermes-selene"
            or claims.get("iss") != "hermes-dashboard-nous"
            or not isinstance(claims.get("exp"), int)
            or claims["exp"] <= time.time()):
            return None
        user = claims.get("sub")
        return user if isinstance(user, str) and USER_PATTERN.fullmatch(user) else None
    except (ValueError, KeyError, UnicodeError, TypeError, OverflowError):
        return None

def prune():
    now = time.time()
    for store in (STATES, CODES):
        for key in list(store):
            if store[key][0] <= now:
                store.pop(key, None)

def note(event, **fields):
    """Log only diagnostic category and HTTP status, never tokens, IDs or URLs."""
    safe = " ".join(f"{k}={v}" for k, v in fields.items())
    print(f"SeleneSSO {event} {safe}", file=sys.stderr, flush=True)

def dashboard_identity(cookie_header):
    """Verify the exact public Hermes dashboard origin used by the browser.

    The external route may be served by a different reverse-proxy backend from
    the internal Docker service. Only the official /api/auth/me session identity
    with provider=nous is accepted. Never decode or log user session cookies.
    """
    raw_cookie_names = [
        segment.split("=", 1)[0].strip()
        for segment in cookie_header.split(";") if "=" in segment
    ] if cookie_header else []
    has_hermes_cookie = any("hermes_session_" in name for name in raw_cookie_names)
    note("verify_cookie_shape", has_hermes_cookie=has_hermes_cookie, count=len(raw_cookie_names))

    def request_public():
        # http.client verifies DNS hostname + certificate using system trust store.
        conn = http.client.HTTPSConnection(KI_HOST, 443, timeout=7)
        try:
            conn.request("GET", "/api/auth/me", headers={
                "Cookie": cookie_header,
                "Accept": "application/json",
                "User-Agent": "Selene-SSO-Bridge/1.1",
            })
            response = conn.getresponse()
            return response.status, response.read(32769)
        finally:
            conn.close()

    def request_internal():
        # Fallback only if HTTPS cannot be reached; not on authentication rejection.
        conn = http.client.HTTPConnection("hermes", 9119, timeout=5)
        try:
            conn.request("GET", "/api/auth/me", headers={
                "Host": KI_HOST,
                "X-Forwarded-Proto": "https",
                "Cookie": cookie_header,
                "Accept": "application/json",
                "User-Agent": "Selene-SSO-Bridge/1.1",
            })
            response = conn.getresponse()
            return response.status, response.read(32769)
        finally:
            conn.close()

    try:
        try:
            status, body = request_public()
            via = "public_https"
        except (OSError, TimeoutError, http.client.HTTPException) as error:
            note("public_verification_unavailable", error=type(error).__name__)
            status, body = request_internal()
            via = "internal_fallback"
        note("dashboard_check", status=status, via=via)
        if status in (401, 403, 302, 303, 307, 308):
            if status == 401:
                try:
                    payload = json.loads(body)
                    reason = payload.get("reason") or payload.get("error") or "none"
                    if isinstance(reason, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,48}", reason):
                        note("dashboard_denied", reason=reason)
                except (ValueError, TypeError, AttributeError):
                    pass
            return None, "login"
        if status != 200 or len(body) > 32768:
            return None, "unavailable"
        value = json.loads(body)
        if not isinstance(value, dict) or value.get("provider") != "nous":
            note("unexpected_provider", provider_is_nous=False)
            return None, "login"
        user = value.get("user_id")
        if not isinstance(user, str) or not USER_PATTERN.fullmatch(user):
            note("invalid_identity_shape")
            return None, "login"
        return user, None
    except (OSError, ValueError, http.client.HTTPException) as error:
        note("dashboard_connection_error", kind=type(error).__name__)
        return None, "unavailable"

class Handler(BaseHTTPRequestHandler):
    server_version = "SeleneSSO/1.0"
    sys_version = ""

    def log_message(self, fmt, *args):
        # Never log query strings, one-time codes, state or cookies.
        pass

    def respond(self, status, body=b"", headers=()):
        self.send_response(status)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        for name, value in headers:
            self.send_header(name, value)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def redirect(self, url, cookie=None):
        headers = [("Location", url)]
        if cookie:
            headers.append(("Set-Cookie", cookie))
        self.respond(HTTPStatus.FOUND, headers=headers)

    def host(self):
        return self.headers.get("Host", "").split(":", 1)[0].lower()

    def cookie(self, name):
        return cookies(self.headers.get("Cookie", "")).get(name, "")

    def do_GET(self):
        parsed = urlsplit(self.path)
        route = parsed.path
        query = parse_qs(parsed.query, keep_blank_values=False)
        if route == "/health":
            return self.respond(200, b"ok")
        if route == "/verify":
            user = verify_session(self.cookie(SESSION_COOKIE))
            if not user:
                return self.respond(401, b"Unauthorized")
            return self.respond(204, headers=[("X-Sso-User", user)])
        if route == PREFIX + "/start":
            browser_host = self.host()
            if browser_host not in (KI_HOST, SELENE_HOST):
                return self.respond(404, b"Not found")
            with LOCK:
                prune()
                if len(STATES) >= 512:
                    return self.respond(429, b"Try again")
                state = secrets.token_urlsafe(32)
                STATES[state] = (time.time() + PENDING_SECONDS, 0, browser_host)
            dest = KI_ORIGIN + PREFIX + "/authorize?" + urlencode({"state": state})
            cookie = STATE_COOKIE + "=" + state + "; Path=/; Max-Age=300; Secure; HttpOnly; SameSite=Lax"
            return self.redirect(dest, cookie)
        if route == PREFIX + "/authorize":
            if self.host() != KI_HOST:
                return self.respond(404, b"Not found")
            state = query.get("state", [""])[0]
            if not STATE_PATTERN.fullmatch(state):
                return self.respond(400, b"Invalid authorization")
            with LOCK:
                prune()
                if state not in STATES:
                    return self.respond(400, b"Expired authorization")
            user, error = dashboard_identity(self.headers.get("Cookie", ""))
            if error == "login":
                with LOCK:
                    pending = STATES.get(state)
                    if pending is None:
                        return self.respond(400, b"Expired authorization")
                    attempts = pending[1]
                    if attempts >= 1:
                        note("login_rejected_after_oauth")
                        return self.respond(401, b"Nous session was not accepted by Hermes. Please sign in at https://ki.lorzen.net first, verify that the dashboard opens, and restart at https://selene-sso.lorzen.net.")
                    STATES[state] = (pending[0], attempts + 1, pending[2])
                target = PREFIX + "/authorize?" + urlencode({"state": state})
                login_url = KI_ORIGIN + "/auth/login?" + urlencode({"provider": "nous", "next": target})
                note("redirect_to_nous_oauth")
                return self.redirect(login_url)
            if error:
                return self.respond(503, b"Authentication service unavailable")
            note("dashboard_identity_verified")
            with LOCK:
                prune()
                if state not in STATES or len(CODES) >= 512:
                    return self.respond(400, b"Expired authorization")
                browser_host = STATES[state][2]
                if browser_host not in (KI_HOST, SELENE_HOST):
                    return self.respond(403, b"Invalid login destination")
                code = secrets.token_urlsafe(36)
                CODES[code] = (time.time() + 90, state, user, browser_host)
            browser_origin = KI_ORIGIN if browser_host == KI_HOST else SELENE_ORIGIN
            dest = browser_origin + PREFIX + "/callback?" + urlencode({"code": code, "state": state})
            return self.redirect(dest)
        if route == PREFIX + "/callback":
            if self.host() not in (KI_HOST, SELENE_HOST):
                return self.respond(404, b"Not found")
            code = query.get("code", [""])[0]
            state = query.get("state", [""])[0]
            if not code or not state or self.cookie(STATE_COOKIE) != state:
                return self.respond(403, b"Invalid browser session")
            with LOCK:
                prune()
                entry = CODES.pop(code, None)
                pending = STATES.pop(state, None)
            if (not entry or not pending or entry[1] != state
                or entry[3] != self.host() or pending[2] != self.host()):
                return self.respond(403, b"Invalid or expired login")
            value = mint_session(entry[2])
            cookie = SESSION_COOKIE + "=" + value + "; Path=/; Max-Age=3600; Secure; HttpOnly; SameSite=Lax"
            browser_origin = KI_ORIGIN if self.host() == KI_HOST else SELENE_ORIGIN
            return self.redirect(browser_origin + "/", cookie)
        if route == PREFIX + "/logout":
            if self.host() not in (KI_HOST, SELENE_HOST):
                return self.respond(404, b"Not found")
            clear = SESSION_COOKIE + "=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax"
            return self.redirect(KI_ORIGIN + "/auth/logout", clear)
        return self.respond(404, b"Not found")

    def do_POST(self):
        self.respond(405, b"Method not allowed")

if __name__ == "__main__":
    port = int(os.getenv("SELENE_SSO_PORT", "8181"))
    print("Selene SSO bridge ready on port " + str(port), flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
