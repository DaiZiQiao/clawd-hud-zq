# Writes hooks/stills.ts: one still SVG per scene, shown where the shader is not
# played (the mobile app, Reduce Motion, a GPU too weak). Pure vector, seeded.
import json, math, os, random

def svg(defs, body, bg):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">'
            f'<defs>{defs}</defs><rect x="-200" y="-200" width="2000" height="1400" fill="{bg}"/>{body}</svg>')
def rg(i, c, a=0.85):
    return f'<radialGradient id="{i}"><stop offset="0" stop-color="{c}" stop-opacity="{a}"/><stop offset="1" stop-color="{c}" stop-opacity="0"/></radialGradient>'
def lg(i, stops, y2=1):
    return f'<linearGradient id="{i}" x1="0" y1="0" x2="0" y2="{y2}">' + ''.join(f'<stop offset="{o}" stop-color="{c}" stop-opacity="{a}"/>' for o, c, a in stops) + '</linearGradient>'

R = random.Random(7)
S = {}

# ink: soft clouds of glowing dye on near-black water
S['ink'] = svg(lg('bg', [(0, '#0b0a14', 1), (1, '#040408', 1)]) + rg('a', '#b44cff') + rg('b', '#3f8fff') + rg('c', '#ff8a3c', .7) + rg('d', '#3fe0a0', .7),
    '<ellipse cx="430" cy="640" rx="430" ry="190" fill="url(#a)" transform="rotate(-20 430 640)"/>'
    '<ellipse cx="900" cy="760" rx="380" ry="160" fill="url(#b)" transform="rotate(12 900 760)"/>'
    '<ellipse cx="1280" cy="300" rx="260" ry="200" fill="url(#c)"/>'
    '<ellipse cx="300" cy="260" rx="240" ry="150" fill="url(#d)" transform="rotate(25 300 260)"/>', 'url(#bg)')

# aurora: green-to-violet curtains over mountains, stars above
stars = ''.join(f'<circle cx="{R.randint(0,1600)}" cy="{R.randint(0,700)}" r="{R.choice([0.8,1,1.3,1.6])}"/>' for _ in range(90))
def curtain(y, amp, seed, h):
    r = random.Random(seed); pts = []
    for x in range(-100, 1701, 50): pts.append((x, y + amp * math.sin(x / 260 + seed) + r.uniform(-12, 12)))
    top = ' '.join(f'{x},{round(yy - h)}' for x, yy in reversed(pts)); base = ' '.join(f'{x},{round(yy)}' for x, yy in pts)
    return f'<polygon points="{base} {top}" fill="url(#cur)"/>'
S['aurora'] = svg(lg('bg', [(0, '#03081a', 1), (1, '#071322', 1)]) + lg('cur', [(0, '#8a4dff', 0), (0.55, '#7a5cff', .35), (1, '#2fffa0', .8)]),
    f'<g fill="#dfe7ff" opacity=".8">{stars}</g>' + curtain(560, 40, 1, 260) + curtain(610, 30, 2, 200) + curtain(660, 24, 3, 150) +
    '<path fill="#020509" d="M-200 1200V870L120 840 300 860 520 820 760 850 980 810 1200 845 1420 815 1800 850V1200Z"/>', 'url(#bg)')

# coral: rings and branching worms of teal and gold on deep water
worms = ''
for _ in range(70):
    x, y, r = R.randint(-20, 1620), R.randint(-20, 1020), R.uniform(10, 34)
    col = '#d9a050' if R.random() < 0.25 else '#1f8a8a'
    worms += f'<circle cx="{x}" cy="{y}" r="{r:.0f}" fill="none" stroke="{col}" stroke-width="{R.uniform(5,9):.0f}" opacity=".85"/>'
for _ in range(40):
    x, y = R.randint(0, 1600), R.randint(0, 1000)
    d = f'M{x} {y}' + ''.join(f'q{R.randint(-30,30)} {R.randint(-30,30)} {R.randint(-50,50)} {R.randint(-50,50)}' for _ in range(3))
    worms += f'<path d="{d}" fill="none" stroke="#2aa0a0" stroke-width="7" stroke-linecap="round" opacity=".8"/>'
