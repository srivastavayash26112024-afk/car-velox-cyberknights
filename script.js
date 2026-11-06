// CYBERKNIGHTS COMMAND CENTRE — DEMO MODE
// The dashboard is simulated. No Arduino data is read in this version.

const $ = (id) => document.getElementById(id);

let speed = 0;
let maxSpeed = 0;
let distance = 0;
let battery = 100;
let vehicleCount = 0;
let tollCount = 0;
let revenue = 0;
let running = false;
let barrierOpen = false;
let timer = null;
let history = [];
let lastFrame = 0;

// ===== TWO INDEPENDENT ARDUINO CONNECTIONS =====
// Toll controller and speed radar are separate boards. Each gets its own
// Web Serial port and reader so both can remain connected simultaneously.
let serialPort = null;
let serialReader = null;
let hardwareConnected = false;
let hardwareDirection = "STOP";
let serialBuffer = "";

let radarPort = null;
let radarReader = null;
let radarConnected = false;
let radarBuffer = "";

function serialSupported() {
  if (!("serial" in navigator)) {
    alert("Web Serial is unavailable. Open this HTTPS site in Chrome or Edge on a computer.");
    return false;
  }
  return true;
}

async function connectArduino() {
  if (!serialSupported()) return;
  try {
    serialPort = await navigator.serial.requestPort();
    await serialPort.open({ baudRate: 9600 });
    hardwareConnected = true;
    $("arduinoStatus").textContent = "TOLL ARDUINO CONNECTED";
    $("arduinoConnectBtn").textContent = "Disconnect Toll";
    log("Toll controller connected at 9600 baud.");
    const decoder = new TextDecoder();
    serialReader = serialPort.readable.getReader();
    while (true) {
      const { value, done } = await serialReader.read();
      if (done) break;
      serialBuffer += decoder.decode(value, { stream: true });
      const lines = serialBuffer.split(/\\r?\\n/);
      serialBuffer = lines.pop() || "";
      for (const line of lines) processTollData(line.trim());
    }
  } catch (error) {
    console.error(error);
    log("Toll Arduino connection error: " + error.message);
  } finally {
    if (serialReader) { try { serialReader.releaseLock(); } catch (_) {} serialReader = null; }
    const port = serialPort; serialPort = null; hardwareConnected = false;
    if (port) { try { await port.close(); } catch (_) {} }
    $("arduinoStatus").textContent = "TOLL ARDUINO DISCONNECTED";
    $("arduinoConnectBtn").textContent = "Connect Toll Arduino";
    update();
  }
}

async function connectSpeedRadar() {
  if (!serialSupported()) return;
  try {
    radarPort = await navigator.serial.requestPort();
    await radarPort.open({ baudRate: 9600 });
    radarConnected = true;
    $("radarStatus").textContent = "SPEED RADAR CONNECTED";
    $("radarConnectBtn").textContent = "Disconnect Radar";
    log("Speed radar connected at 9600 baud.");
    const decoder = new TextDecoder();
    radarReader = radarPort.readable.getReader();
    while (true) {
      const { value, done } = await radarReader.read();
      if (done) break;
      radarBuffer += decoder.decode(value, { stream: true });
      const lines = radarBuffer.split(/\\r?\\n/);
      radarBuffer = lines.pop() || "";
      for (const line of lines) processRadarData(line.trim());
    }
  } catch (error) {
    console.error(error);
    log("Speed radar connection error: " + error.message);
  } finally {
    if (radarReader) { try { radarReader.releaseLock(); } catch (_) {} radarReader = null; }
    const port = radarPort; radarPort = null; radarConnected = false;
    if (port) { try { await port.close(); } catch (_) {} }
    $("radarStatus").textContent = "SPEED RADAR DISCONNECTED";
    $("radarConnectBtn").textContent = "Connect Speed Radar";
    update();
  }
}

function processTollData(line) {
  if (!line) return;
  const normalized = line.toUpperCase();
  if (normalized === "GATE:OPEN" || normalized.includes("GATE OPENED")) {
    barrierOpen = true; update(); log("Physical toll gate is OPEN."); return;
  }
  if (normalized === "GATE:CLOSED" || normalized.includes("GATE CLOSED")) {
    barrierOpen = false; update(); log("Physical toll gate is CLOSED."); return;
  }
  if (normalized.startsWith("SENSOR:")) log("Toll controller " + line);
}

