class GrowSystemPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._config = null;
    this._editingStage = "darkness";
    this._draft = null;
    this._saving = false;
    this._notice = "";
  }

  set hass(value) {
    this._hass = value;
    if (!this._config) this._load();
    else this._updateLiveValues();
  }

  set narrow(value) {
    this.toggleAttribute("narrow", Boolean(value));
  }

  set route(value) { this._route = value; }
  set panel(value) { this._panel = value; }

  connectedCallback() { this._render(); }

  async _load() {
    if (!this._hass || this._loading) return;
    this._loading = true;
    try {
      this._config = await this._hass.connection.sendMessagePromise({
        type: "grow_system/config/get",
      });
      this._editingStage = this._config.active_stage;
      this._draft = { ...this._config.profiles[this._editingStage] };
    } catch (error) {
      this._notice = `Profil verileri yüklenemedi: ${error.message || error}`;
    } finally {
      this._loading = false;
      this._render();
    }
  }

  _state(entityId, fallback = "—") {
    return this._hass?.states?.[entityId]?.state ?? fallback;
  }

  _reading(entityOrEntities) {
    if (entityOrEntities === "__calculated_vpd__") {
      const entities = this._config?.entities || {};
      const temperature = this._reading(entities.temperature_sensors);
      const humidity = this._reading(entities.humidity_sensors);
      if (!Number.isFinite(temperature) || !Number.isFinite(humidity)) return NaN;
      const saturation = 0.6108 * Math.exp((17.27 * temperature) / (temperature + 237.3));
      return saturation * (1 - humidity / 100);
    }
    const ids = Array.isArray(entityOrEntities)
      ? entityOrEntities
      : entityOrEntities ? [entityOrEntities] : [];
    const values = ids
      .map((entityId) => Number(this._state(entityId, "NaN")))
      .filter(Number.isFinite);
    if (!values.length) return NaN;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  _selectStage(stage) {
    this._editingStage = stage;
    this._draft = { ...this._config.profiles[stage] };
    this._notice = "";
    this._render();
  }

  _changeField(event) {
    const field = event.currentTarget.dataset.field;
    this._draft[field] = Number(event.currentTarget.value);
    this._notice = "Kaydedilmemiş değişiklikler var";
    this._updateNotice();
  }

  async _save() {
    if (!this._hass || this._saving) return;
    this._saving = true;
    this._notice = "Kaydediliyor…";
    this._updateNotice();
    try {
      const saved = await this._hass.connection.sendMessagePromise({
        type: "grow_system/profile/save",
        stage: this._editingStage,
        values: this._draft,
      });
      this._config.profiles[this._editingStage] = saved;
      this._draft = { ...saved };
      this._notice = "Profil kaydedildi";
    } catch (error) {
      this._notice = `Kaydedilemedi: ${error.message || error}`;
    } finally {
      this._saving = false;
      this._updateNotice();
    }
  }

  async _activate() {
    if (!this._hass || this._editingStage === this._config.active_stage) return;
    const name = this._draft.name;
    if (!window.confirm(`${name} aktif yetiştirme aşaması olarak seçilsin mi? Otomatik kontrol motoru kapalı kalacak.`)) return;
    await this._hass.connection.sendMessagePromise({
      type: "grow_system/stage/select",
      stage: this._editingStage,
    });
    this._config.active_stage = this._editingStage;
    this._notice = `${name} aktif aşama olarak seçildi`;
    this._render();
  }

  _updateNotice() {
    const status = this.shadowRoot?.querySelector("[data-status]");
    if (status) status.textContent = this._notice;
  }

  _field(label, key, unit, min, max, step) {
    return `
      <ha-textfield
        data-field="${key}"
        label="${label}"
        type="number"
        value="${this._draft?.[key] ?? ""}"
        min="${min}"
        max="${max}"
        step="${step}"
        suffix="${unit}">
      </ha-textfield>`;
  }

  _metric(label, icon, entity, target, unit, precision = 1) {
    const raw = this._reading(entity);
    const valid = Number.isFinite(raw);
    const delta = valid ? raw - Number(target) : null;
    return `
      <div class="metric" data-metric data-entity='${JSON.stringify(entity || [])}' data-target="${target}" data-unit="${unit}" data-precision="${precision}">
        <ha-icon icon="${icon}"></ha-icon>
        <div class="metric-name"><span>${label}</span><small>Hedef ${target} ${unit}</small></div>
        <div class="metric-value">
          <strong>${valid ? raw.toFixed(precision) : "—"}</strong><span>${valid ? unit : "Veri yok"}</span>
          <small>${valid ? `${delta >= 0 ? "+" : ""}${delta.toFixed(precision)} fark` : "Sensör eşleştirilmedi"}</small>
        </div>
      </div>`;
  }

  _updateLiveValues() {
    if (!this._config || !this.shadowRoot) return;
    this.shadowRoot.querySelectorAll("[data-metric]").forEach((row) => {
      let entity;
      try { entity = JSON.parse(row.dataset.entity); } catch { entity = []; }
      const raw = this._reading(entity);
      const precision = Number(row.dataset.precision);
      const target = Number(row.dataset.target);
      const unit = row.dataset.unit;
      const value = row.querySelector(".metric-value");
      if (!value) return;
      value.innerHTML = Number.isFinite(raw)
        ? `<strong>${raw.toFixed(precision)}</strong><span>${unit}</span><small>${raw - target >= 0 ? "+" : ""}${(raw - target).toFixed(precision)} fark</small>`
        : `<strong>—</strong><span>Veri yok</span><small>Sensör eşleştirilmedi</small>`;
    });
  }

  _render() {
    if (!this.shadowRoot) return;
    if (!this._config || !this._draft) {
      this.shadowRoot.innerHTML = `
        <style>${GrowSystemPanel.styles}</style>
        <div class="loading"><ha-circular-progress active></ha-circular-progress><span>Grow System yükleniyor…</span></div>`;
      return;
    }

    const order = ["germination", "early_veg", "veg", "bloom", "darkness"];
    const labels = {germination: "Çimlenme", early_veg: "Erken veg", veg: "Veg", bloom: "Çiçeklenme", darkness: "Karanlık"};
    const icons = {germination: "mdi:sprout", early_veg: "mdi:leaf", veg: "mdi:flower", bloom: "mdi:flower-pollen", darkness: "mdi:weather-night"};
    const active = this._config.active_stage;
    const entities = this._config.entities || {};

    const stages = order.map((stage) => {
      const profile = this._config.profiles[stage];
      return `
        <button class="stage ${stage === this._editingStage ? "selected" : ""}" data-stage="${stage}">
          <ha-icon icon="${icons[stage]}"></ha-icon>
          <span>${labels[stage]}</span>
          <small>${profile.photoperiod}/${24 - profile.photoperiod}</small>
          ${stage === active ? '<b>Aktif</b>' : ""}
        </button>`;
    }).join("");

    this.shadowRoot.innerHTML = `
      <style>${GrowSystemPanel.styles}</style>
      <main>
        <div class="page-heading">
          <div>
            <h1>Grow System</h1>
            <p>Yetiştirme profilleri ve canlı hedefler</p>
          </div>
          <div class="engine-status">
            <ha-icon icon="mdi:shield-check-outline"></ha-icon>
            <span><strong>Otomatik kontrol kapalı</strong><small>Ekipmanlara komut gönderilmiyor</small></span>
          </div>
        </div>

        <ha-card header="Yetiştirme aşaması" class="stage-card">
          <div class="card-content stage-grid">${stages}</div>
        </ha-card>

        <div class="layout">
          <section class="profile-column">
            <ha-card header="${labels[this._editingStage]} profili">
              <div class="card-content">
                <h2><ha-icon icon="mdi:white-balance-sunny"></ha-icon>Işık ve iklim</h2>
                <div class="fields">
                  ${this._field("Aydınlık süre", "photoperiod", "saat", 0, 24, 1)}
                  ${this._field("Işık şiddeti", "light_intensity", "%", 0, 100, 5)}
                  ${this._field("Gündüz sıcaklığı", "day_temperature", "°C", 10, 35, 0.5)}
                  ${this._field("Gece sıcaklığı", "night_temperature", "°C", 10, 35, 0.5)}
                </div>

                <div class="divider"></div>
                <h2><ha-icon icon="mdi:greenhouse"></ha-icon>Kabin atmosferi</h2>
                <div class="fields three">
                  ${this._field("Bağıl nem", "humidity", "%", 30, 90, 1)}
                  ${this._field("VPD", "vpd", "kPa", 0.2, 2.5, 0.05)}
                  ${this._field("CO₂", "co2", "ppm", 350, 1500, 25)}
                </div>

                <div class="divider"></div>
                <h2><ha-icon icon="mdi:water"></ha-icon>Kök bölgesi</h2>
                <div class="fields">
                  ${this._field("Besin yoğunluğu", "ppm", "ppm", 0, 2000, 10)}
                  ${this._field("Su sıcaklığı", "water_temperature", "°C", 10, 30, 0.5)}
                  ${this._field("pH", "ph", "pH", 4, 8, 0.1)}
                  ${this._field("Minimum DO", "do_minimum", "mg/L", 0, 15, 0.1)}
                </div>
              </div>
              <div class="card-actions">
                <span data-status>${this._notice}</span>
                <div>
                  <ha-button data-activate appearance="plain" ${this._editingStage === active ? "disabled" : ""}>Aktif aşama yap</ha-button>
                  <ha-button data-save appearance="filled" ${this._saving ? "disabled" : ""}>Değişiklikleri kaydet</ha-button>
                </div>
              </div>
            </ha-card>
          </section>

          <aside>
            <ha-card header="Canlı ölçümler">
              <div class="card-content metrics">
                ${this._metric("Kabin sıcaklığı", "mdi:thermometer", entities.temperature_sensors, this._draft.day_temperature, "°C")}
                ${this._metric("Nem", "mdi:water-percent", entities.humidity_sensors, this._draft.humidity, "%")}
                ${this._metric("VPD", "mdi:gauge", entities.vpd_sensor || "__calculated_vpd__", this._draft.vpd, "kPa", 2)}
                ${this._metric("CO₂", "mdi:molecule-co2", entities.co2_sensors, this._draft.co2, "ppm", 0)}
                ${this._metric("Besin", "mdi:flash", entities.ppm_sensor, this._draft.ppm, "ppm", 0)}
                ${this._metric("Su sıcaklığı", "mdi:coolant-temperature", entities.water_temperature_sensor, this._draft.water_temperature, "°C")}
                ${this._metric("pH", "mdi:ph", entities.ph_sensor, this._draft.ph, "pH", 2)}
                ${this._metric("Çözünmüş oksijen", "mdi:chart-bubble", entities.do_sensor, this._draft.do_minimum, "mg/L", 2)}
              </div>
            </ha-card>
          </aside>
        </div>
      </main>`;

    this.shadowRoot.querySelectorAll("[data-stage]").forEach((button) => {
      button.addEventListener("click", () => this._selectStage(button.dataset.stage));
    });
    this.shadowRoot.querySelectorAll("[data-field]").forEach((input) => {
      input.addEventListener("input", (event) => this._changeField(event));
    });
    this.shadowRoot.querySelector("[data-save]")?.addEventListener("click", () => this._save());
    this.shadowRoot.querySelector("[data-activate]")?.addEventListener("click", () => this._activate());
  }

  static get styles() {
    return `
      :host {
        display: block;
        min-height: 100%;
        color: var(--primary-text-color);
        background: var(--primary-background-color);
        font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif);
      }
      * { box-sizing: border-box; }
      main { max-width: 1280px; margin: 0 auto; padding: 24px 16px 48px; }
      .page-heading { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin: 0 4px 24px; }
      h1 { margin: 0; font-size: 28px; font-weight: 400; line-height: 36px; }
      .page-heading p { margin: 4px 0 0; color: var(--secondary-text-color); font-size: 14px; }
      .engine-status { display: flex; align-items: center; gap: 12px; color: var(--secondary-text-color); }
      .engine-status ha-icon { color: var(--success-color, #43a047); }
      .engine-status span, .engine-status small { display: block; }
      .engine-status strong { color: var(--primary-text-color); font-size: 14px; font-weight: 500; }
      .engine-status small { margin-top: 2px; font-size: 12px; }
      ha-card { display: block; overflow: hidden; }
      .stage-card { margin-bottom: 16px; }
      .card-content { padding: 16px; }
      .stage-grid { display: grid; grid-template-columns: repeat(5, minmax(120px, 1fr)); gap: 8px; padding-top: 0; }
      .stage { position: relative; min-height: 82px; padding: 12px; border: 1px solid var(--divider-color); border-radius: var(--ha-card-border-radius, 12px); color: var(--primary-text-color); background: var(--card-background-color); text-align: left; cursor: pointer; }
      .stage:hover { background: var(--secondary-background-color); }
      .stage.selected { border: 2px solid var(--primary-color); padding: 11px; background: color-mix(in srgb, var(--primary-color) 8%, var(--card-background-color)); }
      .stage ha-icon { display: block; width: 22px; height: 22px; margin-bottom: 9px; color: var(--state-icon-color); }
      .stage.selected ha-icon { color: var(--primary-color); }
      .stage span { display: block; font-size: 14px; font-weight: 500; }
      .stage small { color: var(--secondary-text-color); font-size: 12px; }
      .stage b { position: absolute; top: 8px; right: 8px; padding: 3px 7px; border-radius: 10px; color: var(--text-primary-color, #fff); background: var(--primary-color); font-size: 10px; font-weight: 500; }
      .layout { display: grid; grid-template-columns: minmax(0, 2fr) minmax(300px, 1fr); align-items: start; gap: 16px; }
      h2 { display: flex; align-items: center; gap: 10px; margin: 4px 0 18px; font-size: 16px; font-weight: 500; }
      h2 ha-icon { color: var(--state-icon-color); }
      .fields { display: grid; grid-template-columns: repeat(4, minmax(120px, 1fr)); gap: 16px; }
      .fields.three { grid-template-columns: repeat(3, minmax(120px, 1fr)); }
      ha-textfield { width: 100%; }
      .divider { height: 1px; margin: 24px 0; background: var(--divider-color); }
      .card-actions { display: flex; min-height: 64px; padding: 8px 16px; align-items: center; justify-content: space-between; gap: 16px; border-top: 1px solid var(--divider-color); }
      .card-actions > span { color: var(--secondary-text-color); font-size: 13px; }
      .card-actions > div { display: flex; gap: 8px; }
      .metrics { padding-top: 0; }
      .metric { display: grid; grid-template-columns: 32px 1fr auto; align-items: center; gap: 8px; min-height: 64px; border-bottom: 1px solid var(--divider-color); }
      .metric:last-child { border-bottom: 0; }
      .metric > ha-icon { color: var(--state-icon-color); }
      .metric-name span, .metric-name small, .metric-value small { display: block; }
      .metric-name span { font-size: 14px; }
      .metric-name small, .metric-value small { margin-top: 3px; color: var(--secondary-text-color); font-size: 11px; }
      .metric-value { text-align: right; white-space: nowrap; }
      .metric-value strong { font-size: 18px; font-weight: 400; }
      .metric-value > span { margin-left: 4px; color: var(--secondary-text-color); font-size: 12px; }
      .loading { display: flex; min-height: 60vh; align-items: center; justify-content: center; gap: 12px; color: var(--secondary-text-color); }
      @media (max-width: 900px) {
        .stage-grid { overflow-x: auto; grid-template-columns: repeat(5, minmax(145px, 1fr)); }
        .layout { grid-template-columns: 1fr; }
      }
      @media (max-width: 650px) {
        main { padding: 16px 8px 32px; }
        .page-heading { align-items: flex-start; flex-direction: column; }
        .fields, .fields.three { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .card-actions { align-items: stretch; flex-direction: column; }
        .card-actions > div { justify-content: flex-end; }
      }
      @media (max-width: 420px) {
        .fields, .fields.three { grid-template-columns: 1fr; }
      }
      @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
    `;
  }
}

if (!customElements.get("grow-system-panel")) {
  customElements.define("grow-system-panel", GrowSystemPanel);
}
