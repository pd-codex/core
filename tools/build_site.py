#!/usr/bin/env python3
"""Stage the website and reconstruct the original release ROMs from byte listings.

This is a packer, not an assembler. All output ROMs must match the original
Core 0.2 SHA-256 digests stored in the manifests before they can be published.
"""
from pathlib import Path
import hashlib
import json
import shutil

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'dist'
NAMES = ('01_conduction', '02_intent', '03_override')


def image(meta: dict) -> bytes:
    if meta['origin'] != 0xE000 or meta['size'] != 8192:
        raise ValueError('Unexpected MCU flash geometry')
    rom = bytearray([0xFF] * meta['size'])
    seen = set()
    for row in meta['listing']:
        offset = row['address'] - meta['origin']
        data = bytes(row['bytes'])
        if offset < 0 or offset + len(data) > len(rom):
            raise ValueError('Listing outside flash')
        for pos in range(offset, offset + len(data)):
            if pos in seen:
                raise ValueError('Overlapping listing records')
            seen.add(pos)
        rom[offset:offset + len(data)] = data
    if hashlib.sha256(rom).hexdigest() != meta['sha256']:
        raise ValueError('ROM does not match original release SHA-256')
    return bytes(rom)


def main() -> None:
    # Validate all images before touching a previously built site.
    roms = {}
    for name in NAMES:
        meta = json.loads((ROOT / 'firmware' / f'{name}.json').read_text())
        roms[name] = image(meta)
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / 'firmware').mkdir(parents=True)
    (OUT / 'src').mkdir()
    for name in ('index.html', 'styles.css'):
        shutil.copy2(ROOT / name, OUT / name)
    for name in ('main.js', 'core-sim.js'):
        shutil.copy2(ROOT / 'src' / name, OUT / 'src' / name)
    for name, data in roms.items():
        shutil.copy2(ROOT / 'firmware' / f'{name}.json', OUT / 'firmware' / f'{name}.json')
        (OUT / 'firmware' / f'{name}.bin').write_bytes(data)
        print(f'{name}: {len(data)} bytes, original SHA-256 verified')
    (OUT / '.nojekyll').touch()
    print('Website staged in dist/')


if __name__ == '__main__':
    main()
