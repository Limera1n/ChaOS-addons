"""Convert installed OpenMap baked art to browser assets (requires Pillow).

Usage: python scripts/import-openmap.py "E:/.../Interface/AddOns/OpenMap"
The game textures retain their original ownership; see maps/openmap/NOTICE.md.
"""
import re
import sys
import struct
from pathlib import Path
from PIL import Image

source = Path(sys.argv[1])
target = Path(__file__).resolve().parents[1] / "client/maps/openmap"
target.mkdir(parents=True, exist_ok=True)
textures = source / "Media/Textures/Forever"
data = (source / "Data/Forever/ZoneArt.lua").read_text()
keys = list(map(int, re.findall(r"\d+", data.split("column i, row j", 1)[1])))
# OpenMap's world canvas is 1002 x 668; each tile covers 510/16 units.
SCALE = 6  # One 6012 x 4008 image, with enough detail to explore individual zones.
overview = Image.new("RGBA", (1002 * SCALE, 668 * SCALE))
base = Image.new("RGBA", (1024, 768))
for index in range(12):
    with Image.open(textures / f"MapArt/947_{index + 1}.tga") as tile:
        base.paste(tile, (index % 4 * 256, index // 4 * 256))
overview.paste(base.crop((0, 0, 1002, 668)).resize(overview.size), (0, 0))
for key in keys:
    col, row = divmod(key, 256)
    data = (textures / f"MapZones/{col}_{row}.blp").read_bytes()
    if data[:4] != b"BLP2" or data[8] != 2 or data[10] != 7:
        raise ValueError("Expected OpenMap BLP2/DXT5 tiles")
    width, height, offset = struct.unpack_from("<III", data, 12)
    length = struct.unpack_from("<I", data, 84)[0]
    # Pillow's native BC3 decoder avoids its much slower Python BLP decoder.
    with Image.frombytes("RGBA", (width, height), data[offset:offset+length], "bcn", 3) as raw:
        tile = raw.crop((1, 1, 511, 511))
        left, top = round(col * 510 * SCALE / 16), round(row * 510 * SCALE / 16)
        right, bottom = round((col + 1) * 510 * SCALE / 16), round((row + 1) * 510 * SCALE / 16)
        overview.alpha_composite(tile.resize((right-left, bottom-top), Image.Resampling.LANCZOS), (left, top))
overview.convert("RGB").save(target / "overview.webp", quality=90, method=2)
(target / "LICENSE.txt").write_text((source / "LICENSE.txt").read_text())
(target / "NOTICE.md").write_text(
    "# OpenMap map art\n\nConverted from the installed OpenMap Forever addon with scripts/import-openmap.py.\n"
    "Source: https://github.com/openmap-world/openmap\n\n"
    "MapZones and MapArt preserve Blizzard Entertainment's original map art. "
    "Some gap fills in MapZones are by Santiago Reyes, credited by OpenMap "
    "(https://sreyesmaps.com/post/proyecto-atlas-de-azeroth-forever). "
    "These pictures are not covered by OpenMap's MIT software license.\n\n"
    "The source texture provenance is reproduced in SOURCE-NOTICE.md. "
    "OpenMap software/data: Copyright (c) 2026 OpenMap contributors; see LICENSE.txt.\n")
(target / "SOURCE-NOTICE.md").write_text((textures / "NOTICE.md").read_text())
print(f"Composited {len(keys)} source tiles into {target / 'overview.webp'}")
