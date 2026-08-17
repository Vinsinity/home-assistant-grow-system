class GrowSystemPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._config = null;
    this._draft = null;
    this._settings = {};
    this._editingStage = "darkness";
    this._tab = "overview";
    this._notice = "";
    this._history = {};
    this._hardwareDraft = null;
    this._newI2CDriver = "waveshare_motor_hat";
    this._selectedCandidate = null;
    this._deviceSettings = null;
    this._deviceNotice = "";
    this._calibrationStatus = "";
    this._hardwareNotice = "";
    this._newFluidName = "";
  }

  set hass(value) {
    this._hass = value;
    if (!this._config) this._load();
    else this._refreshReadings();
  }
  set narrow(value) { this.toggleAttribute("narrow", Boolean(value)); }
  set route(value) { this._route = value; }
  set panel(value) { this._panel = value; }
  connectedCallback() { this._render(); }

  async _load() {
    if (!this._hass || this._loading) return;
    this._loading = true;
    try {
      this._config = await this._hass.connection.sendMessagePromise({type: "grow_system/config/get"});
      this._editingStage = this._config.active_stage;
      this._draft = {...this._config.profiles[this._editingStage]};
      this._settings = {...(this._config.configured_entities || {})};
      this._hardwareDraft = JSON.parse(JSON.stringify(this._config.hardware_config || {atlas_auto_discovery:true,poll_interval:30,atlas_devices:[]}));
      this._render();
      this._loadHistory();
    } catch (error) {
      this._notice = `Grow System yüklenemedi: ${error.message || error}`;
      this._render();
    } finally { this._loading = false; }
  }

  _state(entityId) { return this._hass?.states?.[entityId]?.state; }
  _entityIds(value) { return Array.isArray(value) ? value : value ? [value] : []; }
  _reading(value) {
    if (value === "__vpd__") {
      const e = this._config?.entities || {};
      const t = this._reading(e.temperature_sensors);
      const rh = this._reading(e.humidity_sensors);
      if (!Number.isFinite(t) || !Number.isFinite(rh)) return NaN;
      return 0.6108 * Math.exp((17.27 * t) / (t + 237.3)) * (1 - rh / 100);
    }
    const values = this._entityIds(value).map((id) => Number(this._state(id))).filter(Number.isFinite);
    return values.length ? values.reduce((sum, item) => sum + item, 0) / values.length : NaN;
  }

  async _loadHistory() {
    const e = this._config?.entities || {};
    const ids = [...new Set([
      ...this._entityIds(e.temperature_sensors), ...this._entityIds(e.humidity_sensors),
      ...this._entityIds(e.co2_sensors), ...this._entityIds(e.ppm_sensor),
      ...this._entityIds(e.water_temperature_sensor), ...this._entityIds(e.ph_sensor),
      ...this._entityIds(e.do_sensor),
    ])];
    if (!ids.length || !this._hass) return;
    const start = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    try {
      const result = await this._hass.callApi(
        "GET",
        `history/period/${encodeURIComponent(start)}?filter_entity_id=${encodeURIComponent(ids.join(","))}&minimal_response&no_attributes`
      );
      this._history = {};
      (result || []).forEach((series) => {
        if (!series?.length) return;
        const id = series[0].entity_id || series[0].e;
        if (!id) return;
        this._history[id] = series.map((point) => Number(point.state ?? point.s)).filter(Number.isFinite);
      });
      if (this._tab === "overview") this._render();
    } catch (_) { /* Recorder may be unavailable; current values still work. */ }
  }

  _sparkline(value) {
    const series = this._entityIds(value).map((id) => this._history[id] || []).filter((items) => items.length > 1);
    const all = series.flat();
    if (!all.length) return `<div class="no-history">Henüz 24 saatlik geçmiş yok</div>`;
    const min = Math.min(...all), max = Math.max(...all), span = max - min || 1;
    const lines = series.map((items, index) => {
      const points = items.map((item, i) => `${(i / (items.length - 1)) * 300},${66 - ((item - min) / span) * 58}`).join(" ");
      return `<polyline points="${points}" style="opacity:${Math.max(.35, 1 - index * .18)}" />`;
    }).join("");
    return `<svg class="chart" viewBox="0 0 300 72" preserveAspectRatio="none" aria-label="Son 24 saat grafiği"><line x1="0" y1="66" x2="300" y2="66" />${lines}</svg>`;
  }

  _stageRail() {
    const order = ["germination", "early_veg", "veg", "bloom", "darkness"];
    const labels = {germination:"Çimlenme",early_veg:"Erken veg",veg:"Veg",bloom:"Çiçeklenme",darkness:"Karanlık"};
    const icons = {germination:"mdi:sprout",early_veg:"mdi:leaf",veg:"mdi:flower",bloom:"mdi:flower-pollen",darkness:"mdi:weather-night"};
    return order.map((stage) => {
      const p = this._config.profiles[stage];
      return `<button class="stage ${stage === this._editingStage ? "selected" : ""}" data-stage="${stage}">
        <ha-icon icon="${icons[stage]}"></ha-icon><span>${labels[stage]}</span><small>${p.photoperiod}/${24-p.photoperiod}</small>
        ${stage === this._config.active_stage ? "<b>Aktif</b>" : ""}</button>`;
    }).join("");
  }

  _metricCard(label, icon, value, target, unit, precision=1) {
    const raw = this._reading(value), valid = Number.isFinite(raw);
    return `<ha-card class="metric-card"><div class="metric-head"><ha-icon icon="${icon}"></ha-icon><div><span>${label}</span><small>Hedef ${target} ${unit}</small></div>
      <strong>${valid ? raw.toFixed(precision) : "—"}<i>${valid ? unit : "Veri yok"}</i></strong></div>
      ${value === "__vpd__" ? '<div class="no-history">Sıcaklık ve nemden canlı hesaplanıyor</div>' : this._sparkline(value)}
      <div class="chart-foot"><span>24 saat</span><span>${valid ? `${raw-target >= 0 ? "+" : ""}${(raw-target).toFixed(precision)} hedef farkı` : "Sensör eşleştirilmedi"}</span></div></ha-card>`;
  }

  _overview() {
    const e = this._config.entities || {}, p = this._draft;
    return `<section class="metric-grid">
      ${this._metricCard("Kabin sıcaklığı","mdi:thermometer",e.temperature_sensors,p.day_temperature,"°C")}
      ${this._metricCard("Nem","mdi:water-percent",e.humidity_sensors,p.humidity,"%")}
      ${this._metricCard("VPD","mdi:gauge","__vpd__",p.vpd,"kPa",2)}
      ${this._metricCard("CO₂","mdi:molecule-co2",e.co2_sensors,p.co2,"ppm",0)}
      ${this._metricCard("Besin","mdi:flash",e.ppm_sensor,p.ppm,"ppm",0)}
      ${this._metricCard("Su sıcaklığı","mdi:coolant-temperature",e.water_temperature_sensor,p.water_temperature,"°C")}
      ${this._metricCard("pH","mdi:ph",e.ph_sensor,p.ph,"pH",2)}
      ${this._metricCard("Çözünmüş oksijen","mdi:chart-bubble",e.do_sensor,p.do_minimum,"mg/L",2)}
    </section>`;
  }

  _securityOverview() {
    const e = this._config.entities || {};
    const cameras = this._entityIds(e.cameras);
    const leaks = this._entityIds(e.leak_sensors);
    const waterLevelId = e.water_level_sensor;
    const waterLevel = waterLevelId ? this._hass?.states?.[waterLevelId] : null;
    const alarm = leaks.some((id) => this._state(id) === "on");
    const cameraCards = cameras.map((id) => {
      const state = this._hass?.states?.[id];
      const name = state?.attributes?.friendly_name || id;
      const picture = state?.attributes?.entity_picture;
      return `<div class="camera"><div class="camera-image">${picture ? `<img src="${picture}" alt="${name}" loading="lazy">` : '<ha-icon icon="mdi:camera-off"></ha-icon>'}</div><span><ha-icon icon="mdi:camera"></ha-icon>${name}</span></div>`;
    }).join("");
    const leakCards = leaks.map((id) => {
      const state = this._hass?.states?.[id];
      const wet = state?.state === "on";
      const unavailable = !state || ["unavailable","unknown"].includes(state.state);
      const name = state?.attributes?.friendly_name || id;
      return `<div class="leak ${wet ? "alarm" : unavailable ? "unknown" : "safe"}"><ha-icon icon="${wet ? "mdi:water-alert" : unavailable ? "mdi:help-circle-outline" : "mdi:water-check"}"></ha-icon><span><b>${name}</b><small>${wet ? "Su algılandı" : unavailable ? "Bağlantı yok" : "Kuru"}</small></span></div>`;
    }).join("");
    return `<ha-card class="security-card"><div class="security-head"><div><ha-icon icon="mdi:shield-home-outline"></ha-icon><span><b>Güvenlik</b><small>${alarm ? "Su baskını alarmı var" : "Tüm sensörler normal"}</small></span></div>${alarm ? '<strong><ha-icon icon="mdi:alert"></ha-icon>Alarm</strong>' : ""}</div>
      ${cameras.length ? `<div class="camera-grid">${cameraCards}</div>` : '<div class="security-empty">Ayarlar bölümünden kamera ekleyebilirsiniz.</div>'}
      ${leaks.length ? `<div class="leak-grid">${leakCards}</div>` : '<div class="security-empty">Su baskını sensörü eşleştirilmedi.</div>'}
      <div class="water-level ${waterLevel ? "" : "unknown"}"><ha-icon icon="mdi:waves-arrow-up"></ha-icon><span><b>RDWC su seviyesi</b><small>${waterLevel ? (waterLevel.attributes.friendly_name || waterLevelId) : "Sensör eşleştirilmedi"}</small></span><strong>${waterLevel ? `${waterLevel.state}${waterLevel.attributes.unit_of_measurement ? ` ${waterLevel.attributes.unit_of_measurement}` : ""}` : "—"}</strong></div>
    </ha-card>`;
  }

  _missingSettings() {
    const values = this._config.configured_entities || {};
    const required = {
      environment_devices:"Ortam sensörleri",ppm_sensor:"PPM",ph_sensor:"pH",do_sensor:"DO",
      water_temperature_sensor:"Su sıcaklığı",water_level_sensor:"Su seviyesi",light:"Işık",
      co2_valve:"CO₂ valfi",exhaust_fan:"Egzoz fanı",inline_fan:"Giriş fanı",
      rdwc_pump:"RDWC pompası",climate:"Klima",dehumidifier:"Nem alma",chiller:"Su soğutucu",
      cameras:"Kamera",leak_sensors:"Su baskını sensörü"
    };
    return Object.entries(required).filter(([key]) => Array.isArray(values[key]) ? !values[key].length : !values[key]).map(([,label]) => label);
  }

  _field(label,key,unit,min,max,step) { return `<ha-textfield data-field="${key}" label="${label}" type="number" value="${this._draft[key]}" min="${min}" max="${max}" step="${step}" suffix="${unit}"></ha-textfield>`; }
  _profiles() {
    const p = this._draft;
    return `<ha-card header="${p.name} profili"><div class="card-content">
      <h2><ha-icon icon="mdi:white-balance-sunny"></ha-icon>Işık ve iklim</h2><div class="fields">
      ${this._field("Aydınlık süre","photoperiod","saat",0,24,1)}${this._field("Işık şiddeti","light_intensity","%",0,100,5)}${this._field("Gündüz sıcaklığı","day_temperature","°C",10,35,.5)}${this._field("Gece sıcaklığı","night_temperature","°C",10,35,.5)}</div>
      <div class="divider"></div><h2><ha-icon icon="mdi:greenhouse"></ha-icon>Kabin atmosferi</h2><div class="fields three">
      ${this._field("Bağıl nem","humidity","%",30,90,1)}${this._field("VPD","vpd","kPa",.2,2.5,.05)}${this._field("CO₂","co2","ppm",350,1500,25)}</div>
      <div class="divider"></div><h2><ha-icon icon="mdi:water"></ha-icon>Kök bölgesi</h2><div class="fields">
      ${this._field("Besin yoğunluğu","ppm","ppm",0,2000,10)}${this._field("Su sıcaklığı","water_temperature","°C",10,30,.5)}${this._field("pH","ph","pH",4,8,.1)}${this._field("Minimum DO","do_minimum","mg/L",0,15,.1)}</div></div>
      <div class="card-actions"><span data-status>${this._notice}</span><div><ha-button data-activate appearance="plain" ${this._editingStage === this._config.active_stage ? "disabled" : ""}>Aktif aşama yap</ha-button><ha-button data-save-profile appearance="filled">Değişiklikleri kaydet</ha-button></div></div></ha-card>`;
  }

  _selector(label,key,help="") { return `<div class="setting"><div><span>${label}</span>${help ? `<small>${help}</small>` : ""}</div><ha-selector data-setting="${key}"></ha-selector></div>`; }
  _hardwareCard() {
    const hw = this._config?.hardware?.atlas_i2c || {};
    const cfg = this._hardwareDraft || {};
    const assignments = cfg.device_assignments || [];
    const discovered = hw.discovered_devices || [];
    const driverLabels={waveshare_motor_hat:"Waveshare Motor Driver HAT",pca9685_generic:"Genel PCA9685",atlas_do:"Atlas EZO DO",atlas_ph:"Atlas EZO pH",atlas_ec:"Atlas EZO EC",atlas_rtd:"Atlas EZO RTD"};
    const rows = assignments.map((item)=>{
      const address=`0x${Number(item.address).toString(16).padStart(2,"0")}`;
      const found=discovered.find((candidate)=>parseInt(candidate.address,16)===Number(item.address));
      const waveshare=item.driver==="waveshare_motor_hat",atlas=item.driver.startsWith("atlas_");
      const channels=(item.channels||[{id:"A",name:"Motor A",fluid_id:"unassigned"},{id:"B",name:"Motor B",fluid_id:"unassigned"}]);
      const fluids=cfg.dosing_fluids||[];
      return `<div class="bus-row"><code>${address}</code><ha-icon icon="${waveshare?"mdi:engine-outline":atlas?"mdi:test-tube":"mdi:chip"}"></ha-icon><div><b>${item.name||driverLabels[item.driver]}</b><small>${driverLabels[item.driver]||item.driver}${found?` · ${found.chip}`:""}</small>${waveshare?`<div class="channel-line">${channels.map((channel)=>{const fluidId=channel.fluid_id||channel.role||"unassigned";const fluid=fluids.find((entry)=>entry.id===fluidId);return `<span>${channel.name} · ${fluid?.name||"Bağlantı atanmadı"}</span>`;}).join("")}</div>`:""}</div><span class="status-dot ${found?"ready":"attention"}">${found?"Bağlı":"Bulunamadı"}</span><ha-icon-button data-remove-assignment="${address}" title="Cihazı kaldır"><ha-icon icon="mdi:delete-outline"></ha-icon></ha-icon-button><ha-icon-button data-device-settings="${address}" title="Cihaz ayarları"><ha-icon icon="mdi:cog-outline"></ha-icon></ha-icon-button></div>`;
    }).join("");
    const available=discovered.filter((candidate)=>!assignments.some((item)=>Number(item.address)===parseInt(candidate.address,16)));
    const candidates=available.map((candidate)=>`<button class="candidate ${this._selectedCandidate?.address===candidate.address?"selected":""}" data-candidate-address="${candidate.address}"><code>${candidate.address}</code><span><b>${candidate.chip}</b><small>${candidate.firmware?`Firmware ${candidate.firmware}`:"Kart modelini seçerek ekleyin"}</small></span><ha-icon icon="${this._selectedCandidate?.address===candidate.address?"mdi:chevron-down":"mdi:chevron-right"}"></ha-icon></button>`).join("");
    const selected=this._selectedCandidate&&available.find((item)=>item.address===this._selectedCandidate.address);
    const atlasSelected=selected?.suggested_driver?.startsWith("atlas_");
    const editor=selected?`<div class="candidate-editor"><div class="editor-address"><code>${selected.address}</code><span><b>${selected.chip}</b><small>${atlasSelected?"Model cihaz tarafından doğrulandı":"PCA9685 birden fazla kartta kullanılır; kart modelini seçin."}</small></span></div><ha-textfield data-candidate-name label="Cihaz adı" value="${selected.chip}"></ha-textfield>${atlasSelected?`<div class="locked-driver"><ha-icon icon="mdi:check-decagram-outline"></ha-icon><span><b>${driverLabels[selected.suggested_driver]}</b><small>Doğrulanmış sürücü</small></span></div>`:`<ha-selector data-candidate-driver></ha-selector>`}<ha-button data-add-candidate appearance="filled">Bu cihazı ekle</ha-button></div>`:"";
    return `<ha-card class="hardware-card"><div class="i2c-heading"><div><span class="eyebrow">Raspberry Pi · ${hw.path || "/dev/i2c-1"}</span><h2>Yerel I²C donanımı</h2><p>${hw.available ? "Veri yolu hazır; keşif yalnızca okuma yapıyor." : (hw.error || "I²C veri yolu kullanılamıyor.")}</p></div><div class="bus-health ${hw.available ? "online" : "offline"}"><span></span>${hw.available ? "Çevrimiçi" : "Çevrimdışı"}</div></div><div class="i2c-workspace">
      <section class="bus-inventory"><div class="section-head"><div><h3>Eklenen cihazlar</h3><small>${assignments.length} cihaz Grow System tarafından kullanılıyor</small></div><ha-textfield data-poll-interval label="Okuma aralığı" type="number" min="10" max="300" suffix="sn" value="${cfg.poll_interval || 30}"></ha-textfield></div>${rows || '<div class="security-empty">Henüz cihaz eklenmedi. Sağdaki keşif listesinden bir cihaz seçin.</div>'}</section>
      <aside class="device-adder"><span class="eyebrow">Cihaz ekle</span><h3>Keşfedilen cihazlar</h3><p>Bir cihaza dokunun, modelini doğrulayın ve doğrudan ekleyin.</p><div class="candidate-list">${candidates||'<div class="candidate-empty">Eklenmemiş yeni cihaz bulunamadı.</div>'}</div>${editor}<details class="manual-add"><summary>Adresi elle ekle <small>Gelişmiş</small></summary><div><ha-textfield data-new-address label="I²C adresi" value="0x40"></ha-textfield><ha-textfield data-new-name label="Cihaz adı" value=""></ha-textfield><ha-selector data-new-driver></ha-selector><ha-button data-add-i2c>Elle ekle</ha-button></div></details><div class="inline-save"><span data-hardware-status>${this._hardwareNotice}</span></div></aside>
      </div></ha-card>`;
  }
  _dosingFluidsCard(){
    const fluids=this._hardwareDraft?.dosing_fluids||[{id:"ph_up",name:"pH+",required:true},{id:"ph_down",name:"pH−",required:true}];
    return `<ha-card class="dosing-card"><div class="dosing-head"><div><span class="eyebrow">Dozaj tesisatı</span><h2>Dozaj sıvıları ve besinler</h2><p>pH+ ve pH− zorunludur. Kullandığınız besinleri ekleyip Motor HAT kanallarında seçin.</p></div></div><div class="fluid-list">${fluids.map((fluid)=>`<div class="fluid-row"><ha-icon icon="${fluid.required?"mdi:flask":"mdi:bottle-tonic-plus-outline"}"></ha-icon><span><b>${fluid.name}</b><small>${fluid.required?"Zorunlu sistem sıvısı":"Kullanıcı tanımlı besin / katkı"}</small></span>${fluid.required?'<span class="required-badge">Zorunlu</span>':`<ha-icon-button data-remove-fluid="${fluid.id}" title="Besini kaldır"><ha-icon icon="mdi:delete-outline"></ha-icon></ha-icon-button>`}</div>`).join("")}</div><div class="fluid-add"><ha-textfield data-new-fluid-name label="Yeni besin veya katkı adı" placeholder="Örn. Besin A, CalMag"></ha-textfield><ha-button data-add-fluid appearance="filled">Ekle</ha-button></div></ha-card>`;
  }
  _hardwareView(){return `<div class="hardware-view">${this._hardwareCard()}</div>`;}
  _nutrientsView(){return `<div class="nutrients-view">${this._dosingFluidsCard()}</div>`;}
  _settingsView() {
    return `<div class="settings-grid"><ha-card header="İzleme sensörleri"><div class="card-content settings-list">
      ${this._selector("Ortam sensör cihazları","environment_devices","Shelly HT ve CO₂ cihazlarını birlikte seçin; alt entity’ler otomatik keşfedilir.")}
      ${this._selector("Besin PPM sensörü","ppm_sensor")}${this._selector("pH sensörü","ph_sensor")}${this._selector("Çözünmüş oksijen sensörü","do_sensor")}${this._selector("Su sıcaklığı sensörü","water_temperature_sensor")}${this._selector("RDWC su seviye sensörü","water_level_sensor")}
      </div></ha-card><ha-card header="Kontrol ekipmanları"><div class="card-content settings-list">
      ${this._selector("Yetiştirme ışığı","light")}${this._selector("CO₂ selenoid valfi","co2_valve")}${this._selector("Egzoz fanı","exhaust_fan")}${this._selector("Giriş fanı","inline_fan")}${this._selector("RDWC sirkülasyon pompası","rdwc_pump","Hava sirkülasyon vantilatörleri sürekli çalışır ve Grow System tarafından kontrol edilmez.")}${this._selector("Klima","climate")}${this._selector("Nem alma cihazı","dehumidifier")}${this._selector("Su soğutucu","chiller")}
      </div></ha-card><ha-card header="Güvenlik"><div class="card-content settings-list">
      ${this._selector("Kameralar","cameras","İstediğiniz kadar kamera seçebilirsiniz.")}${this._selector("Su baskını sensörleri","leak_sensors","Islak/kuru durumunu bildiren sensörleri seçin.")}
      </div></ha-card><div class="settings-actions"><span data-status>${this._notice}</span><ha-button data-save-settings appearance="filled">Bağlantıları kaydet</ha-button></div></div>`;
  }

  _deviceSettingsDialog() {
    const item=this._deviceSettings;
    if(!item)return "";
    const address=`0x${Number(item.address).toString(16).padStart(2,"0")}`;
    const found=(this._config?.hardware?.atlas_i2c?.discovered_devices||[]).find((candidate)=>parseInt(candidate.address,16)===Number(item.address));
    const motor=item.driver==="waveshare_motor_hat";
    const atlas=item.driver.startsWith("atlas_");
    const operations={atlas_ph:["low","mid","high","clear"],atlas_do:["atmospheric","zero","clear"],atlas_ec:["dry","one","low","high","clear"],atlas_rtd:["reference","clear"]};
    const channels=item.channels||[{id:"A",name:"Motor A",fluid_id:"unassigned"},{id:"B",name:"Motor B",fluid_id:"unassigned"}];
    const motorBody=motor?`<div class="device-note safe"><ha-icon icon="mdi:shield-lock-outline"></ha-icon><span><b>Çıkışlar donanımsal olarak kilitli</b><small>Bu ayarlar motor çalıştırmaz; yalnızca kanal adı ve bağlı dozaj sıvısını kaydeder.</small></span></div><div class="motor-channels">${channels.map((channel,index)=>`<section><div><b>Motor ${channel.id}</b><small>${channel.id==="A"?"PWM 0 · DIR 1/2":"PWM 5 · DIR 3/4"}</small></div><ha-textfield data-channel-name="${index}" label="Kanal adı" value="${channel.name}"></ha-textfield><ha-selector data-channel-fluid="${index}"></ha-selector></section>`).join("")}</div>`:"";
    const atlasBody=atlas?`<div class="device-facts"><span><small>Firmware</small><b>${found?.firmware||"Bilinmiyor"}</b></span><span><small>Kalibrasyon durumu</small><b>${this._calibrationStatus||"Henüz okunmadı"}</b></span><ha-button data-read-calibration appearance="plain">Durumu oku</ha-button></div><div class="calibration-box"><h3>Yönlendirmeli kalibrasyon</h3><p>Probu doğru referans ortamına yerleştirin, ölçümün kararlı olmasını bekleyin ve işlemi açıkça onaylayın.</p><ha-selector data-cal-operation></ha-selector><ha-textfield data-cal-value label="Referans değeri (gerekiyorsa)" type="number" step="0.01"></ha-textfield><label><ha-checkbox data-cal-confirm></ha-checkbox><span>Prob doğru referans ortamında ve ölçüm kararlı</span></label><ha-button data-run-calibration appearance="filled">Kalibrasyonu uygula</ha-button></div>`:"";
    return `<div class="dialog-scrim" data-dialog-scrim><div class="device-dialog" role="dialog" aria-modal="true" aria-label="Cihaz ayarları"><div class="dialog-head"><div><span class="eyebrow">${address} · ${item.driver}</span><h2>Cihaz ayarları</h2></div><ha-icon-button data-close-device-dialog title="Kapat"><ha-icon icon="mdi:close"></ha-icon></ha-icon-button></div><div class="dialog-body"><ha-textfield data-device-name label="Cihaz adı" value="${item.name||""}"></ha-textfield>${motorBody}${atlasBody}<div class="device-message" data-device-message>${this._deviceNotice}</div></div><div class="dialog-actions"><ha-button data-close-device-dialog appearance="plain">Vazgeç</ha-button><ha-button data-save-device appearance="filled">Ayarları kaydet</ha-button></div></div></div>`;
  }

  _selectorConfig(key) {
    if (key === "environment_devices") return {device:{multiple:true}};
    if (key === "cameras") return {entity:{domain:"camera",multiple:true}};
    if (key === "leak_sensors") return {entity:{domain:"binary_sensor",device_class:"moisture",multiple:true}};
    const domains = {light:["light","switch"],co2_valve:"switch",exhaust_fan:["fan","switch"],inline_fan:["fan","switch"],rdwc_pump:["switch","fan"],water_level_sensor:["sensor","binary_sensor"],climate:"climate",dehumidifier:["humidifier","switch"],chiller:["climate","switch","water_heater"]};
    return {entity:{domain:domains[key] || "sensor"}};
  }

  _wireSelectors() {
    this.shadowRoot.querySelectorAll("ha-selector[data-setting]").forEach((picker) => {
      const key = picker.dataset.setting;
      picker.hass = this._hass;
      picker.selector = this._selectorConfig(key);
      picker.value = this._settings[key] ?? (["environment_devices","cameras","leak_sensors"].includes(key) ? [] : "");
      picker.addEventListener("value-changed", (event) => { this._settings[key] = event.detail.value; this._notice = "Kaydedilmemiş bağlantı değişiklikleri var"; this._updateNotice(); });
    });
  }

  async _saveSettings() {
    this._notice = "Bağlantılar kaydediliyor…"; this._updateNotice();
    try {
      await this._hass.connection.sendMessagePromise({type:"grow_system/entities/save",values:this._settings});
      await new Promise((resolve) => setTimeout(resolve, 150));
      this._config = await this._hass.connection.sendMessagePromise({type:"grow_system/config/get"});
      this._settings = {...(this._config.configured_entities || {})};
      this._notice = "Bağlantılar kaydedildi";
      this._history = {}; this._render(); this._loadHistory();
    } catch (error) { this._notice = `Kaydedilemedi: ${error.message || error}`; this._updateNotice(); }
  }

  _wireHardware() {
    this.shadowRoot.querySelector("[data-poll-interval]")?.addEventListener("change", (event) => { this._hardwareDraft.poll_interval = Number(event.target.value); this._saveHardware(); });
    const modelOptions=[{value:"waveshare_motor_hat",label:"Waveshare Motor Driver HAT"},{value:"pca9685_generic",label:"Genel PCA9685"},{value:"atlas_do",label:"Atlas EZO DO"},{value:"atlas_ph",label:"Atlas EZO pH"},{value:"atlas_ec",label:"Atlas EZO EC"},{value:"atlas_rtd",label:"Atlas EZO RTD"}];
    const driver = this.shadowRoot.querySelector("[data-new-driver]");
    if(driver){driver.hass=this._hass;driver.selector={select:{options:modelOptions,mode:"dropdown"}};driver.value=this._newI2CDriver;driver.addEventListener("value-changed",(event)=>{this._newI2CDriver=event.detail.value;});}
    const candidateDriver=this.shadowRoot.querySelector("[data-candidate-driver]");if(candidateDriver){candidateDriver.hass=this._hass;candidateDriver.selector={select:{options:modelOptions.slice(0,2),mode:"dropdown"}};candidateDriver.value=this._newI2CDriver;candidateDriver.addEventListener("value-changed",(event)=>{this._newI2CDriver=event.detail.value;});}
    this.shadowRoot.querySelector("[data-add-i2c]")?.addEventListener("click", () => this._addI2CDevice());
    this.shadowRoot.querySelectorAll("[data-candidate-address]").forEach((button)=>button.addEventListener("click",()=>{const candidate=(this._config.hardware.atlas_i2c.discovered_devices||[]).find((item)=>item.address===button.dataset.candidateAddress);this._selectedCandidate=this._selectedCandidate?.address===candidate.address?null:candidate;this._newI2CDriver=candidate.suggested_driver;this._render();}));
    this.shadowRoot.querySelector("[data-add-candidate]")?.addEventListener("click",()=>{const name=this.shadowRoot.querySelector("[data-candidate-name]")?.value?.trim();this._enrollI2C(parseInt(this._selectedCandidate.address,16),name||this._selectedCandidate.chip,this._selectedCandidate.suggested_driver.startsWith("atlas_")?this._selectedCandidate.suggested_driver:this._newI2CDriver);});
    this.shadowRoot.querySelectorAll("[data-remove-assignment]").forEach((button) => button.addEventListener("click", () => {const address=parseInt(button.dataset.removeAssignment,16);this._hardwareDraft.device_assignments=(this._hardwareDraft.device_assignments||[]).filter((item)=>Number(item.address)!==address);this._saveHardware();}));
    this.shadowRoot.querySelectorAll("[data-device-settings]").forEach((button) => button.addEventListener("click", () => {
      const address=parseInt(button.dataset.deviceSettings,16);
      const assignment=(this._hardwareDraft.device_assignments||[]).find((entry)=>Number(entry.address)===address);
      this._deviceSettings=JSON.parse(JSON.stringify(assignment));this._deviceNotice="";this._calibrationStatus="";
      if(this._deviceSettings.driver==="waveshare_motor_hat"&&!this._deviceSettings.channels)this._deviceSettings.channels=[{id:"A",name:"Motor A",fluid_id:"unassigned"},{id:"B",name:"Motor B",fluid_id:"unassigned"}];
      this._render();
    }));
  }
  _wireDosing(){
    this.shadowRoot.querySelector("[data-add-fluid]")?.addEventListener("click",()=>this._addDosingFluid());
    this.shadowRoot.querySelectorAll("[data-remove-fluid]").forEach((button)=>button.addEventListener("click",()=>this._removeDosingFluid(button.dataset.removeFluid)));
  }
  _updateDriverNote(){const notes={waveshare_motor_hat:"İki çıkış: Motor A ve Motor B. Adres aralığı 0x40–0x5F.",atlas_do:"Atlas EZO çözünmüş oksijen devresi.",atlas_ph:"Atlas EZO pH devresi.",atlas_ec:"Atlas EZO iletkenlik ve TDS devresi.",atlas_rtd:"Atlas EZO RTD su sıcaklığı devresi.",pca9685_generic:"Genel 16 kanallı PCA9685; motor eşlemesi uygulanmaz."};const el=this.shadowRoot.querySelector("[data-driver-note]");if(el)el.textContent=notes[this._newI2CDriver]||"";}
  _addI2CDevice(){
    const addressText=this.shadowRoot.querySelector("[data-new-address]")?.value?.trim();
    const address=Number(addressText?.toLowerCase().startsWith("0x")?parseInt(addressText,16):addressText);
    const name=this.shadowRoot.querySelector("[data-new-name]")?.value?.trim();
    if(!Number.isInteger(address)||address<0x08||address>0x77){alert("Geçerli bir 7-bit I²C adresi girin (0x08–0x77).");return;}
    const defaults={waveshare_motor_hat:"Waveshare Motor Driver HAT",pca9685_generic:"PCA9685",atlas_do:"Atlas EZO DO",atlas_ph:"Atlas EZO pH",atlas_ec:"Atlas EZO EC",atlas_rtd:"Atlas EZO RTD"};
    this._enrollI2C(address,name||defaults[this._newI2CDriver],this._newI2CDriver);
  }
  _enrollI2C(address,name,driver){
    this._hardwareDraft.device_assignments ||= [];
    this._hardwareDraft.device_assignments=this._hardwareDraft.device_assignments.filter((item)=>Number(item.address)!==address);
    const assignment={address,driver,name};
    if(driver==="waveshare_motor_hat")assignment.channels=[{id:"A",name:"Motor A",fluid_id:"unassigned"},{id:"B",name:"Motor B",fluid_id:"unassigned"}];
    this._hardwareDraft.device_assignments.push(assignment);
    this._selectedCandidate=null;this._saveHardware();
  }
  async _saveHardware() {
    this._hardwareNotice="Kaydediliyor…";const status=this.shadowRoot.querySelector("[data-hardware-status]"); if(status)status.textContent=this._hardwareNotice;
    try {
      const result=await this._hass.connection.sendMessagePromise({type:"grow_system/hardware/save",poll_interval:Number(this._hardwareDraft.poll_interval||30),device_assignments:this._hardwareDraft.device_assignments||[],dosing_fluids:this._hardwareDraft.dosing_fluids||[]});
      if(result.reloading){this._hardwareNotice="Sensör entity’leri arka planda hazırlanıyor…";this._render();this._refreshHardwareAfterReload();}
      else{this._config=await this._hass.connection.sendMessagePromise({type:"grow_system/config/get"});this._hardwareDraft=JSON.parse(JSON.stringify(this._config.hardware_config));this._hardwareNotice="Ayarlar kaydedildi";this._render();}
    } catch(error) { this._hardwareNotice=`Kaydedilemedi: ${error.message||error}`;if(status)status.textContent=this._hardwareNotice; }
  }
  async _refreshHardwareAfterReload() {
    for(let attempt=0;attempt<12;attempt++){
      await new Promise((resolve)=>setTimeout(resolve,750));
      try{
        const config=await this._hass.connection.sendMessagePromise({type:"grow_system/config/get"});
        this._config=config;this._hardwareDraft=JSON.parse(JSON.stringify(config.hardware_config));
        this._hardwareNotice="Cihaz hazır";this._deviceNotice="";this._render();return;
      }catch(_){/* Integration is briefly unavailable while entities are recreated. */}
    }
    this._hardwareNotice="Cihaz kaydedildi; entity yenilemesi sürüyor. Biraz sonra tekrar kontrol edin.";this._render();
  }
  _wireDeviceSettings(){
    if(!this._deviceSettings)return;
    this.shadowRoot.querySelectorAll("[data-close-device-dialog]").forEach((el)=>el.addEventListener("click",()=>{this._deviceSettings=null;this._render();}));
    this.shadowRoot.querySelector("[data-dialog-scrim]")?.addEventListener("click",(event)=>{if(event.target===event.currentTarget){this._deviceSettings=null;this._render();}});
    const fluids=[{value:"unassigned",label:"Bağlantı atanmadı"},...(this._hardwareDraft.dosing_fluids||[]).map((fluid)=>({value:fluid.id,label:fluid.name}))];
    const channels=this._deviceSettings.channels||[];
    this.shadowRoot.querySelectorAll("[data-channel-name]").forEach((field)=>field.addEventListener("input",()=>{channels[Number(field.dataset.channelName)].name=field.value;}));
    this.shadowRoot.querySelectorAll("[data-channel-fluid]").forEach((picker)=>{const index=Number(picker.dataset.channelFluid);picker.hass=this._hass;picker.selector={select:{options:fluids,mode:"dropdown"}};picker.value=channels[index].fluid_id||channels[index].role||"unassigned";picker.addEventListener("value-changed",(event)=>{channels[index].fluid_id=event.detail.value;delete channels[index].role;});});
    const operations={atlas_ph:["low","mid","high","clear"],atlas_do:["atmospheric","zero","clear"],atlas_ec:["dry","one","low","high","clear"],atlas_rtd:["reference","clear"]}[this._deviceSettings.driver]||[];
    const operation=this.shadowRoot.querySelector("[data-cal-operation]");if(operation){operation.hass=this._hass;operation.selector={select:{options:operations.map((value)=>({value,label:value})),mode:"dropdown"}};operation.value=operations[0];}
    this.shadowRoot.querySelector("[data-read-calibration]")?.addEventListener("click",()=>this._readCalibration());
    this.shadowRoot.querySelector("[data-run-calibration]")?.addEventListener("click",()=>this._runCalibration());
    this.shadowRoot.querySelector("[data-save-device]")?.addEventListener("click",()=>this._saveDeviceSettings());
  }
  async _saveDeviceSettings(){
    this._deviceSettings.name=this.shadowRoot.querySelector("[data-device-name]")?.value?.trim()||this._deviceSettings.name;
    const index=(this._hardwareDraft.device_assignments||[]).findIndex((item)=>Number(item.address)===Number(this._deviceSettings.address));
    if(index>=0)this._hardwareDraft.device_assignments[index]=JSON.parse(JSON.stringify(this._deviceSettings));
    this._deviceSettings=null;await this._saveHardware();
  }
  _fluidId(name){return `fluid_${name.toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"").slice(0,30)||Date.now()}`;}
  _addDosingFluid(){
    const field=this.shadowRoot.querySelector("[data-new-fluid-name]");const name=field?.value?.trim();
    if(!name){this._hardwareNotice="Besin veya katkı adı girin.";this._render();return;}
    this._hardwareDraft.dosing_fluids||=[];let id=this._fluidId(name),suffix=2;while(this._hardwareDraft.dosing_fluids.some((fluid)=>fluid.id===id))id=`${this._fluidId(name)}_${suffix++}`;
    this._hardwareDraft.dosing_fluids.push({id,name,required:false});this._saveHardware();
  }
  _removeDosingFluid(id){
    const used=(this._hardwareDraft.device_assignments||[]).some((item)=>(item.channels||[]).some((channel)=>(channel.fluid_id||channel.role)===id));
    if(used){this._hardwareNotice="Bu besin bir motor kanalına bağlı. Önce kanal bağlantısını kaldırın.";this._render();return;}
    this._hardwareDraft.dosing_fluids=(this._hardwareDraft.dosing_fluids||[]).filter((fluid)=>fluid.id!==id||fluid.required);this._saveHardware();
  }
  async _readCalibration(){
    try{const result=await this._hass.connection.sendMessagePromise({type:"grow_system/hardware/calibration_status",address:this._deviceSettings.address});this._calibrationStatus=result.status;this._deviceNotice="Kalibrasyon durumu okundu";this._render();}
    catch(error){this._deviceNotice=`Durum okunamadı: ${error.message||error}`;this._render();}
  }
  async _runCalibration(){
    const operation=this.shadowRoot.querySelector("[data-cal-operation]")?.value;
    const confirmed=this.shadowRoot.querySelector("[data-cal-confirm]")?.checked;
    const valueText=this.shadowRoot.querySelector("[data-cal-value]")?.value;
    const needsValue=["low","mid","high","one","reference"].includes(operation);
    if(!confirmed){this._deviceNotice="Önce probun doğru referans ortamında olduğunu onaylayın.";this._render();return;}
    if(needsValue&&!Number.isFinite(Number(valueText))){this._deviceNotice="Bu işlem için geçerli bir referans değeri girin.";this._render();return;}
    try{await this._hass.connection.sendMessagePromise({type:"grow_system/hardware/calibrate",address:this._deviceSettings.address,operation,value:needsValue?Number(valueText):undefined,confirmed:true});this._deviceNotice="Kalibrasyon komutu tamamlandı";await this._readCalibration();}
    catch(error){this._deviceNotice=`Kalibrasyon başarısız: ${error.message||error}`;this._render();}
  }

  async _saveProfile() {
    this._notice="Kaydediliyor…"; this._updateNotice();
    try { const saved=await this._hass.connection.sendMessagePromise({type:"grow_system/profile/save",stage:this._editingStage,values:this._draft}); this._config.profiles[this._editingStage]=saved; this._draft={...saved}; this._notice="Profil kaydedildi"; }
    catch(error){this._notice=`Kaydedilemedi: ${error.message||error}`;} this._updateNotice();
  }
  async _activate() {
    if (this._editingStage===this._config.active_stage) return;
    if (!confirm(`${this._draft.name} aktif aşama yapılsın mı? Otomatik kontrol kapalı kalacak.`)) return;
    await this._hass.connection.sendMessagePromise({type:"grow_system/stage/select",stage:this._editingStage}); this._config.active_stage=this._editingStage; this._render();
  }
  _updateNotice(){const el=this.shadowRoot?.querySelector("[data-status]");if(el)el.textContent=this._notice;}
  _refreshReadings(){if(this._tab==="overview"&&this._config)this._render();}

  _render() {
    if (!this.shadowRoot) return;
    if (!this._config || !this._draft) { this.shadowRoot.innerHTML=`<style>${GrowSystemPanel.styles}</style><div class="loading"><ha-circular-progress active></ha-circular-progress>Grow System yükleniyor…</div>`; return; }
    const body=this._tab==="overview"?`${this._securityOverview()}${this._overview()}`:this._tab==="profiles"?this._profiles():this._tab==="hardware"?this._hardwareView():this._tab==="nutrients"?this._nutrientsView():this._settingsView();
    const missing=this._missingSettings();
    this.shadowRoot.innerHTML=`<style>${GrowSystemPanel.styles}</style><main><header><div><h1>Grow System</h1><p>Yetiştirme sistemi yönetimi</p></div><div class="system-summary"><div class="engine"><ha-icon icon="mdi:shield-check-outline"></ha-icon><span><b>Otomatik kontrol kapalı</b><small>Ekipmanlara komut gönderilmiyor</small></span></div><div class="missing ${missing.length ? "" : "complete"}"><ha-icon icon="${missing.length ? "mdi:alert-circle-outline" : "mdi:check-circle-outline"}"></ha-icon><span><b>${missing.length ? `${missing.length} ayar tamamlanmamış` : "Tüm bağlantılar hazır"}</b><small>${missing.length ? missing.join(", ") : "Eksik bağlantı yok"}</small></span></div></div></header>
      <ha-card header="Yetiştirme aşaması" class="stage-card"><div class="card-content stage-grid">${this._stageRail()}</div></ha-card>
      <nav><button data-tab="overview" class="${this._tab==="overview"?"active":""}"><ha-icon icon="mdi:view-dashboard-outline"></ha-icon>Genel bakış</button><button data-tab="profiles" class="${this._tab==="profiles"?"active":""}"><ha-icon icon="mdi:tune-variant"></ha-icon>Profiller</button><button data-tab="settings" class="${this._tab==="settings"?"active":""}"><ha-icon icon="mdi:cog-outline"></ha-icon>Ayarlar</button><button data-tab="hardware" class="${this._tab==="hardware"?"active":""}"><ha-icon icon="mdi:memory"></ha-icon>Donanım</button><button data-tab="nutrients" class="${this._tab==="nutrients"?"active":""}"><ha-icon icon="mdi:flask-outline"></ha-icon>Besinler</button></nav>${body}</main>${this._deviceSettingsDialog()}`;
    this.shadowRoot.querySelectorAll("[data-stage]").forEach((b)=>b.onclick=()=>{this._editingStage=b.dataset.stage;this._draft={...this._config.profiles[this._editingStage]};this._render();});
    this.shadowRoot.querySelectorAll("[data-tab]").forEach((b)=>b.onclick=()=>{this._tab=b.dataset.tab;this._notice="";this._render();});
    this.shadowRoot.querySelectorAll("[data-field]").forEach((el)=>el.addEventListener("input",(ev)=>{this._draft[ev.currentTarget.dataset.field]=Number(ev.currentTarget.value);this._notice="Kaydedilmemiş değişiklikler var";this._updateNotice();}));
    this.shadowRoot.querySelector("[data-save-profile]")?.addEventListener("click",()=>this._saveProfile());
    this.shadowRoot.querySelector("[data-activate]")?.addEventListener("click",()=>this._activate());
    this.shadowRoot.querySelector("[data-save-settings]")?.addEventListener("click",()=>this._saveSettings());
    if(this._tab==="settings")this._wireSelectors();
    if(this._tab==="hardware"){this._wireHardware();this._wireDeviceSettings();}
    if(this._tab==="nutrients")this._wireDosing();
  }

  static get styles(){return `
    :host{display:block;min-height:100%;color:var(--primary-text-color);background:var(--primary-background-color);font-family:var(--paper-font-body1_-_font-family,Roboto,sans-serif)}*{box-sizing:border-box}main{max-width:1280px;margin:auto;padding:24px 16px 48px}header{display:flex;align-items:center;justify-content:space-between;gap:24px;margin:0 4px 24px}h1{margin:0;font-size:28px;font-weight:400}header p{margin:4px 0 0;color:var(--secondary-text-color);font-size:14px}.engine{display:flex;align-items:center;gap:12px}.engine ha-icon{color:var(--success-color,#43a047)}.engine span,.engine small{display:block}.engine b{font-size:14px;font-weight:500}.engine small{margin-top:2px;color:var(--secondary-text-color);font-size:12px}ha-card{display:block;overflow:hidden}.card-content{padding:16px}.stage-card{margin-bottom:16px}.stage-grid{display:grid;grid-template-columns:repeat(5,minmax(120px,1fr));gap:8px;padding-top:0}.stage{position:relative;min-height:82px;padding:12px;border:1px solid var(--divider-color);border-radius:var(--ha-card-border-radius,12px);color:var(--primary-text-color);background:var(--card-background-color);text-align:left;cursor:pointer}.stage:hover{background:var(--secondary-background-color)}.stage.selected{padding:11px;border:2px solid var(--primary-color);background:color-mix(in srgb,var(--primary-color) 8%,var(--card-background-color))}.stage ha-icon{display:block;margin-bottom:8px;color:var(--state-icon-color)}.stage.selected ha-icon{color:var(--primary-color)}.stage span{display:block;font-size:14px;font-weight:500}.stage small{color:var(--secondary-text-color)}.stage b{position:absolute;top:8px;right:8px;padding:3px 7px;border-radius:10px;color:var(--text-primary-color,#fff);background:var(--primary-color);font-size:10px}nav{display:flex;gap:4px;margin:0 0 16px;border-bottom:1px solid var(--divider-color)}nav button{display:flex;align-items:center;gap:8px;padding:12px 16px;border:0;border-bottom:2px solid transparent;color:var(--secondary-text-color);background:transparent;font:500 14px inherit;cursor:pointer}nav button.active{border-color:var(--primary-color);color:var(--primary-color)}nav ha-icon{--mdc-icon-size:20px}.metric-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.metric-card{padding:16px}.metric-head{display:grid;grid-template-columns:32px 1fr auto;align-items:center;gap:8px}.metric-head>ha-icon{color:var(--state-icon-color)}.metric-head span,.metric-head small{display:block}.metric-head small,.chart-foot,.no-history{color:var(--secondary-text-color);font-size:11px}.metric-head strong{font-size:24px;font-weight:400}.metric-head i{margin-left:5px;color:var(--secondary-text-color);font-size:12px;font-style:normal}.chart{width:100%;height:105px;margin:16px 0 4px;color:var(--primary-color)}.chart polyline{fill:none;stroke:currentColor;stroke-width:2;vector-effect:non-scaling-stroke}.chart line{stroke:var(--divider-color);stroke-width:1}.chart-foot{display:flex;justify-content:space-between}.no-history{display:grid;height:105px;place-items:center;margin:16px 0 4px;background:var(--secondary-background-color);border-radius:8px}.security-card{margin-top:16px;padding:16px}.security-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}.security-head>div,.security-head span,.security-head small{display:flex}.security-head>div{align-items:center;gap:10px}.security-head span{flex-direction:column}.security-head small{margin-top:3px;color:var(--secondary-text-color);font-size:12px}.security-head strong{display:flex;align-items:center;gap:5px;color:var(--error-color,#db4437)}.camera-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}.camera{overflow:hidden;border:1px solid var(--divider-color);border-radius:10px}.camera-image{display:grid;aspect-ratio:16/9;place-items:center;background:#111}.camera-image img{width:100%;height:100%;object-fit:cover}.camera>span{display:flex;align-items:center;gap:8px;padding:10px;font-size:13px}.camera>span ha-icon{--mdc-icon-size:18px}.leak-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin-top:12px}.leak{display:flex;align-items:center;gap:10px;padding:12px;border:1px solid var(--divider-color);border-radius:10px}.leak span,.leak small{display:block}.leak small{margin-top:3px;color:var(--secondary-text-color)}.leak.safe ha-icon{color:var(--success-color,#43a047)}.leak.alarm{border-color:var(--error-color,#db4437);background:color-mix(in srgb,var(--error-color,#db4437) 10%,var(--card-background-color))}.leak.alarm ha-icon{color:var(--error-color,#db4437)}.leak.unknown ha-icon{color:var(--warning-color,#ff9800)}.security-empty{padding:18px;color:var(--secondary-text-color);background:var(--secondary-background-color);border-radius:8px;text-align:center;font-size:13px}.security-empty+.security-empty{margin-top:10px}h2{display:flex;align-items:center;gap:10px;margin:4px 0 18px;font-size:16px;font-weight:500}h2 ha-icon{color:var(--state-icon-color)}.fields{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:16px}.fields.three{grid-template-columns:repeat(3,minmax(120px,1fr))}ha-textfield{width:100%}.divider{height:1px;margin:24px 0;background:var(--divider-color)}.card-actions,.settings-actions{display:flex;min-height:64px;padding:8px 16px;align-items:center;justify-content:space-between;gap:16px;border-top:1px solid var(--divider-color)}.card-actions span,.settings-actions span{color:var(--secondary-text-color);font-size:13px}.settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.hardware-card{grid-column:1/-1}.hardware-status,.hardware-device{display:flex;align-items:center;gap:12px}.hardware-status span,.hardware-status small,.hardware-device span,.hardware-device small{display:block}.hardware-status ha-icon{color:var(--warning-color,#ff9800)}.hardware-status.ready ha-icon{color:var(--success-color,#43a047)}.hardware-status small,.hardware-device small,.hardware-note{margin-top:3px;color:var(--secondary-text-color);font-size:12px}.hardware-devices{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px;margin-top:16px}.hardware-device{padding:12px;border:1px solid var(--divider-color);border-radius:10px}.hardware-device ha-icon{color:var(--primary-color)}.hardware-note{margin-bottom:0}.settings-actions{grid-column:1/-1;padding:8px 0;border-top:0}.settings-list{padding-top:0}.setting{display:grid;grid-template-columns:minmax(180px,1fr) minmax(260px,1.5fr);align-items:center;gap:24px;padding:16px 0;border-bottom:1px solid var(--divider-color)}.setting:last-child{border-bottom:0}.setting span,.setting small{display:block}.setting span{font-size:14px}.setting small{margin-top:4px;color:var(--secondary-text-color);font-size:12px;line-height:1.4}.loading{display:grid;min-height:60vh;place-items:center;color:var(--secondary-text-color)}
    .system-summary{display:flex;align-items:center;gap:24px}.missing{display:flex;align-items:center;gap:10px;max-width:420px}.missing>ha-icon{flex:0 0 auto;color:var(--warning-color,#ff9800)}.missing.complete>ha-icon{color:var(--success-color,#43a047)}.missing span,.missing small{display:block}.missing b{font-size:14px;font-weight:500}.missing small{margin-top:3px;color:var(--secondary-text-color);font-size:11px;line-height:1.35}.security-card{margin:0 0 16px}.camera-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.water-level{display:grid;grid-template-columns:28px 1fr auto;align-items:center;gap:10px;margin-top:12px;padding:12px;border:1px solid var(--divider-color);border-radius:10px}.water-level>ha-icon{color:var(--primary-color)}.water-level span,.water-level small{display:block}.water-level small{margin-top:3px;color:var(--secondary-text-color);font-size:11px}.water-level strong{font-size:16px;font-weight:500}.water-level.unknown>ha-icon{color:var(--warning-color,#ff9800)}
    .hardware-title{margin-top:24px}.hardware-device{display:grid;grid-template-columns:24px 1fr auto}.safe-badge{padding:4px 8px;border-radius:12px;color:var(--success-color,#43a047);background:color-mix(in srgb,var(--success-color,#43a047) 12%,transparent);font-size:11px}.hardware-options{display:grid;grid-template-columns:1fr 180px;align-items:center;gap:24px;margin:20px 0}.hardware-options label{display:flex;align-items:center;gap:12px}.manual-device{display:grid;grid-template-columns:1fr 150px 220px 44px;align-items:center;gap:8px;margin:8px 0}.hardware-actions{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:20px;padding-top:16px;border-top:1px solid var(--divider-color)}
    .i2c-heading{display:flex;align-items:center;justify-content:space-between;padding:24px 28px;border-bottom:1px solid var(--divider-color)}.i2c-heading h2{margin:4px 0;font-size:22px;font-weight:500}.i2c-heading p{margin:0;color:var(--secondary-text-color);font-size:13px}.eyebrow{color:var(--secondary-text-color);font:600 11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.06em;text-transform:uppercase}.bus-health{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:500}.bus-health>span{width:8px;height:8px;border-radius:50%;background:var(--error-color)}.bus-health.online>span{background:var(--success-color,#43a047);box-shadow:0 0 0 4px color-mix(in srgb,var(--success-color,#43a047) 12%,transparent)}.i2c-workspace{display:grid;grid-template-columns:minmax(0,2fr) minmax(320px,1fr)}.bus-inventory{padding:24px 28px;border-right:1px solid var(--divider-color)}.section-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.section-head h3,.device-adder h3{margin:0 0 3px;font-size:16px}.section-head small{color:var(--secondary-text-color)}.section-head ha-textfield{width:150px}.bus-row{display:grid;grid-template-columns:62px 28px minmax(0,1fr) auto 40px 40px;align-items:center;gap:8px;min-height:68px;padding:10px 4px;border-top:1px solid var(--divider-color)}.bus-row code,.candidate code,.editor-address code{color:var(--primary-color);font:600 12px ui-monospace,SFMono-Regular,Menlo,monospace}.bus-row>ha-icon{color:var(--state-icon-color)}.bus-row b,.bus-row small{display:block}.bus-row b{font-size:14px;font-weight:500}.bus-row small{margin-top:3px;color:var(--secondary-text-color);font-size:11px}.channel-line{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}.channel-line span{padding:3px 7px;border:1px solid var(--divider-color);border-radius:4px;color:var(--secondary-text-color);font:10px ui-monospace,SFMono-Regular,Menlo,monospace}.status-dot{display:flex;align-items:center;gap:6px;color:var(--secondary-text-color);font-size:11px}.status-dot:before{width:7px;height:7px;border-radius:50%;background:currentColor;content:""}.status-dot.ready{color:var(--success-color,#43a047)}.status-dot.attention{color:var(--warning-color,#ff9800)}.device-adder{padding:24px;background:color-mix(in srgb,var(--secondary-background-color) 55%,transparent)}.device-adder>p{margin:5px 0 16px;color:var(--secondary-text-color);font-size:12px;line-height:1.45}.candidate-list{display:grid;gap:6px;max-height:280px;overflow:auto}.candidate{display:grid;grid-template-columns:52px 1fr 20px;align-items:center;gap:8px;width:100%;padding:10px;border:1px solid var(--divider-color);border-radius:7px;color:var(--primary-text-color);background:var(--card-background-color);text-align:left;cursor:pointer}.candidate:hover,.candidate.selected{border-color:var(--primary-color);background:var(--secondary-background-color)}.candidate span,.candidate small{display:block}.candidate b{font-size:12px;font-weight:500}.candidate small,.candidate-empty{margin-top:3px;color:var(--secondary-text-color);font-size:10px}.candidate ha-icon{--mdc-icon-size:17px;color:var(--secondary-text-color)}.candidate-empty{padding:16px;text-align:center}.candidate-editor{display:grid;gap:12px;margin-top:10px;padding:14px;border:1px solid var(--primary-color);border-radius:8px;background:var(--card-background-color)}.editor-address,.locked-driver{display:grid;grid-template-columns:48px 1fr;align-items:center;gap:10px}.editor-address span,.editor-address small,.locked-driver span,.locked-driver small{display:block}.editor-address b,.locked-driver b{font-size:12px}.editor-address small,.locked-driver small{margin-top:2px;color:var(--secondary-text-color);font-size:10px}.locked-driver{grid-template-columns:24px 1fr;padding:9px;background:var(--secondary-background-color);border-radius:6px}.locked-driver ha-icon{--mdc-icon-size:18px;color:var(--success-color,#43a047)}.device-adder ha-textfield,.device-adder ha-selector{display:block;width:100%;margin-bottom:12px}.manual-add{margin-top:18px;border-top:1px solid var(--divider-color)}.manual-add summary{display:flex;align-items:center;justify-content:space-between;padding:14px 0;color:var(--secondary-text-color);font-size:12px;cursor:pointer}.manual-add summary small{font-size:9px;text-transform:uppercase}.manual-add>div{padding-top:4px}.inline-save{min-height:18px;margin-top:10px;color:var(--secondary-text-color);font-size:11px}.hardware-card>.hardware-actions{margin:0;padding:12px 28px}.hardware-card>.hardware-actions span{color:var(--secondary-text-color);font-size:12px}
    .dialog-scrim{position:fixed;z-index:1000;inset:0;display:grid;place-items:center;padding:20px;background:rgba(0,0,0,.58)}.device-dialog{width:min(760px,100%);max-height:min(860px,calc(100vh - 40px));overflow:auto;border-radius:14px;color:var(--primary-text-color);background:var(--card-background-color);box-shadow:0 18px 55px rgba(0,0,0,.4)}.dialog-head,.dialog-actions{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid var(--divider-color)}.dialog-head h2{margin:3px 0 0;font-size:22px}.dialog-body{display:grid;gap:18px;padding:22px}.dialog-actions{justify-content:flex-end;gap:8px;border-top:1px solid var(--divider-color);border-bottom:0}.device-note{display:flex;align-items:flex-start;gap:10px;padding:12px;border-radius:8px;background:var(--secondary-background-color)}.device-note.safe ha-icon{color:var(--success-color,#43a047)}.device-note span,.device-note small{display:block}.device-note small{margin-top:4px;color:var(--secondary-text-color);font-size:12px}.motor-channels{display:grid;gap:10px}.motor-channels section{display:grid;grid-template-columns:130px 1fr 1fr;align-items:center;gap:12px;padding:12px;border:1px solid var(--divider-color);border-radius:9px}.motor-channels section b,.motor-channels section small{display:block}.motor-channels section small{margin-top:3px;color:var(--secondary-text-color);font-size:11px}.device-facts{display:grid;grid-template-columns:1fr 1fr auto;align-items:center;gap:12px;padding:12px;border:1px solid var(--divider-color);border-radius:9px}.device-facts span,.device-facts small{display:block}.device-facts small{color:var(--secondary-text-color);font-size:11px}.calibration-box{display:grid;gap:12px;padding:16px;border:1px solid var(--divider-color);border-radius:9px}.calibration-box h3{margin:0;font-size:16px}.calibration-box p{margin:0;color:var(--secondary-text-color);font-size:12px;line-height:1.5}.calibration-box label{display:flex;align-items:center;gap:8px;font-size:12px}.device-message{min-height:18px;color:var(--secondary-text-color);font-size:12px}
    .hardware-view{display:grid;gap:16px}.dosing-card{padding:24px 28px}.dosing-head{display:flex;align-items:flex-start;justify-content:space-between;padding-bottom:18px;border-bottom:1px solid var(--divider-color)}.dosing-head h2{margin:4px 0;font-size:20px}.dosing-head p{margin:0;color:var(--secondary-text-color);font-size:12px}.fluid-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px;padding:18px 0}.fluid-row{display:grid;grid-template-columns:28px 1fr auto;align-items:center;gap:10px;padding:12px;border:1px solid var(--divider-color);border-radius:8px}.fluid-row>ha-icon{color:var(--state-icon-color)}.fluid-row span,.fluid-row small{display:block}.fluid-row small{margin-top:3px;color:var(--secondary-text-color);font-size:11px}.required-badge{padding:4px 7px;border-radius:10px;color:var(--primary-color);background:color-mix(in srgb,var(--primary-color) 12%,transparent);font-size:10px}.fluid-add{display:grid;grid-template-columns:minmax(240px,420px) auto;align-items:center;gap:10px;padding-top:16px;border-top:1px solid var(--divider-color)}
    @media(max-width:900px){.stage-grid{overflow-x:auto;grid-template-columns:repeat(5,minmax(145px,1fr))}.metric-grid,.settings-grid{grid-template-columns:1fr}.settings-actions{grid-column:1}.fields{grid-template-columns:repeat(2,1fr)}.camera-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.system-summary{align-items:flex-start;flex-direction:column;gap:12px}.i2c-workspace{grid-template-columns:1fr}.bus-inventory{border-right:0;border-bottom:1px solid var(--divider-color)}.motor-channels section{grid-template-columns:1fr 1fr}.motor-channels section>div{grid-column:1/-1}}@media(max-width:650px){main{padding:16px 8px 32px}header{align-items:flex-start;flex-direction:column}.setting{grid-template-columns:1fr;gap:10px}.fields,.fields.three{grid-template-columns:1fr}nav button{flex:1;justify-content:center;padding:12px 6px}.card-actions{align-items:stretch;flex-direction:column}.camera-grid{grid-template-columns:1fr}.i2c-heading,.section-head{align-items:flex-start;flex-direction:column;gap:12px}.bus-inventory,.device-adder{padding:18px}.bus-row{grid-template-columns:50px 24px minmax(0,1fr) 36px 36px}.bus-row .status-dot{display:none}.channel-line{display:none}.motor-channels section,.device-facts{grid-template-columns:1fr}.motor-channels section>div{grid-column:auto}.dialog-body{padding:16px}}
  `;}
}
if(!customElements.get("grow-system-panel"))customElements.define("grow-system-panel",GrowSystemPanel);
