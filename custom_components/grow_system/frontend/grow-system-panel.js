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
    else this._render();
  }

  set narrow(value) {
    this.toggleAttribute("narrow", Boolean(value));
  }

  set route(value) { this._route = value; }
  set panel(value) { this._panel = value; }

  connectedCallback() {
    this._render();
  }

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
      this._notice = `Profile data could not be loaded: ${error.message || error}`;
    } finally {
      this._loading = false;
      this._render();
    }
  }

  _state(entityId, fallback = "—") {
    return this._hass?.states?.[entityId]?.state ?? fallback;
  }

  _reading(entityOrEntities) {
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
    const field = event.target.dataset.field;
    this._draft[field] = Number(event.target.value);
    this._notice = "Unsaved changes";
    this._renderStatusOnly();
  }

  async _save() {
    if (!this._hass || this._saving) return;
    this._saving = true;
    this._notice = "Saving…";
    this._renderStatusOnly();
    try {
      const saved = await this._hass.connection.sendMessagePromise({
        type: "grow_system/profile/save",
        stage: this._editingStage,
        values: this._draft,
      });
      this._config.profiles[this._editingStage] = saved;
      this._draft = { ...saved };
      this._notice = "Profile saved";
    } catch (error) {
      this._notice = `Save failed: ${error.message || error}`;
    } finally {
      this._saving = false;
      this._renderStatusOnly();
    }
  }

  async _activate() {
    if (!this._hass || this._editingStage === this._config.active_stage) return;
    const confirmed = window.confirm(
      `Select ${this._draft.name} as the active stage? The control engine is not enabled yet.`
    );
    if (!confirmed) return;
    await this._hass.connection.sendMessagePromise({
      type: "grow_system/stage/select",
      stage: this._editingStage,
    });
    this._config.active_stage = this._editingStage;
    this._notice = "Active stage updated";
    this._render();
  }

  _renderStatusOnly() {
    const status = this.shadowRoot?.querySelector("[data-status]");
    if (status) status.textContent = this._notice;
  }

  _field(label, key, unit, min, max, step) {
    const value = this._draft?.[key] ?? "";
    return `
      <label class="field">
        <span>${label}</span>
        <div class="input-shell">
          <input data-field="${key}" type="number" value="${value}"
            min="${min}" max="${max}" step="${step}" />
          <b>${unit}</b>
        </div>
      </label>`;
  }

  _liveMetric(label, entity, target, unit) {
    const raw = this._reading(entity);
    const targetValue = Number(target);
    const valid = Number.isFinite(raw);
    const delta = valid ? raw - targetValue : null;
    const tone = !valid ? "muted" : Math.abs(delta) < 0.6 ? "good" : "watch";
    return `
      <div class="readout ${tone}">
        <span>${label}</span>
        <strong>${valid ? raw.toFixed(label === "pH" ? 2 : 1) : "—"}<small>${unit}</small></strong>
        <em>${valid ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} from target` : "No reading"}</em>
      </div>`;
  }

  _render() {
    if (!this.shadowRoot) return;
    if (!this._config || !this._draft) {
      this.shadowRoot.innerHTML = `<style>${GrowSystemPanel.styles}</style><main class="loading">Loading Grow System…</main>`;
      return;
    }

    const order = ["germination", "early_veg", "veg", "bloom", "darkness"];
    const active = this._config.active_stage;
    const entities = this._config.entities || {};
    const stageRail = order.map((stage, index) => {
      const profile = this._config.profiles[stage];
      const state = stage === active ? "active" : stage === this._editingStage ? "editing" : "";
      return `<button class="stage ${state}" data-stage="${stage}">
        <i>${String(index + 1).padStart(2, "0")}</i>
        <span>${profile.name}</span>
        <b>${profile.photoperiod}/${24 - profile.photoperiod}</b>
      </button>`;
    }).join("");

    this.shadowRoot.innerHTML = `
      <style>${GrowSystemPanel.styles}</style>
      <main>
        <header>
          <div>
            <p class="eyebrow">Grow System Extension / Profile console</p>
            <h1>${this._draft.name}</h1>
          </div>
          <div class="system-state">
            <span>ACTIVE STAGE</span>
            <strong>${this._config.profiles[active].name}</strong>
          </div>
        </header>

        <nav class="stage-rail" aria-label="Growth stages">${stageRail}</nav>

        <section class="workspace">
          <div class="editor">
            <div class="section-head">
              <div><span>01</span><h2>Canopy</h2></div>
              <p>Photoperiod and the climate around the plant.</p>
            </div>
            <div class="field-grid">
              ${this._field("Light on", "photoperiod", "h", 0, 24, 1)}
              ${this._field("Intensity", "light_intensity", "%", 0, 100, 5)}
              ${this._field("Day temperature", "day_temperature", "°C", 10, 35, 0.5)}
              ${this._field("Night temperature", "night_temperature", "°C", 10, 35, 0.5)}
            </div>

            <div class="section-head">
              <div><span>02</span><h2>Atmosphere</h2></div>
              <p>One climate target, with VPD as the cross-check.</p>
            </div>
            <div class="field-grid">
              ${this._field("Humidity", "humidity", "%", 30, 90, 1)}
              ${this._field("VPD", "vpd", "kPa", 0.2, 2.5, 0.05)}
              ${this._field("CO₂", "co2", "ppm", 350, 1500, 25)}
            </div>

            <div class="section-head">
              <div><span>03</span><h2>Root zone</h2></div>
              <p>Targets remain monitor-only until each actuator is attached.</p>
            </div>
            <div class="field-grid">
              ${this._field("Nutrient strength", "ppm", "ppm", 0, 2000, 10)}
              ${this._field("Water temperature", "water_temperature", "°C", 10, 30, 0.5)}
              ${this._field("pH", "ph", "pH", 4, 8, 0.1)}
              ${this._field("Minimum DO", "do_minimum", "mg/L", 0, 15, 0.1)}
            </div>

            <footer>
              <span data-status>${this._notice}</span>
              <div>
                <button class="secondary" data-activate ${this._editingStage === active ? "disabled" : ""}>Set active</button>
                <button class="primary" data-save ${this._saving ? "disabled" : ""}>Save profile</button>
              </div>
            </footer>
          </div>

          <aside>
            <p class="eyebrow">LIVE / TARGET DELTA</p>
            ${this._liveMetric("Air", entities.temperature_sensors, this._draft.day_temperature, "°C")}
            ${this._liveMetric("Humidity", entities.humidity_sensors, this._draft.humidity, "%")}
            ${this._liveMetric("VPD", entities.vpd_sensor, this._draft.vpd, " kPa")}
            ${this._liveMetric("CO₂", entities.co2_sensors, this._draft.co2, " ppm")}
            ${this._liveMetric("PPM", entities.ppm_sensor, this._draft.ppm, " ppm")}
            ${this._liveMetric("Water", entities.water_temperature_sensor, this._draft.water_temperature, "°C")}
            ${this._liveMetric("pH", entities.ph_sensor, this._draft.ph, "")}
            ${this._liveMetric("DO", entities.do_sensor, this._draft.do_minimum, " mg/L")}
          </aside>
        </section>
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
        --ink: #172426;
        --paper: #e9e5d9;
        --paper-deep: #d8d1c1;
        --reed: #5f8c76;
        --water: #4f93a0;
        --copper: #b97549;
        --danger: #b65045;
        display: block;
        min-height: 100%;
        color: var(--ink);
        background: var(--paper);
        font-family: Inter, "Segoe UI", sans-serif;
      }
      * { box-sizing: border-box; }
      main { max-width: 1500px; margin: 0 auto; padding: 34px clamp(18px, 4vw, 64px) 64px; }
      header { display: flex; align-items: end; justify-content: space-between; gap: 30px; border-bottom: 1px solid rgba(23,36,38,.35); padding-bottom: 24px; }
      h1 { font: 500 clamp(44px, 7vw, 96px)/.88 "Arial Narrow", "Roboto Condensed", sans-serif; letter-spacing: -.055em; margin: 8px 0 0; }
      .eyebrow { font: 700 11px/1.2 ui-monospace, SFMono-Regular, monospace; letter-spacing: .13em; text-transform: uppercase; margin: 0; opacity: .65; }
      .system-state { text-align: right; border-left: 4px solid var(--reed); padding-left: 16px; }
      .system-state span { display:block; font: 700 10px ui-monospace, monospace; letter-spacing:.12em; opacity:.55; }
      .system-state strong { display:block; font-size:22px; margin-top:5px; }
      .stage-rail { display:grid; grid-template-columns:repeat(5,1fr); margin:26px 0 34px; border:1px solid rgba(23,36,38,.3); }
      .stage { appearance:none; border:0; border-right:1px solid rgba(23,36,38,.25); background:transparent; color:inherit; padding:16px; text-align:left; cursor:pointer; display:grid; grid-template-columns:auto 1fr; gap:4px 12px; transition:background .18s,color .18s; }
      .stage:last-child { border-right:0; }
      .stage i { grid-row:1/3; font:700 10px ui-monospace,monospace; opacity:.45; font-style:normal; padding-top:3px; }
      .stage span { font-weight:750; }
      .stage b { font:600 11px ui-monospace,monospace; opacity:.6; }
      .stage:hover,.stage.editing { background:var(--paper-deep); }
      .stage.active { background:var(--ink); color:var(--paper); }
      .workspace { display:grid; grid-template-columns:minmax(0,1fr) 310px; gap:34px; align-items:start; }
      .editor { border-top:6px solid var(--ink); }
      .section-head { display:flex; justify-content:space-between; gap:30px; align-items:baseline; padding:26px 0 12px; border-bottom:1px solid rgba(23,36,38,.25); }
      .section-head div { display:flex; align-items:baseline; gap:12px; }
      .section-head span { font:700 10px ui-monospace,monospace; color:var(--copper); }
      h2 { font:700 25px/1 "Arial Narrow","Roboto Condensed",sans-serif; margin:0; letter-spacing:-.02em; }
      .section-head p { margin:0; font-size:12px; opacity:.55; }
      .field-grid { display:grid; grid-template-columns:repeat(4,minmax(135px,1fr)); gap:1px; background:rgba(23,36,38,.2); border-bottom:1px solid rgba(23,36,38,.2); }
      .field { background:var(--paper); padding:18px 16px; min-height:94px; }
      .field>span { display:block; font-size:11px; font-weight:750; opacity:.58; margin-bottom:12px; }
      .input-shell { display:flex; align-items:baseline; gap:8px; }
      input { width:100%; min-width:0; border:0; border-bottom:2px solid var(--ink); background:transparent; color:inherit; font:600 26px/1 ui-monospace,SFMono-Regular,monospace; padding:0 0 5px; outline:none; }
      input:focus { border-color:var(--water); }
      .input-shell b { font:700 10px ui-monospace,monospace; opacity:.55; }
      footer { display:flex; justify-content:space-between; align-items:center; min-height:84px; gap:20px; }
      footer>span { font:600 12px ui-monospace,monospace; color:var(--copper); }
      footer button { border:1px solid var(--ink); padding:12px 18px; font-weight:750; cursor:pointer; margin-left:8px; }
      footer button.primary { background:var(--ink); color:var(--paper); }
      footer button.secondary { background:transparent; color:var(--ink); }
      footer button:disabled { opacity:.35; cursor:not-allowed; }
      aside { background:var(--ink); color:var(--paper); padding:24px; position:sticky; top:20px; }
      aside>.eyebrow { color:#a8c8bb; margin-bottom:16px; }
      .readout { padding:15px 0; border-top:1px solid rgba(233,229,217,.15); display:grid; grid-template-columns:1fr auto; gap:5px; }
      .readout>span { font-size:12px; opacity:.7; }
      .readout strong { font:600 23px ui-monospace,monospace; }
      .readout small { font-size:9px; opacity:.55; margin-left:4px; }
      .readout em { grid-column:1/-1; font:500 10px ui-monospace,monospace; font-style:normal; color:#d4a27f; }
      .readout.good em { color:#91c5a8; }
      .readout.muted { opacity:.45; }
      .loading { display:grid; place-items:center; min-height:60vh; font:700 13px ui-monospace,monospace; letter-spacing:.1em; text-transform:uppercase; }
      @media(max-width:900px){
        .workspace{grid-template-columns:1fr}.field-grid{grid-template-columns:repeat(2,1fr)}aside{position:static}.stage-rail{overflow-x:auto;grid-template-columns:repeat(5,minmax(145px,1fr))}
      }
      @media(max-width:560px){
        main{padding:20px 14px 44px}header{align-items:start;flex-direction:column}.system-state{text-align:left}.field-grid{grid-template-columns:1fr 1fr}.section-head p{display:none}footer{align-items:flex-start;flex-direction:column;padding:20px 0}footer button{margin:0 6px 0 0}
      }
      @media(prefers-reduced-motion:reduce){*{transition:none!important}}
    `;
  }
}

customElements.define("grow-system-panel", GrowSystemPanel);