function processRadarData(line) {
  if (!line) return;
  // Supported line: speed = 25.5 km/h dir = A>B (or B>A).
  // Also accept a plain "SPEED:25.5,DIR:A>B" telemetry line.
  const match = line.match(/speed\\s*=\\s*([0-9]+(?:\\.[0-9]+)?)\\s*km\\/h\\s+dir\\s*=\\s*(A>B|B>A)/i)
    || line.match(/SPEED\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)\\s*,\\s*DIR\\s*:\\s*(A>B|B>A)/i);
  if (!match) {
    if (/^RADAR_READY$/i.test(line)) log("Speed radar is ready.");
    return;
  }
  speed = Number(match[1]);
  hardwareDirection = match[2].toUpperCase();
  maxSpeed = Math.max(maxSpeed, speed);
  vehicleCount++;
  running = speed > 0;
  history.push(speed);
  if (history.length > 30) history.shift();
  update();
  log("Speed radar: " + speed.toFixed(1) + " km/h, direction " + hardwareDirection);
}

async function sendGateCommand(command) {
  if (!hardwareConnected || !serialPort || !serialPort.writable) {
    log("Cannot send " + command + ": toll Arduino is not connected.");
    return false;
  }
  let writer;
  try {
    writer = serialPort.writable.getWriter();
    await writer.write(new TextEncoder().encode(command + "\\n"));
    log("Sent " + command + " command to toll Arduino.");
    return true;
  } catch (error) {
    log("Failed to send toll command: " + error.message);
    return false;
  } finally {
    if (writer) writer.releaseLock();
  }
}

async function disconnectArduino() {
  if (serialReader) { try { await serialReader.cancel(); } catch (_) {} }
}
async function disconnectSpeedRadar() {
  if (radarReader) { try { await radarReader.cancel(); } catch (_) {} }
}

const connectionPanel = document.createElement("div");
connectionPanel.style.cssText = "display:flex;align-items:center;gap:12px;margin:12px 0;flex-wrap:wrap;";
connectionPanel.innerHTML = `
  <button id="arduinoConnectBtn" style="padding:10px 16px;border-radius:8px;border:1px solid #40e8f2;background:#10283b;color:#40e8f2;cursor:pointer;">Connect Toll Arduino</button>
  <span id="arduinoStatus" style="color:#ffbf69;">TOLL ARDUINO DISCONNECTED</span>
  <button id="radarConnectBtn" style="padding:10px 16px;border-radius:8px;border:1px solid #4a8dff;background:#10283b;color:#9fc3ff;cursor:pointer;">Connect Speed Radar</button>
  <span id="radarStatus" style="color:#ffbf69;">SPEED RADAR DISCONNECTED</span>
`;
const activityArea = $("activityLog");
if (activityArea) activityArea.parentElement.insertBefore(connectionPanel, activityArea);
$("arduinoConnectBtn").addEventListener("click", () => {
  if (serialPort) disconnectArduino(); else connectArduino();
});
$("radarConnectBtn").addEventListener("click", () => {
  if (radarPort) disconnectSpeedRadar(); else connectSpeedRadar();
});

// Activity log
function log(message) {
  const area = $("activityLog");
  if (!area) return;
  const entry = document.createElement("p");
  entry.textContent = "[" + new Date().toLocaleTimeString() + "] " + message;
  area.prepend(entry);
  while (area.children.length > 30) area.removeChild(area.lastElementChild);
}

