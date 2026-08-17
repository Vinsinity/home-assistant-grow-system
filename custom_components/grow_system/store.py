"""Persistent profile store."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DEFAULT_CULTIVATION_PLAN, DEFAULT_PROFILES, STORAGE_KEY, STORAGE_VERSION


class GrowSystemStore:
    """Store all profiles as one document instead of dozens of helpers."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store[dict[str, Any]] = Store(
            hass, STORAGE_VERSION, STORAGE_KEY
        )
        self.data: dict[str, Any] = {
            "active_stage": None,
            "engine_enabled": False,
            "profiles": deepcopy(DEFAULT_PROFILES),
            "calendar": {"journal": {}},
            "cultivation": {
                "active": False, "id": "", "name": "", "start_date": "",
                "started_at": "", "completed_at": "",
                "plan": deepcopy(DEFAULT_CULTIVATION_PLAN),
                "transitions": [], "journal": {},
            },
            "hardware": {
                "i2c_bus": 1,
                "poll_interval": 30,
                "device_assignments": [],
                "dosing_fluids": [
                    {"id": "ph_up", "name": "pH+", "required": True},
                    {"id": "ph_down", "name": "pH−", "required": True},
                ],
            },
        }

    async def async_load(self) -> None:
        """Load persisted data and merge new default fields."""
        stored = await self._store.async_load()
        if not stored:
            await self.async_save()
            return

        migrated = False
        self.data["active_stage"] = stored.get("active_stage")
        self.data["engine_enabled"] = stored.get("engine_enabled", False)
        stored_profiles = stored.get("profiles", {})
        for stage, defaults in DEFAULT_PROFILES.items():
            self.data["profiles"][stage].update(stored_profiles.get(stage, {}))
            # Profile names are canonical UI labels, not user data. Refresh old
            # persisted English labels without changing stable internal keys.
            if self.data["profiles"][stage].get("name") != defaults["name"]:
                self.data["profiles"][stage]["name"] = defaults["name"]
                migrated = True
            if stage not in stored_profiles or any(
                key not in stored_profiles.get(stage, {}) for key in defaults
            ):
                migrated = True
        self.data["hardware"].update(stored.get("hardware", {}))
        self.data["calendar"].update(stored.get("calendar", {}))
        self.data["cultivation"].update(stored.get("cultivation", {}))
        if not self.data["cultivation"].get("plan"):
            self.data["cultivation"]["plan"] = deepcopy(DEFAULT_CULTIVATION_PLAN)
            migrated = True
        else:
            plan = self.data["cultivation"]["plan"]
            known_stages = {item.get("stage") for item in plan}
            for default in DEFAULT_CULTIVATION_PLAN:
                if default["stage"] not in known_stages:
                    plan.append(deepcopy(default))
                    migrated = True
        # A stage only has operational meaning inside an active cultivation.
        # Normalize older documents that stored "darkness" while no cycle existed.
        if (
            not self.data["cultivation"].get("active")
            and self.data.get("active_stage") is not None
        ):
            self.data["active_stage"] = None
            migrated = True
        if migrated:
            await self.async_save()

    async def async_save(self) -> None:
        """Persist current data."""
        await self._store.async_save(self.data)

    async def async_update_profile(
        self, stage: str, values: dict[str, Any]
    ) -> dict[str, Any]:
        """Update one profile and return it."""
        if stage not in self.data["profiles"]:
            raise ValueError(f"Unknown stage: {stage}")
        allowed = set(DEFAULT_PROFILES[stage]) - {"name"}
        self.data["profiles"][stage].update(
            {key: value for key, value in values.items() if key in allowed}
        )
        await self.async_save()
        return self.data["profiles"][stage]

    async def async_update_hardware(self, values: dict[str, Any]) -> dict[str, Any]:
        """Persist validated native hardware preferences."""
        self.data["hardware"].update(values)
        await self.async_save()
        return self.data["hardware"]
