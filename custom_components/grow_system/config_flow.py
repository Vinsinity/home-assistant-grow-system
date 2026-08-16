"""Config flow for Grow System Extension."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.helpers.selector import EntitySelector, EntitySelectorConfig

from .const import (
    CONF_CHILLER,
    CONF_CIRCULATION_FAN,
    CONF_CLIMATE,
    CONF_CO2_SENSORS,
    CONF_CO2_VALVE,
    CONF_DEHUMIDIFIER,
    CONF_DO_SENSOR,
    CONF_EXHAUST_FAN,
    CONF_HUMIDITY_SENSORS,
    CONF_INLINE_FAN,
    CONF_LIGHT,
    CONF_PH_SENSOR,
    CONF_PPM_SENSOR,
    CONF_TEMPERATURE_SENSORS,
    CONF_VPD_SENSOR,
    CONF_WATER_TEMPERATURE_SENSOR,
    CONTROL_KEYS,
    DOMAIN,
    SENSOR_KEYS,
)


def _entity(domains: str | list[str], *, multiple: bool = False) -> EntitySelector:
    return EntitySelector(EntitySelectorConfig(domain=domains, multiple=multiple))


def _optional_default(defaults: dict[str, Any], key: str):
    """Create an optional key without injecting None as a selector value."""
    if defaults.get(key) is None:
        return vol.Optional(key)
    return vol.Optional(key, default=defaults[key])


def _sensor_schema(defaults: dict[str, Any]) -> vol.Schema:
    return vol.Schema(
        {
            vol.Optional(CONF_CO2_SENSORS, default=defaults.get(CONF_CO2_SENSORS, [])): _entity("sensor", multiple=True),
            vol.Optional(CONF_TEMPERATURE_SENSORS, default=defaults.get(CONF_TEMPERATURE_SENSORS, [])): _entity("sensor", multiple=True),
            vol.Optional(CONF_HUMIDITY_SENSORS, default=defaults.get(CONF_HUMIDITY_SENSORS, [])): _entity("sensor", multiple=True),
            _optional_default(defaults, CONF_VPD_SENSOR): _entity("sensor"),
            _optional_default(defaults, CONF_PPM_SENSOR): _entity("sensor"),
            _optional_default(defaults, CONF_PH_SENSOR): _entity("sensor"),
            _optional_default(defaults, CONF_DO_SENSOR): _entity("sensor"),
            _optional_default(defaults, CONF_WATER_TEMPERATURE_SENSOR): _entity("sensor"),
        }
    )


def _control_schema(defaults: dict[str, Any]) -> vol.Schema:
    return vol.Schema(
        {
            _optional_default(defaults, CONF_LIGHT): _entity(["light", "switch"]),
            _optional_default(defaults, CONF_CO2_VALVE): _entity("switch"),
            _optional_default(defaults, CONF_EXHAUST_FAN): _entity(["fan", "switch"]),
            _optional_default(defaults, CONF_INLINE_FAN): _entity(["fan", "switch"]),
            _optional_default(defaults, CONF_CIRCULATION_FAN): _entity(["fan", "switch"]),
            _optional_default(defaults, CONF_CLIMATE): _entity("climate"),
            _optional_default(defaults, CONF_DEHUMIDIFIER): _entity(["humidifier", "switch"]),
            _optional_default(defaults, CONF_CHILLER): _entity(["climate", "switch", "water_heater"]),
        }
    )


class GrowSystemConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Create a single Grow System instance."""

    VERSION = 1

    def __init__(self) -> None:
        self._data: dict[str, Any] = {}

    async def async_step_user(self, user_input=None):
        """Start with sensor mappings."""
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        return await self.async_step_sensors(user_input)

    async def async_step_sensors(self, user_input=None):
        """Configure monitoring entities."""
        if user_input is not None:
            self._data.update(user_input)
            return await self.async_step_controls()
        return self.async_show_form(step_id="sensors", data_schema=_sensor_schema({}))

    async def async_step_controls(self, user_input=None):
        """Configure actuator entities without enabling control."""
        if user_input is not None:
            self._data.update(user_input)
            return self.async_create_entry(title="Grow System Extension", data=self._data)
        return self.async_show_form(step_id="controls", data_schema=_control_schema({}))

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return GrowSystemOptionsFlow()


class GrowSystemOptionsFlow(config_entries.OptionsFlow):
    """Edit entity mappings after setup."""

    def __init__(self) -> None:
        self._data: dict[str, Any] = {}

    def _current(self) -> dict[str, Any]:
        return {**self.config_entry.data, **self.config_entry.options}

    async def async_step_init(self, user_input=None):
        return await self.async_step_sensors(user_input)

    async def async_step_sensors(self, user_input=None):
        if user_input is not None:
            self._data.update(user_input)
            return await self.async_step_controls()
        current = self._current()
        return self.async_show_form(
            step_id="sensors",
            data_schema=_sensor_schema({key: current.get(key) for key in SENSOR_KEYS}),
        )

    async def async_step_controls(self, user_input=None):
        if user_input is not None:
            self._data.update(user_input)
            return self.async_create_entry(title="", data=self._data)
        current = self._current()
        return self.async_show_form(
            step_id="controls",
            data_schema=_control_schema({key: current.get(key) for key in CONTROL_KEYS}),
        )