// Update dashboard values
function update() {
 $("speedValue").textContent = speed.toFixed(2);
  $("gaugeNumber").textContent = Math.round(speed);
  $("maxSpeed").textContent = Math.round(maxSpeed);
  $("distance").textContent = distance.toFixed(2);
  $("speedGauge").style.width = Math.min(100, speed / 60 * 100) + "%";
  $("speedGaugeRing").style.setProperty("--gauge", (Math.min(60, speed) / 60 * 270) + "deg");
  $("motorBar").style.width = Math.min(100, speed / 60 * 100) + "%";
  $("batteryBar").style.width = battery + "%";
  $("motorPercent").textContent = Math.round(speed / 60 * 100) + "%";
  $("batteryPercent").textContent = Math.round(battery) + "%";
  const selectedDirection = hardwareConnected
  ? hardwareDirection
  : $("directionSelect").value;
  $("direction").textContent = selectedDirection;
  $("sceneDirection").textContent = "Direction: " + selectedDirection;
  $("vehicleCount").textContent = vehicleCount;
  $("vehicleCountDetail").textContent = vehicleCount;
  $("tollCount").textContent = tollCount;
  $("revenue").textContent = "₹" + revenue.toLocaleString("en-IN");
  $("barrier").classList.toggle("open", barrierOpen);
  $("barrier").setAttribute("aria-label", barrierOpen ? "Barrier open" : "Barrier closed");
  $("barrierPill").textContent = barrierOpen ? "BARRIER OPEN" : "BARRIER CLOSED";
  $("barrierPill").classList.toggle("pill-amber", !barrierOpen);
  $("barrierPill").classList.toggle("pill-green", barrierOpen);
  $("barrierCaption").textContent = barrierOpen ? "ACCESS GRANTED" : "ACCESS RESTRICTED";
  $("barrierSummary").textContent = barrierOpen ? "OPEN" : "CLOSED";
  $("barrierSummary").style.color = barrierOpen ? "var(--green)" : "var(--amber)";
  $("barrierSummaryDot").style.background = barrierOpen ? "var(--green)" : "var(--amber)";
  $("speedCondition").textContent = speed >= 55 ? "Approaching speed limit" : speed > 0 ? "Vehicle in motion" : "Awaiting simulation";
  $("speedCondition").style.color = speed >= 55 ? "var(--amber)" : "";
  $("sceneVehicleStatus").textContent = running ? "IN MOTION" : "IDLE";
  $("gestureState").textContent = running ? "SIMULATION ACTIVE" : "STANDBY";
  $("sensorState").textContent = running ? "SIMULATED" : "READY";
  drawChart();
  if (window.cyberknightsScene) window.cyberknightsScene.setState({ speed, running, barrierOpen, direction: selectedDirection });
}

function drawChart() {
  const canvas = $("speedChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const width = Math.max(1, canvas.clientWidth || 300);
  const height = Math.max(1, canvas.clientHeight || 130);
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(90,120,155,.18)";
  ctx.lineWidth = 1;
  for (let y = 12; y < height; y += 25) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }
  if (history.length < 2) return;
  const points = history.map((value, index) => ({
    x: index * width / (history.length - 1),
    y: height - 8 - Math.min(60, value) / 60 * (height - 20)
  }));
  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, "#4a8dff"); gradient.addColorStop(1, "#40e8f2");
  ctx.beginPath();
  points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.lineTo(width, height); ctx.lineTo(0, height); ctx.closePath();
  const fill = ctx.createLinearGradient(0, 0, 0, height);
  fill.addColorStop(0, "rgba(64,232,242,.16)"); fill.addColorStop(1, "rgba(64,232,242,0)");
  ctx.fillStyle = fill; ctx.fill();
  ctx.beginPath();
  points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.strokeStyle = gradient; ctx.lineWidth = 2.2; ctx.lineJoin = "round"; ctx.stroke();
  const last = points[points.length - 1];
  ctx.beginPath(); ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
  ctx.fillStyle = "#40e8f2"; ctx.shadowColor = "#40e8f2"; ctx.shadowBlur = 8; ctx.fill(); ctx.shadowBlur = 0;
}

function start() {
    if (hardwareConnected) {
    log("Simulation is disabled while Arduino is connected.");
    return;
  }
  if (running) return;
  if (battery <= 0) { log("Battery empty. Press Reset to recharge."); return; }
  running = true;
  $("gestureState").textContent = "SIMULATION ACTIVE";
  $("sensorState").textContent = "SIMULATED";
  log("Vehicle simulation started.");
  timer = setInterval(() => {
    if ($("directionSelect").value === "STOP") speed = 0;
    else speed = Math.min(60, speed + Math.random() * 5);
    maxSpeed = Math.max(maxSpeed, speed);
    distance += speed / 3600;
    battery = Math.max(0, battery - 0.08);
    history.push(speed);
    if (history.length > 30) history.shift();
    update();
    if (battery <= 0) { pause(); log("Illustrative battery depleted. Simulation paused."); }
  }, 1000);
}

