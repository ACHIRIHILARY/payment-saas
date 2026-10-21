import sys
from html import escape

OUT = sys.argv[1]
W, H = 1760, 1310
RX, RY = 150, 25
parts = []
add = parts.append

EXT = {  # chip letter -> (name, color)
    "C": ("Custodian / BTCPay Server", "#b45309"),
    "K": ("KYC (Sumsub / Persona)", "#0369a1"),
    "A": ("AML (Chainalysis / TRM)", "#b91c1c"),
    "E": ("Exchange / Broker APIs", "#4d7c0f"),
    "S": ("Scheduler (pg_cron)", "#475569"),
}

def text(x, y, s, size=13, weight="normal", fill="#0f172a", anchor="middle", style=""):
    add(f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{fill}" '
        f'text-anchor="{anchor}" {style}>{escape(s)}</text>')

def package(x, y, w, h, title, fill, stroke):
    add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="{fill}" stroke="{stroke}" stroke-width="2"/>')
    add(f'<rect x="{x}" y="{y}" width="{len(title)*8+28}" height="26" rx="10" fill="{stroke}"/>')
    text(x + 14, y + 18, title, 13, "bold", "#ffffff", "start")

cases = {}
def case(key, cx, cy, label, stroke, chips=""):
    cases[key] = (cx, cy)
    later.append((cx, cy, label, stroke, chips))

def draw_cases():
    for cx, cy, label, stroke, chips in later:
        add(f'<ellipse cx="{cx}" cy="{cy}" rx="{RX}" ry="{RY}" fill="#ffffff" stroke="{stroke}" stroke-width="1.8"/>')
        text(cx, cy + 4.5, label, 13, "600")
        for i, c in enumerate(chips):
            px, py = cx + RX - 14 - i * 21, cy - RY + 1
            add(f'<circle cx="{px}" cy="{py}" r="9.5" fill="{EXT[c][1]}" stroke="#fff" stroke-width="1.5"/>')
            text(px, py + 3.6, c, 10.5, "bold", "#ffffff")

def actor(x, y, label, color, sub=None):
    add(f'<g stroke="{color}" stroke-width="2.6" fill="none" stroke-linecap="round">'
        f'<circle cx="{x}" cy="{y-40}" r="13" fill="#ffffff"/>'
        f'<line x1="{x}" y1="{y-27}" x2="{x}" y2="{y+8}"/>'
        f'<line x1="{x-22}" y1="{y-14}" x2="{x+22}" y2="{y-14}"/>'
        f'<line x1="{x}" y1="{y+8}" x2="{x-16}" y2="{y+38}"/>'
        f'<line x1="{x}" y1="{y+8}" x2="{x+16}" y2="{y+38}"/></g>')
    text(x, y + 58, label, 14, "bold", color)
    if sub:
        text(x, y + 74, sub, 11, "normal", "#475569")

def assoc(p, q, color):
    add(f'<line x1="{p[0]}" y1="{p[1]}" x2="{q[0]}" y2="{q[1]}" stroke="{color}" stroke-width="1.6" opacity="0.75"/>')

def left(k):  return (cases[k][0] - RX, cases[k][1])
def right(k): return (cases[k][0] + RX, cases[k][1])

def include(p, q, label="«include»", lx=None, ly=None, curve=None):
    if curve:
        d = f'M{p[0]},{p[1]} Q{curve[0]},{curve[1]} {q[0]},{q[1]}'
    else:
        d = f'M{p[0]},{p[1]} L{q[0]},{q[1]}'
    add(f'<path d="{d}" fill="none" stroke="#334155" stroke-width="1.4" stroke-dasharray="6 4" marker-end="url(#arrow)"/>')
    if label:
        lx = lx if lx is not None else (p[0] + q[0]) / 2
        ly = ly if ly is not None else (p[1] + q[1]) / 2 - 5
        text(lx, ly, label, 10.5, "normal", "#334155", style='font-style="italic"')

later = []

# ---------- defs / background ----------
add(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" '
    f'font-family="Segoe UI, Inter, Helvetica, Arial, sans-serif">')
add('<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">'
    '<path d="M0,0 L10,5 L0,10 z" fill="#334155"/></marker>'
    '<marker id="gen" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="14" markerHeight="14" orient="auto">'
    '<path d="M0,0 L12,6 L0,12 z" fill="#ffffff" stroke="#1d4ed8" stroke-width="1.4"/></marker></defs>')
add(f'<rect width="{W}" height="{H}" fill="#f8fafc"/>')
text(W / 2, 36, "Use Case Diagram — Crypto Deposit & Managed Yield Platform", 24, "bold")
text(W / 2, 60, "Actors, use cases and integrations for the React + Supabase system (see docs/ARCHITECTURE.md)", 13, "normal", "#475569")

