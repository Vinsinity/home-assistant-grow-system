"""Readiness rules for starting a monitored cultivation."""

from __future__ import annotations

from typing import Any


MONITORING_REQUIREMENTS = (
    ("temperature", "Ortam sıcaklığı", "temperature_sensors", None),
    ("humidity", "Nem", "humidity_sensors", None),
    ("ph", "pH", "ph_sensor", "atlas_ph"),
    ("nutrient", "Besin yoğunluğu (EC/PPM)", "ppm_sensor", "atlas_ec"),
    ("water_temperature", "Su sıcaklığı", "water_temperature_sensor", "atlas_rtd"),
    ("dissolved_oxygen", "Suda çözünmüş oksijen", "do_sensor", "atlas_do"),
)


def _has_entity(value: Any) -> bool:
    """Return whether an entity mapping contains at least one entity."""
    if isinstance(value, list):
        return any(isinstance(item, str) and item for item in value)
    return isinstance(value, str) and bool(value)


def cultivation_readiness(entities: dict, hardware: dict) -> dict:
    """Build the minimum monitoring checklist for cultivation start."""
    assignments = hardware.get("device_assignments", [])
    enrolled_drivers = {
        str(item.get("driver"))
        for item in assignments
        if isinstance(item, dict) and item.get("driver")
    }
    requirements = []
    for key, label, entity_key, native_driver in MONITORING_REQUIREMENTS:
        mapped = _has_entity(entities.get(entity_key))
        native = bool(native_driver and native_driver in enrolled_drivers)
        requirements.append({
            "key": key,
            "label": label,
            "ready": mapped or native,
            "source": "Yerel I²C" if native else ("Home Assistant" if mapped else ""),
        })
    missing = [item for item in requirements if not item["ready"]]
    return {
        "ready": not missing,
        "requirements": requirements,
        "ready_count": len(requirements) - len(missing),
        "required_count": len(requirements),
        "missing": missing,
    }