function pause() {
  if (timer !== null) clearInterval(timer);
  timer = null;
  const wasRunning = running;
  running = false;
  $("gestureState").textContent = "PAUSED";
  update();
  if (wasRunning) log("Simulation paused.");
}

function reset() {
  if (timer !== null) clearInterval(timer);
  timer = null; running = false;
  speed = 0; maxSpeed = 0; distance = 0; battery = 100; history = [];
  $("gestureState").textContent = "STANDBY";
  $("sensorState").textContent = "READY";
  update();
  log("Vehicle simulation reset.");
}

async function toggleBarrier() {
  const nextState = !barrierOpen;
  if (hardwareConnected) {
    const sent = await sendGateCommand(nextState ? "OPEN" : "CLOSE");
    if (!sent) return;
    // Physical gate state is updated only after Arduino confirms it over Serial.
    return;
  }
  barrierOpen = nextState;
  update();
  log(barrierOpen ? "Toll barrier opened (dashboard demo)." : "Toll barrier closed (dashboard demo).");
}

function vehiclePassed() {
  vehicleCount++;
  if (barrierOpen) {
    tollCount++;
    revenue += 50;
    log("Vehicle passed. ₹50 demo toll collected.");
  } else {
    log("Vehicle detected, but the barrier is closed.");
  }
  update();
}

$("startBtn").addEventListener("click", start);
$("pauseBtn").addEventListener("click", pause);
$("resetBtn").addEventListener("click", reset);
$("toggleBarrierBtn").addEventListener("click", toggleBarrier);
$("vehicleBtn").addEventListener("click", vehiclePassed);
$("directionSelect").addEventListener("change", () => {
  update();
  log("Direction changed to " + $("directionSelect").value + ".");
});
$("clearLogBtn").addEventListener("click", () => {
  $("activityLog").replaceChildren();
  log("Activity log cleared.");
});
window.addEventListener("resize", drawChart);

