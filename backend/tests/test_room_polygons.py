"""Schema-level tests for editable room polygons (no database needed)."""

import pytest
from pydantic import ValidationError

from app.schemas.project import FloorPlanData, RoomPlanItem

SQUARE = [(10, 10), (110, 10), (110, 90), (10, 90)]
BASE = {"id": "r1", "name": "Hall", "x": 10, "y": 10, "width": 100, "height": 80}


def room(**changes):
    return RoomPlanItem(**{**BASE, **changes})


def test_legacy_rectangle_room_still_valid():
    item = room()
    assert item.polygon is None and item.holes == []
    assert item.source == "manual" and item.needs_review is False
    assert FloorPlanData(rooms=[BASE]).rooms[0].polygon is None


def test_detected_polygon_round_trips():
    ell = [(10, 10), (110, 10), (110, 50), (60, 50), (60, 90), (10, 90)]
    item = room(polygon=ell, source="detected", needs_review=True)
    dumped = item.model_dump()
    assert RoomPlanItem(**dumped).polygon == ell
    assert dumped["needs_review"] is True


def test_collinear_vertices_and_concave_outlines_are_allowed():
    notched = [(10, 10), (60, 10), (110, 10), (110, 90), (60, 90), (60, 50), (10, 50)]
    assert room(polygon=notched, height=80).polygon == notched


def test_multiple_disjoint_holes_are_allowed():
    holes = [
        [(20, 20), (30, 20), (30, 30), (20, 30)],
        [(60, 40), (80, 40), (80, 60), (60, 60)],
    ]
    assert len(room(polygon=SQUARE, holes=holes).holes) == 2


def test_sub_tolerance_bbox_float_noise_is_accepted():
    assert room(polygon=SQUARE, x=10 + 1e-4, width=100 - 1e-4).width == pytest.approx(100, abs=1e-3)


def test_holes_are_kept_with_polygon():
    hole = [(30, 30), (40, 30), (40, 40), (30, 40)]
    assert room(polygon=SQUARE, holes=[hole]).holes == [hole]


