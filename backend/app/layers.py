"""Tile layer registry.

All sources are NASA/JPL Mars Trek WMTS (https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars).
Tile scheme (verified): geographic EPSG:4326, z0 = 2x1 tiles of 256 px, origin at (-180, 90),
rows count from the top, longitude positive east. Same scheme as Leaflet's L.CRS.EPSG4326.
"""

from dataclasses import dataclass

TREK_URL = (
    "https://trek.nasa.gov/tiles/Mars/EQ/{trek_id}/1.0.0/default/default028mm/{z}/{y}/{x}.{ext}"
)


@dataclass(frozen=True)
class Layer:
    id: str
    trek_id: str
    title: str
    ext: str  # native format: png | jpg
    max_native_zoom: int
    bbox: tuple  # (min_lon, min_lat, max_lon, max_lat)
    resolution: str

    @property
    def mime(self) -> str:
        return "image/png" if self.ext == "png" else "image/jpeg"


GLOBAL = (-180.0, -90.0, 180.0, 90.0)

# Ordered from coarsest to finest: this is the LOD stack used by the "satellite" composite.
SATELLITE_STACK = [
    Layer(
        "viking", "Mars_Viking_MDIM21_ClrMosaic_global_232m",
        "Viking MDIM 2.1 color mosaic (global)", "jpg", 7, GLOBAL, "232 m/px",
    ),
    Layer(
        "ctx", "Gale_CTX_BlockAdj_dd",
        "MRO CTX, Gale Crater mosaic", "png", 12,
        (135.1842593, -6.5732988, 139.2413012, -2.8077809), "~6 m/px",
    ),
    Layer(
        "hirise", "curiosity_hirise_mosaic",
        "MRO HiRISE, Curiosity roving site mosaic", "png", 16,
        (137.1224669, -4.9254743, 137.7298129, -4.2489588), "~0.25-1 m/px",
    ),
]

RELIEF = Layer(
    "relief", "Mars_MGS_MOLA_ClrShade_merge_global_463m",
    "MGS MOLA color hillshade (global elevation)", "jpg", 7, GLOBAL, "463 m/px",
)

# Night-time infrared brightness (bright = warmer at night = more rock/consolidated;
# dark = colder = fine dust/loose sand). A proxy for thermal inertia, not a calibrated value.
THEMIS_NIGHT = Layer(
    "themis_night", "THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018",
    "THEMIS night infrared mosaic (thermal proxy for loose sand)", "png", 9,
    (-180.0, -65.0, 180.0, 65.0), "~100 m/px",
)

LAYERS = {layer.id: layer for layer in SATELLITE_STACK + [RELIEF, THEMIS_NIGHT]}

# Virtual layer: composite of SATELLITE_STACK, finest available data on top.
SATELLITE_ID = "satellite"

# Virtual layer: same stack, but CTX/HiRISE luminance tinted with the Viking color (approximate).
SATELLITE_COLOR_ID = "satellite_color"
# Multiplier applied to CTX/HiRISE luminance so its tone matches the Viking mosaic.
TONE_GAIN = 0.76  # measured: mean Viking luminance / mean CTX luminance over 54 Gale tiles at z9
