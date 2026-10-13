# Verifying a Polysite webhook in Python (standard library only). `raw_body` is the request body exactly as received (bytes).
import hashlib
import hmac
import sys
import time


def verify_polysite(secret: str, raw_body: bytes, headers: dict, tolerance_seconds: int = 300, now=None) -> bool:
    timestamp = headers.get("X-Polysite-Timestamp")
    signature = headers.get("X-Polysite-Signature")
    if not timestamp or not signature:
        return False
    if abs((now if now is not None else time.time()) - float(timestamp)) > tolerance_seconds:
        return False  # too old (or from the future): a replay
    expected = "sha256=" + hmac.new(secret.encode(), timestamp.encode() + b"." + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


if len(sys.argv) > 4:  # self-check used by the plugin's tests: verify.py <secret> <timestamp> <body> <signature>
    secret, ts, body, sig = sys.argv[1:5]
    h = {"X-Polysite-Timestamp": ts, "X-Polysite-Signature": sig}
    print("ok" if verify_polysite(secret, body.encode(), h, now=float(ts) + 5) else "fail")
    print("BAD" if verify_polysite(secret, body.encode() + b" ", h, now=float(ts) + 5) else "tamper-rejected")
    print("BAD" if verify_polysite(secret, body.encode(), h, now=float(ts) + 3600) else "replay-rejected")
