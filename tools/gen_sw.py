"""Writes sw.js with the list of app files and a version = hash of their contents.
Run before deploying (the GitHub workflow does it automatically)."""
import hashlib, json, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
files = ['index.html', 'manifest.webmanifest'] + sorted(str(p.relative_to(root)) for d in ('css', 'js', 'icons', 'img') for p in (root / d).rglob('*') if p.is_file())
h = hashlib.sha1()
for f in files: h.update((root / f).read_bytes())
tpl = (root / 'tools' / 'sw.template.js').read_text()
out = tpl.replace('__VERSION__', 'ramzan-' + h.hexdigest()[:10]).replace('__FILES__', json.dumps(['./'] + ['./' + f for f in files], indent=1))
(root / 'sw.js').write_text(out)
print('sw.js written:', len(files), 'files, version', h.hexdigest()[:10])
