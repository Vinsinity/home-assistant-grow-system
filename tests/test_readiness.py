"""Tests for cultivation monitoring readiness."""

import importlib.util
from pathlib import Path


MODULE = Path(__file__).parents[1] / "custom_components/hydroponic_system/readiness.py"
SPEC = importlib.util.spec_from_file_location("readiness", MODULE)
readiness = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(readiness)
cultivation_readiness = readiness.cultivation_readiness


def test_readiness_accepts_native_atlas_for_water_measurements():
    entities = {
        "temperature_sensors": ["sensor.tent_temperature"],
        "humidity_sensors": ["sensor.tent_humidity"],
    }
    hardware = {"device_assignments": [
        {"driver": "atlas_ph"}, {"driver": "atlas_ec"},
        {"driver": "atlas_rtd"}, {"driver": "atlas_do"},
    ]}
    result = cultivation_readiness(entities, hardware)
    assert result["ready"] is True
    assert result["ready_count"] == 6


def test_readiness_reports_each_missing_core_measurement():
    result = cultivation_readiness({}, {"device_assignments": []})
    assert result["ready"] is False
    assert result["ready_count"] == 0
    assert [item["key"] for item in result["missing"]] == [
        "temperature", "humidity", "ph", "nutrient",
        "water_temperature", "dissolved_oxygen",
    ]


def test_enrolled_but_offline_native_sensor_is_not_ready():
    entities = {
        "temperature_sensors": ["sensor.tent_temperature"],
        "humidity_sensors": ["sensor.tent_humidity"],
    }
    hardware = {"device_assignments": [{"driver": "atlas_ph"}]}
    result = cultivation_readiness(entities, hardware, live_native_drivers=set())
    assert result["ready"] is False
    assert "ph" in [item["key"] for item in result["missing"]]
