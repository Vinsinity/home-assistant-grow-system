"""Config flow for Grow System Extension."""

from __future__ import annotations

from homeassistant import config_entries

from .const import DOMAIN


class GrowSystemConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Create a single Grow System instance."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        """Handle UI setup."""
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        if user_input is not None:
            return self.async_create_entry(title="Grow System Extension", data={})
        return self.async_show_form(step_id="user")