// 3D scene: Three.js loaded from a CDN. Internet is required for this section.
async function initThreeScene() {
  const host = $("threeScene");
  const loading = host.querySelector(".scene-loading");
  try {
    const THREE = await import("https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js");
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x09111d);
    scene.fog = new THREE.Fog(0x09111d, 24, 75);

    const camera = new THREE.PerspectiveCamera(42, host.clientWidth / host.clientHeight, 0.1, 150);
    camera.position.set(12, 13, 18);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.domElement.setAttribute("aria-label", "Interactive 3D highway scene. Drag to rotate and scroll to zoom.");
    renderer.domElement.tabIndex = 0;
    host.appendChild(renderer.domElement);
    if (loading) loading.classList.add("hidden");

    scene.add(new THREE.HemisphereLight(0x9bc9ff, 0x172032, 2.0));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
    keyLight.position.set(8, 16, 10); scene.add(keyLight);
    const cyanLight = new THREE.PointLight(0x22dff5, 22, 30);
    cyanLight.position.set(-5, 4, 0); scene.add(cyanLight);

    const mat = (color, roughness = .65, metalness = .15, emissive = 0x000000) =>
      new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive, emissiveIntensity: .6 });
    const groundMat = mat(0x0a1421, .95);
    const roadMat = mat(0x202c3d, .85);
    const laneMat = new THREE.MeshBasicMaterial({ color: 0x68819a });
    const cyanMat = new THREE.MeshStandardMaterial({ color: 0x37e7f2, emissive: 0x0b8392, emissiveIntensity: 1.4 });
    const amberMat = new THREE.MeshStandardMaterial({ color: 0xffc36c, emissive: 0x9d5111, emissiveIntensity: .7 });
    const greenMat = new THREE.MeshStandardMaterial({ color: 0x72f2b2, emissive: 0x1a8a59, emissiveIntensity: .8 });
    const whiteMat = mat(0xe5efff, .35, .35);
    const darkGlass = new THREE.MeshStandardMaterial({ color: 0x0a1928, metalness: .4, roughness: .2 });
    const addBox = (w, h, d, material, x, y, z, parent = scene) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z); parent.add(mesh); return mesh;
    };

    addBox(65, .3, 42, groundMat, 0, -.48, 0);
    // Road lanes run along the Z axis; toll plaza is at the far end.
    addBox(9, .12, 34, roadMat, 0, -.25, 0);
    addBox(.09, .02, 34, laneMat, 0, -.17, 0);
    for (let z = -14; z < 14; z += 4) addBox(.09, .025, 1.8, laneMat, 0, -.16, z);
    for (const x of [-4.7, 4.7]) {
      addBox(.18, .15, 34, cyanMat, x, -.13, 0);
      for (let z = -15; z < 15; z += 5) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(.22, .7, .22), cyanMat);
        lamp.position.set(x, .18, z); scene.add(lamp);
      }
    }
    // Sidewalks and landscaping blocks.
    for (const x of [-8, 8]) {
      addBox(5, .2, 34, mat(0x101d2d), x, -.32, 0);
      for (let z = -13; z < 15; z += 5) {
        addBox(1.2, .55, 1.2, mat(0x1a3340), x + (x < 0 ? -.4 : .4), -.03, z);
        const glow = new THREE.Mesh(new THREE.SphereGeometry(.11, 10, 8), greenMat);
        glow.position.set(x + (x < 0 ? -.4 : .4), .32, z); scene.add(glow);
      }
    }
    // Toll canopy and booths.
    const canopyMat = mat(0x162c43, .35, .5);
    addBox(13, .45, 4, canopyMat, 0, 3.05, -11.5);
    addBox(13.2, .08, 4.2, cyanMat, 0, 3.3, -11.5);
    for (const x of [-5.8, 5.8]) addBox(.3, 3, .3, canopyMat, x, 1.45, -11.5);
    for (const x of [-3.3, 3.3]) {
      addBox(1.5, 1.7, 1.6, mat(0x1b3a57, .35, .4), x, .7, -11.5);
      addBox(.9, .55, .07, cyanMat, x, .85, -10.66);
      addBox(1.7, .08, 1.8, mat(0x2d4761), x, 1.58, -11.5);
    }
    // Barrier arm, post and support; arm rotates when toll state changes.
    const barrierPivot = new THREE.Group();
    barrierPivot.position.set(-1.5, .38, -7.7);
    scene.add(barrierPivot);
    addBox(.25, .25, .25, amberMat, 0, 0, 0, barrierPivot);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(4.5, .12, .14), amberMat);
    arm.position.set(2.25, .25, 0); barrierPivot.add(arm);
    for (let x = .5; x < 4.5; x += .75) addBox(.13, .125, .15, whiteMat, x, .25, 0, barrierPivot);
    // Simple stylized low-poly cars built from body, cabin, windows and wheels.
    function makeCar(bodyColor, accentColor) {
      const group = new THREE.Group();
      const bodyMat = mat(bodyColor, .32, .35, bodyColor);
      const accent = new THREE.MeshStandardMaterial({ color: accentColor, emissive: accentColor, emissiveIntensity: 1.3 });
      addBox(1.25, .38, 2.1, bodyMat, 0, .38, 0, group);
      addBox(.92, .43, 1.0, mat(0x13283c, .25, .35), 0, .76, -.12, group);
      addBox(.72, .24, .06, darkGlass, 0, .76, .39, group);
      addBox(.72, .24, .06, darkGlass, 0, .76, -.62, group);
      addBox(.28, .12, .05, accent, -.38, .43, 1.06, group);
      addBox(.28, .12, .05, accent, .38, .43, 1.06, group);
      const wheelMat = mat(0x080c12, .9, .05);
      for (const x of [-.67, .67]) for (const z of [-.62, .62]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.19, .19, .12, 12), wheelMat);
        wheel.rotation.z = Math.PI / 2; wheel.position.set(x, .2, z); group.add(wheel);
      }
      group.position.y = -.05;
      scene.add(group);
      return group;
    }
    const cars = [
      { mesh: makeCar(0x2d94ff, 0x40e8f2), x: -2.1, z: 7.5, speed: .09 },
      { mesh: makeCar(0x32c994, 0x72f2b2), x: 2.0, z: 1.0, speed: .065 },
      { mesh: makeCar(0xc05cff, 0xe5a2ff), x: -2.1, z: -3.5, speed: .05 }
    ];
    cars.forEach((car, i) => { car.mesh.position.x = car.x; car.mesh.position.z = car.z; car.mesh.rotation.y = Math.PI; car.offset = i * 4.2; });

    // Decorative approach sensors and scanning arches.
    for (const z of [2.5, -1.5]) {
      for (const x of [-4.35, 4.35]) addBox(.16, 1.2, .16, cyanMat, x, .5, z);
      addBox(8.8, .12, .12, cyanMat, 0, 1.12, z);
    }
    // Background light strips.
    for (let i = 0; i < 12; i++) {
      addBox(.12, .12, 1.4, mat(0x223b55), -17 + i * 3, -.2, -16);
      addBox(.12, .12, 1.4, mat(0x223b55), -17 + i * 3, -.2, 16);
    }

    let currentState = { speed: 0, running: false, barrierOpen: false, direction: "STOP" };
    function setState(next) { currentState = { ...currentState, ...next }; }
    let dragging = false, previousX = 0, previousY = 0, rotationY = -.22, rotationX = .52, zoom = 1;
    renderer.domElement.addEventListener("pointerdown", e => { dragging = true; previousX = e.clientX; previousY = e.clientY; renderer.domElement.setPointerCapture(e.pointerId); });
    renderer.domElement.addEventListener("pointermove", e => {
      if (!dragging) return;
      rotationY += (e.clientX - previousX) * .008;
      rotationX = Math.max(.15, Math.min(1.05, rotationX + (e.clientY - previousY) * .004));
      previousX = e.clientX; previousY = e.clientY;
    });
    renderer.domElement.addEventListener("pointerup", () => dragging = false);
    renderer.domElement.addEventListener("pointercancel", () => dragging = false);
    renderer.domElement.addEventListener("wheel", e => { e.preventDefault(); zoom = Math.max(.72, Math.min(1.45, zoom + e.deltaY * .001)); }, { passive: false });

    const target = new THREE.Vector3(0, .3, -1);
    let frame = 0;
    function animate() {
      requestAnimationFrame(animate);
      frame += .01;
      // Vehicles animate independently as a visual illustration; speed simulation influences their pace.
      const pace = currentState.running && currentState.direction !== "STOP" ? .035 + currentState.speed * .0012 : .012;
      cars.forEach((car, i) => {
        car.mesh.position.z -= pace * (0.7 + i * .18);
        if (car.mesh.position.z < -9.3) car.mesh.position.z = 10 + i * 3.8;
        if (currentState.direction === "LEFT") car.mesh.position.x = THREE.MathUtils.lerp(car.mesh.position.x, -2.8, .025);
        else if (currentState.direction === "RIGHT") car.mesh.position.x = THREE.MathUtils.lerp(car.mesh.position.x, 2.8, .025);
        else car.mesh.position.x = THREE.MathUtils.lerp(car.mesh.position.x, car.x, .025);
      });
      barrierPivot.rotation.y = THREE.MathUtils.lerp(barrierPivot.rotation.y, currentState.barrierOpen ? -0.95 : 0, .08);
      cyanLight.intensity = 18 + Math.sin(frame * 2) * 3;
      const distance = 29 / zoom;
      camera.position.set(Math.sin(rotationY) * distance, 9 + rotationX * 8, Math.cos(rotationY) * distance);
      camera.lookAt(target);
      renderer.render(scene, camera);
    }
    window.cyberknightsScene = { setState };
    animate();

    const resizeObserver = new ResizeObserver(() => {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
    });
    resizeObserver.observe(host);
  } catch (error) {
    if (loading) {
      loading.classList.remove("hidden");
      loading.innerHTML = '<span style="color:#ffbf69">3D scene unavailable. Check your internet connection, then refresh.</span>';
    }
    console.error("CyberKnights 3D scene could not load:", error);
  }
}

update();
log("CyberKnights command centre initialized in demo mode.");
initThreeScene();
