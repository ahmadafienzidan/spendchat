export const CSS = `
:root {
  color-scheme: light;
  --page: #f9f9f7;
  --surface: #fcfcfb;
  --ink: #0b0b0b;
  --ink-2: #52514e;
  --muted: #898781;
  --grid: #e1e0d9;
  --border: rgba(11, 11, 11, 0.1);
  --bar: #2a78d6;
  --danger: #d03b3b;
  --up: #006300;
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --page: #0d0d0d;
    --surface: #1a1a19;
    --ink: #ffffff;
    --ink-2: #c3c2b7;
    --muted: #898781;
    --grid: #2c2c2a;
    --border: rgba(255, 255, 255, 0.1);
    --bar: #3987e5;
    --danger: #e66767;
    --up: #0ca30c;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--page);
  color: var(--ink);
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
}
main { max-width: 720px; margin: 0 auto; padding: 16px; }
a { color: var(--bar); }
nav { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 16px; }
nav h1 { font-size: 18px; margin: 0; }
nav a { font-size: 24px; line-height: 1; padding: 8px 14px; text-decoration: none; }
h2 { font-size: 14px; font-weight: 600; margin: 0 0 12px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin-bottom: 16px; }
.muted { color: var(--muted); }
.secondary { color: var(--ink-2); }
.hero { font-size: 32px; font-weight: 700; margin: 4px 0; }
.stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.num { font-variant-numeric: tabular-nums; }
.up { color: var(--danger); }
.down { color: var(--up); }
.daily { display: flex; align-items: flex-end; gap: 2px; height: 120px; border-bottom: 1px solid var(--grid); }
.day { position: relative; flex: 1; height: 100%; display: flex; align-items: flex-end; outline: none; }
.day .bar { width: 100%; background: var(--bar); border-radius: 4px 4px 0 0; min-height: 0; }
.day:hover::after, .day:focus::after {
  content: attr(data-tip);
  position: absolute; bottom: calc(100% + 4px); left: 50%; transform: translateX(-50%);
  background: var(--ink); color: var(--page); padding: 2px 6px; border-radius: 6px;
  font-size: 12px; white-space: nowrap; z-index: 1;
}
.axis { display: flex; justify-content: space-between; font-size: 12px; margin-top: 4px; }
.cats { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.cats a { display: grid; grid-template-columns: 1fr auto; gap: 4px 8px; color: inherit; text-decoration: none; }
.cats .track { grid-column: 1 / -1; height: 8px; background: var(--grid); border-radius: 4px; overflow: hidden; }
.cats .fill { display: block; height: 100%; background: var(--bar); border-radius: 4px; }
.cats a[aria-current="true"] .cat-name { font-weight: 700; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 8px 4px; border-bottom: 1px solid var(--grid); vertical-align: top; }
td.amount, th.amount { text-align: right; }
details summary { cursor: pointer; color: var(--bar); font-size: 13px; }
form.stack { display: grid; gap: 8px; margin-top: 8px; }
form.inline { display: inline; }
input, button, select { font: inherit; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--page); color: var(--ink); }
button { background: var(--bar); color: #ffffff; border: none; cursor: pointer; }
button.danger { background: transparent; color: var(--danger); border: 1px solid var(--danger); }
.error { color: var(--danger); }
`;