S['coral'] = svg(lg('bg', [(0, '#06111a', 1), (1, '#03080d', 1)]), worms, 'url(#bg)')

# lava: glossy wax blobs in warm light on plum
blobs = ''
for (x, y, rx, ry) in [(330, 300, 150, 170), (520, 640, 210, 190), (1080, 260, 180, 150), (1250, 700, 230, 200), (820, 470, 110, 120)]:
    blobs += f'<ellipse cx="{x}" cy="{y}" rx="{rx*1.6:.0f}" ry="{ry*1.6:.0f}" fill="url(#glow)"/><ellipse cx="{x}" cy="{y}" rx="{rx}" ry="{ry}" fill="url(#wax)"/>'
S['lava'] = svg(lg('bg', [(0, '#2a0820', 1), (1, '#0f040e', 1)]) + rg('glow', '#ff4a5a', .35) +
    '<radialGradient id="wax" cx=".38" cy=".35" r=".7"><stop offset="0" stop-color="#ffc070"/><stop offset=".55" stop-color="#ff7a2e"/><stop offset="1" stop-color="#c2241a"/></radialGradient>', blobs, 'url(#bg)')

# meadow: painted cumulus over blue mountains, hills with round trees, grass
def cloud(cx, cy, w, h):
    puffs = [(-0.42, 0.25, 0.5), (-0.25, 0.55, 0.62), (0, 0.8, 0.75), (0.22, 0.6, 0.6), (0.42, 0.3, 0.48), (-0.05, 1.25, 0.55), (0.12, 1.05, 0.5)]
    c = ''.join(f'<circle cx="{cx + dx * w:.0f}" cy="{cy - dy * h:.0f}" r="{r * h:.0f}"/>' for dx, dy, r in puffs)
    return f'<g fill="url(#cl)">{c}<rect x="{cx - 0.5 * w:.0f}" y="{cy - 0.3 * h:.0f}" width="{w:.0f}" height="{0.3 * h:.0f}"/></g>'
trees = ''.join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="#2a5a2c"/>' for x, y, r in [(140, 690, 26), (380, 700, 22), (700, 712, 28), (980, 698, 24), (1240, 705, 30), (1460, 694, 22)])
S['meadow'] = svg(lg('sky', [(0, '#3d82d8', 1), (0.6, '#a9d6ef', 1), (1, '#bfe3f2', 1)]) + rg('sun', '#fff3d0', .9) +
    lg('cl', [(0, '#ffffff', 1), (0.6, '#f4f2f2', 1), (1, '#aeb8da', 1)]) + lg('gr', [(0, '#5fa034', 1), (1, '#2f6b1e', 1)]),
    '<circle cx="1300" cy="150" r="160" fill="url(#sun)"/><circle cx="1300" cy="150" r="34" fill="#fffbec"/>' +
    cloud(420, 560, 620, 230) + cloud(1050, 430, 300, 110) +
    '<path fill="#8daed0" d="M-200 1200V610L120 590 340 560 600 600 860 570 1120 590 1380 555 1800 600V1200Z"/>'
    '<path fill="#8fbfba" d="M-200 1200V650C200 630 600 660 1000 640S1600 650 1800 645V1200Z"/>'
    '<path fill="#5f9a46" d="M-200 1200V720C200 690 600 735 1000 705S1600 720 1800 712V1200Z"/>' + trees +
    '<path fill="url(#gr)" d="M-200 1200V820C300 800 800 830 1200 810S1700 815 1800 815V1200Z"/>', 'url(#sky)')

out = os.path.join(os.path.dirname(__file__), '..', 'hooks', 'stills.ts')
with open(out, 'w') as f:
    f.write('// Generated by scripts/gen-stills.py. Edit that file and run it again, rather than this one.\n')
    f.write('// The still of each scene, shown where its shader is not played: the mobile app,\n// Reduce Motion, or a GPU too weak for it.\n')
    f.write('export const STILLS = {\n' + ''.join(f'  {k}: {json.dumps(v)},\n' for k, v in S.items()) + '} as const\n')
print({k: len(v) for k, v in S.items()})