# ---------- system boundary ----------
add('<rect x="210" y="80" width="1300" height="1000" rx="18" fill="#ffffff" stroke="#334155" stroke-width="2.4"/>')
text(1490, 104, "«system»  Platform boundary", 13, "bold", "#334155", "end")

# ---------- packages ----------
package(240, 120, 380, 260, "Account & Security", "#eff6ff", "#2563eb")
package(240, 400, 380, 310, "Wallet", "#f0fdf4", "#16a34a")
package(240, 730, 380, 310, "Investing", "#f5f3ff", "#7c3aed")
package(660, 120, 380, 940, "Platform Services (automated)", "#f8fafc", "#64748b")
package(1080, 120, 400, 330, "Operations & Compliance", "#fff7ed", "#ea580c")
package(1080, 470, 400, 330, "Fund & Treasury", "#f0fdfa", "#0d9488")
package(1080, 820, 400, 240, "Administration", "#fff1f2", "#e11d48")

A, M, C = 430, 850, 1280
B, G, P, S, O, T, R = "#2563eb", "#16a34a", "#7c3aed", "#64748b", "#ea580c", "#0d9488", "#e11d48"
case("register", A, 172, "Register account", B)
case("signin", A, 226, "Sign in (email + 2FA)", B)
case("kyc", A, 280, "Complete KYC verification", B, "K")
case("security", A, 334, "Manage security & devices", B)

case("addr", A, 452, "Get deposit address", G, "C")
case("deposit", A, 506, "Deposit crypto", G)
case("balances", A, 560, "View balances & activity", G)
case("wladdr", A, 614, "Manage withdrawal addresses", G)
case("withdraw", A, 668, "Request withdrawal", G)

case("browse", A, 782, "Browse strategies & risks", P)
case("subscribe", A, 836, "Subscribe to strategy", P)
case("redeem", A, 890, "Redeem units", P)
case("perf", A, 944, "View performance & NAV", P)
case("statements", A, 998, "Download statements", P, "S")

case("2fa", M, 230, "Verify 2FA challenge", S)
case("kycsync", M, 320, "Sync KYC status", S, "K")
case("confirm", M, 470, "Confirm on-chain deposit", S, "C")
case("aml", M, 560, "Screen funds & addresses", S, "A")
case("ledger", M, 660, "Post immutable ledger entries", S)
case("realtime", M, 760, "Push real-time balance updates", S)
case("nav", M, 860, "Apply latest published NAV", S)
case("por", M, 1018, "Show proof of reserves (public)", S, "C")

case("reviewkyc", C, 172, "Review KYC cases", O, "K")
case("hold", C, 226, "Place compliance hold", O)
case("lookup", C, 280, "Look up customer (read-only)", O)
case("approve", C, 334, "Approve withdrawal (2-person)", O)
case("payout", C, 388, "Execute payout", O, "C")

case("snapshot", C, 522, "Snapshot holdings", T, "SEC")
case("draftnav", C, 576, "Draft daily NAV", T)
case("publish", C, 630, "Approve & publish NAV", T)
case("fees", C, 684, "Charge mgmt / performance fees", T)
case("recon", C, 738, "Run reconciliation", T, "SC")

case("roles", C, 876, "Manage staff roles", R)
case("tenant", C, 930, "Configure tenant & strategies", R)
case("audit", C, 984, "Review audit log", R)

# ---------- associations (drawn under the ellipses) ----------
inv = (134, 545)
for k in ["register", "signin", "kyc", "security", "addr", "deposit", "balances", "wladdr",
          "withdraw", "browse", "subscribe", "redeem", "perf", "statements"]:
    assoc(inv, left(k), "#1d4ed8")
vis = (132, 1172)
assoc(vis, left("browse"), "#0f766e")
assoc(vis, left("por"), "#0f766e")

staff = {
    "Compliance": (1580, 190, "#c2410c", ["reviewkyc", "hold"], "Officer"),
    "Support": (1695, 300, "#9a3412", ["lookup"], "Agent"),
    "Operations": (1580, 405, "#ea580c", ["approve", "payout"], "Staff"),
    "Finance": (1625, 640, "#0f766e", ["draftnav", "publish", "fees", "recon"], "Manager"),
    "Admin": (1625, 935, "#be123c", ["roles", "tenant", "audit"], "Super-user"),
}
for name, (x, y, col, ks, sub) in staff.items():
    for k in ks:
        assoc((x - 24, y - 12), right(k), col)

