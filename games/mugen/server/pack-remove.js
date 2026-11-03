import { lstatSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { isUtf8 } from 'node:buffer';
import { parseSections, walk } from './catalog.js';

const fail = (message, status) => Object.assign(new Error(message), { status });

export function removeCharacter({ catalog, path }) {
  catalog.invalidate();
  const entry = typeof path === 'string' && catalog.character(path);
  if (!entry) throw fail('unknown_character', 404);
  const root = resolve(catalog.roots.characters);
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || /[\\:]/.test(part)))
    throw fail('invalid_pack_path', 400);
  let target = root;
  // Refuse links in every component, including the catalog root.
  for (const part of ['', ...parts]) {
    target = part ? resolve(target, part) : target;
    if ((target !== root && !target.startsWith(root + sep)) || lstatSync(target).isSymbolicLink())
      throw fail('invalid_pack_path', 400);
  }
  const folder = dirname(target);
  const prefix = path.slice(0, path.lastIndexOf('/') + 1);
  const others = catalog.characters().filter((item) => item.path !== path && item.path.startsWith(prefix));
  if (folder !== root && !others.length) {
    rmSync(folder, { recursive: true });
  } else {
    // Several fighters can share assets. Remove this fighter's definitions,
    // including older same-name variants hidden by the canonical catalog.
    for (const [file] of walk(folder)) {
      if (file.includes('/') || !/\.def$/i.test(file)) continue;
      const full = join(folder, file);
      const data = readFileSync(full);
      const sections = parseSections(data.toString(isUtf8(data) ? 'utf8' : 'latin1'));
      const info = sections.get('info');
      const name = info?.get('displayname') || info?.get('name');
      if (full === target || (sections.get('files')?.has('sprite') && name?.slice(0, 64) === entry.name))
        rmSync(full);
    }
  }
  catalog.invalidate();
  return entry;
}
