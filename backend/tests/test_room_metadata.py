import pytest
from pydantic import ValidationError

from app.schemas.room_metadata import RoomMetadataMixin


def test_defaults_are_none():
    m = RoomMetadataMixin()
    assert m.room_type is None and m.installation_standard is None


def test_blank_becomes_none_and_trimmed():
    m = RoomMetadataMixin(room_type="  ", installation_standard=" RAL-RG 678 ")
    assert m.room_type is None
    assert m.installation_standard == "RAL-RG 678"


def test_length_limits():
    with pytest.raises(ValidationError):
        RoomMetadataMixin(room_type="x" * 81)
    with pytest.raises(ValidationError):
        RoomMetadataMixin(installation_standard="x" * 201)