# ---------- include relationships ----------
include(right("signin"), left("2fa"), lx=640, ly=219)
include(right("kyc"), left("kycsync"), lx=640, ly=292)
include(right("deposit"), left("confirm"), lx=640, ly=481)
include(right("withdraw"), (M - RX + 10, 245), label="«include»", lx=652, ly=430)
include(right("withdraw"), left("aml"), lx=640, ly=606)
include(right("subscribe"), left("nav"), lx=640, ly=842)
include(right("redeem"), (M - RX + 4, 868), label="")
include((M, 470 + RY), (M, 560 - RY), lx=M + 42, ly=520)
include((M + RX - 6, 478), (M + RX - 8, 652), curve=(M + RX + 40, 565), lx=M + RX + 8, ly=600)
include((M, 660 + RY), (M, 760 - RY), label="«trigger»", lx=M + 40, ly=714)
include(left("payout"), (M + RX - 4, 652), lx=1065, ly=560)
include(left("fees"), (M + RX, 664), lx=1060, ly=690)
include((C - RX + 4, 640), (C - RX + 4, 730), curve=(C - RX - 40, 685), lx=C - RX - 4, ly=716)

draw_cases()

# ---------- actors ----------
actor(110, 560, "Investor", "#1d4ed8", "Registered user")
actor(110, 1190, "Visitor", "#0f766e", "Public, not signed in")
add('<line x1="110" y1="638" x2="110" y2="1132" stroke="#1d4ed8" stroke-width="1.8" marker-end="url(#gen)"/>')
text(122, 890, "is a", 11, "normal", "#1d4ed8", "start", 'font-style="italic"')
for name, (x, y, col, ks, sub) in staff.items():
    actor(x, y, name, col, sub)

# ---------- external systems ----------
text(860, 1112, "External systems («system» actors) — linked to use cases by the coloured chips", 13, "bold", "#334155")
for i, (k, (name, col)) in enumerate(EXT.items()):
    x = 330 + i * 236
    add(f'<rect x="{x}" y="1128" width="220" height="62" rx="10" fill="#ffffff" stroke="{col}" stroke-width="2"/>')
    add(f'<circle cx="{x+22}" cy="1159" r="12" fill="{col}"/>')
    text(x + 22, 1163.5, k, 12, "bold", "#ffffff")
    text(x + 126, 1151, "«system»", 10.5, "normal", "#64748b")
    text(x + 126, 1170, name, 11.5, "bold", col)

# ---------- legend ----------
lx, ly = 330, 1214
add(f'<rect x="{lx}" y="{ly}" width="1180" height="78" rx="10" fill="#ffffff" stroke="#cbd5e1"/>')
text(lx + 16, ly + 22, "Legend", 13, "bold", "#0f172a", "start")
add(f'<line x1="{lx+20}" y1="{ly+48}" x2="{lx+70}" y2="{ly+48}" stroke="#1d4ed8" stroke-width="1.8"/>')
text(lx + 80, ly + 52, "Association (actor uses case)", 12, "normal", "#334155", "start")
add(f'<path d="M{lx+290},{ly+48} L{lx+340},{ly+48}" stroke="#334155" stroke-width="1.4" stroke-dasharray="6 4" marker-end="url(#arrow)"/>')
text(lx + 350, ly + 52, "«include» / «trigger» (always runs)", 12, "normal", "#334155", "start")
add(f'<line x1="{lx+590}" y1="{ly+48}" x2="{lx+636}" y2="{ly+48}" stroke="#1d4ed8" stroke-width="1.8" marker-end="url(#gen)"/>')
text(lx + 650, ly + 52, "Generalisation", 12, "normal", "#334155", "start")
add(f'<circle cx="{lx+780}" cy="{ly+48}" r="9" fill="#b45309"/>')
text(lx + 780, ly + 52, "C", 10, "bold", "#fff")
text(lx + 796, ly + 52, "External integration", 12, "normal", "#334155", "start")
sw = [("#2563eb", "Account"), ("#16a34a", "Wallet"), ("#7c3aed", "Invest"), ("#ea580c", "Ops"), ("#0d9488", "Fund"), ("#e11d48", "Admin")]
for i, (col, nm) in enumerate(sw):
    x = lx + 940 + (i % 3) * 78
    y = ly + 30 + (i // 3) * 26
    add(f'<rect x="{x}" y="{y}" width="12" height="12" rx="3" fill="{col}"/>')
    text(x + 17, y + 11, nm, 11, "normal", "#334155", "start")
text(lx + 16, ly + 70, "Rule: no actor can edit balances directly. Every balance change flows through “Post immutable ledger entries”.",
     11.5, "normal", "#b91c1c", "start")

add('</svg>')
open(OUT, "w", encoding="utf-8").write("\n".join(parts))
print("ok", OUT)