@pytest.mark.parametrize(
    "changes",
    [
        {"polygon": [(10, 10), (110, 90), (110, 10), (10, 90)]},  # bow-tie
        {"polygon": [(10, 10), (60, 10), (110, 10)]},  # zero area
        {"polygon": SQUARE[:2]},  # too few points
        {"polygon": SQUARE, "width": 50},  # bbox mismatch
        {
            "polygon": [(10, 10), (110, 10), (110, 90), (10, 1200)],
            "height": 80,
        },  # outside canvas
        {"holes": [[(30, 30), (40, 30), (40, 40)]]},  # holes without polygon
        {
            "polygon": SQUARE,
            "holes": [[(30, 30), (40, 40), (40, 30), (30, 40)]],
        },  # self-intersecting hole
        {"polygon": [(10 + i % 50, 10 + i % 7) for i in range(201)]},  # too many vertices
        {"polygon": SQUARE, "source": "scanner"},
        {"polygon": [*SQUARE, SQUARE[0]]},  # closing point repeated
        {"polygon": [(10, 10), (110, 10), (110, 10), (110, 90), (10, 90)]},  # repeated vertex
        {
            "polygon": [(10, 10), (110, 10), (110, 10 + 1e-9), (110, 90), (10, 90)]
        },  # near-duplicate vertex
        {
            "polygon": [(10, 10), (110, 10), (60, 10), (110, 90), (10, 90)]
        },  # spike folding back on an edge
        {
            "polygon": [(10, 10), (110, 10), (110, 90), (60, 10), (60, 90), (10, 90)]
        },  # vertex touches edge
        {
            "polygon": [
                (10, 10),
                (110, 10),
                (110, 50),
                (10, 50),
                (10, 50 + 0.0),
                (10, 90),
            ]
        },  # repeated vertex via zero edge
        {
            "polygon": [
                (10, 10),
                (50, 10),
                (110, 10),
                (110, 90),
                (60, 90),
                (10, 90),
                (10, 50),
                (60, 50),
                (60, 10),
            ]
        },  # collinear overlap
        {
            "polygon": [(10, 10), (110, 10), (float("nan"), 90), (10, 90)],
            "width": 100,
        },  # NaN
        {"polygon": [(10, 10), (110, 10), (float("inf"), 90), (10, 90)]},  # infinity
        {
            "polygon": [(10, 10), (10 + 1e-8, 10), (10, 10 + 1e-8)],
            "width": 1e-8,
            "height": 1e-8,
        },  # sliver below tolerance
        {
            "polygon": SQUARE,
            "holes": [[(0, 0), (20, 0), (20, 20), (0, 20)]],
        },  # hole outside outline
        {
            "polygon": SQUARE,
            "holes": [[(100, 50), (130, 50), (130, 70), (100, 70)]],
        },  # hole crosses outline
        {
            "polygon": SQUARE,
            "holes": [[(10, 20), (30, 20), (30, 40), (10, 40)]],
        },  # hole edge on outline
        {
            "polygon": SQUARE,
            "holes": [
                [(20, 20), (60, 20), (60, 60), (20, 60)],
                [(50, 50), (80, 50), (80, 80), (50, 80)],
            ],
        },  # holes overlap
        {
            "polygon": SQUARE,
            "holes": [
                [(20, 20), (60, 20), (60, 60), (20, 60)],
                [(30, 30), (40, 30), (40, 40), (30, 40)],
            ],
        },  # hole inside hole
        {
            "polygon": SQUARE,
            "holes": [
                [(20, 20), (40, 20), (40, 40), (20, 40)],
                [(40, 20), (60, 20), (60, 40), (40, 40)],
            ],
        },  # holes share an edge
        {"polygon": SQUARE, "holes": [[(20, 20), (30, 20)]]},  # degenerate hole
    ],
)
def test_invalid_polygons_are_rejected(changes):
    with pytest.raises(ValidationError):
        room(**changes)


def _circle(cx, cy, radius, count=200):
    import math

    return [
        (
            cx + radius * math.cos(2 * math.pi * i / count),
            cy + radius * math.sin(2 * math.pi * i / count),
        )
        for i in range(count)
    ]


def _room_from(polygon, holes=()):
    xs, ys = [p[0] for p in polygon], [p[1] for p in polygon]
    return RoomPlanItem(
        id="big",
        name="Big",
        x=min(xs),
        y=min(ys),
        width=max(xs) - min(xs),
        height=max(ys) - min(ys),
        polygon=polygon,
        holes=list(holes),
    )


def test_maximum_size_room_validates_quickly():
    import math
    import time

    holes = [
        _circle(
            500 + 250 * math.cos(2 * math.pi * i / 20),
            350 + 250 * math.sin(2 * math.pi * i / 20),
            25,
        )
        for i in range(20)
    ]
    started = time.perf_counter()
    item = _room_from(_circle(500, 350, 340), holes)
    assert time.perf_counter() - started < 1.0
    assert len(item.polygon) == 200 and len(item.holes) == 20


def test_star_and_nested_ring_worst_cases_are_checked_correctly_and_quickly():
    import math
    import time

    star = [
        (
            500 + (340 if i % 2 == 0 else 20) * math.cos(2 * math.pi * i / 200),
            350 + (340 if i % 2 == 0 else 20) * math.sin(2 * math.pi * i / 200),
        )
        for i in range(200)
    ]
    started = time.perf_counter()
    assert _room_from(star).polygon == star
    nested = [_circle(500, 350, 20 + i * 14) for i in range(20)]
    with pytest.raises(ValidationError):
        _room_from(_circle(500, 350, 340), nested)
    assert time.perf_counter() - started < 1.0


def test_hole_entirely_outside_outline_is_rejected_without_edge_contact():
    with pytest.raises(ValidationError):
        room(polygon=SQUARE, holes=[[(500, 500), (520, 500), (520, 520), (500, 520)]])
