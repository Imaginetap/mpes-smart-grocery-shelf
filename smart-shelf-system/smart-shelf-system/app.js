import { startStore, sendEvent, isCloud, productIds } from "./stock-store.js";
import { inventoryCount } from "./verification.js";

const connectButton = document.querySelector("#connect-btn");
const disconnectButton = document.querySelector("#disconnect-btn");
const connectionPill = document.querySelector("#connection-pill");
const connectionLabel = document.querySelector("#connection-label");
const activityList = document.querySelector("#activity-list");
const alertList = document.querySelector("#alert-list");

let port = null;
let reader = null;
let keepReading = false;
let lastStatuses = [null, null, null];
let activityCount = 0;

const productNames = ["Milk", "Cereal", "Juice"];

document.querySelector("#today-date").textContent =
  new Intl.DateTimeFormat(undefined, { year: "numeric", month: "long", day: "numeric" }).format(new Date());

function setConnectionState(state, message) {
  connectionPill.className = `connection-pill ${state}`;
  connectionLabel.textContent = message;
  const dot = document.querySelector("#sidebar-status-dot");
  dot.classList.toggle("connected", state === "connected");
  document.querySelector("#sidebar-system-title").textContent =
    state === "connected" ? "ESP32 connected" : state === "error" ? "Connection error" : "ESP32 disconnected";
  document.querySelector("#sidebar-system-subtitle").textContent =
    state === "connected" ? "Receiving live sensor data" : "Waiting for USB connection";
  connectButton.hidden = state === "connected";
  disconnectButton.hidden = state !== "connected";
}

function addActivity(title, description, type = "info") {
  const empty = activityList.querySelector(".empty-state");
  if (empty) empty.remove();
  const item = document.createElement("div");
  item.className = "activity-item";
  const iconClass = type === "danger" ? "fa-triangle-exclamation" : type === "warning" ? "fa-circle-exclamation" : "fa-microchip";
  item.innerHTML = `
    <div class="activity-icon ${type}"><i class="fa-solid ${iconClass}"></i></div>
    <div class="activity-details">
      <strong></strong><p></p><span></span>
    </div>`;
  item.querySelector("strong").textContent = title;
  item.querySelector("p").textContent = description;
  item.querySelector("span").textContent = new Date().toLocaleTimeString();
  activityList.prepend(item);
  activityCount += 1;
  while (activityList.children.length > 12) activityList.lastElementChild.remove();
}

function classifyShelf(shelf) {
  if (!shelf.sensor_valid) return { label: "SENSOR ERROR", key: "error" };
  const value = Number(shelf.stock_percent);
  if (value <= 0) return { label: "EMPTY", key: "empty" };
  if (value < 30) return { label: "LOW STOCK", key: "low" };
  if (value < 70) return { label: "MEDIUM", key: "medium" };
  return { label: "OPTIMAL", key: "optimal" };
}

function updateShelfCard(shelf, index) {
  const state = currentProducts[productIds[index]];
  if (state?.initialized) {
    shelf = { ...shelf, stock_percent: Math.round(inventoryCount(state) / state.capacity * 100) };
  }
  const status = classifyShelf(shelf);
  const percent = Math.max(0, Math.min(100, Number(shelf.stock_percent) || 0));
  document.querySelector(`#status-${index}`).textContent = status.label;
  document.querySelector(`#status-${index}`).className = `stock-badge ${status.key}`;
  document.querySelector(`#stock-${index}`).textContent = shelf.sensor_valid ? `${percent}%` : "--%";
  document.querySelector(`#progress-label-${index}`).textContent = shelf.sensor_valid ? `${percent}%` : "--";
  document.querySelector(`#progress-${index}`).style.width = shelf.sensor_valid ? `${percent}%` : "0%";
  document.querySelector(`#progress-${index}`).className = `progress-fill ${status.key}`;
  document.querySelector(`#distance-${index}`).textContent =
    shelf.sensor_valid && shelf.distance_cm != null && Number.isFinite(Number(shelf.distance_cm)) ? `${Number(shelf.distance_cm).toFixed(1)} cm` : "-- cm";
  document.querySelector(`#sensor-${index}`).textContent = shelf.sensor_valid ? "正常 / OK" : "Error";
  if (lastStatuses[index] !== null && lastStatuses[index] !== status.key) {
    addActivity(`${productNames[index]} shelf status changed`, `${lastStatuses[index].toUpperCase()} → ${status.label}`, status.key === "error" || status.key === "empty" ? "danger" : "warning");
  }
  lastStatuses[index] = status.key;
  return { ...status, percent, valid: Boolean(shelf.sensor_valid) };
}

function updateSummary(statuses) {
  const valid = statuses.filter(s => s.valid);
  const average = valid.length ? Math.round(valid.reduce((sum, s) => sum + s.percent, 0) / valid.length) : null;
  document.querySelector("#average-stock").innerHTML = average === null ? "--<span>%</span>" : `${average}<span>%</span>`;
  document.querySelector("#optimal-count").innerHTML = `${statuses.filter(s => s.valid && s.key === "optimal").length} <span>shelves</span>`;
  document.querySelector("#low-count").innerHTML = `${statuses.filter(s => s.valid && s.key === "low").length} <span>shelves</span>`;
  document.querySelector("#empty-count").innerHTML = `${statuses.filter(s => s.valid && s.key === "empty").length} <span>shelves</span>`;
}

function updateAlerts(statuses) {
  alertList.replaceChildren();
  let count = 0;
  statuses.forEach((status, index) => {
    if (status.key === "optimal" || status.key === "medium") return;
    count++;
    const item = document.createElement("div");
    item.className = `alert-item ${status.key === "empty" || status.key === "error" ? "danger-alert" : "warning-alert"}`;
    const icon = status.key === "low" ? "fa-triangle-exclamation" : "fa-circle-xmark";
    const heading = status.key === "error" ? "Sensor Error" : status.key === "empty" ? "Shelf Empty" : "Low Stock Warning";
    const message = status.key === "error" ? `${productNames[index]} sensor is not returning a valid reading.` :
      status.key === "empty" ? `${productNames[index]} shelf is reporting 0% capacity.` :
      `${productNames[index]} shelf is at ${status.percent}% capacity.`;
    item.innerHTML = `<div class="alert-symbol"><i class="fa-solid ${icon}"></i></div><div><strong></strong><p></p></div>`;
    item.querySelector("strong").textContent = heading;
    item.querySelector("p").textContent = message;
    alertList.append(item);
  });
  if (!count) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No low-stock or empty shelves detected.";
    alertList.append(empty);
  }
  document.querySelector("#alert-counter").textContent = String(count).padStart(2, "0");
  document.querySelector("#nav-alert-count").textContent = String(count).padStart(2, "0");
}

function handlePayload(payload) {
  if (demoMode) return; // Keep simulated shelf counts and bars consistent.
  if (!payload || payload.type !== "smart_shelf" || !Array.isArray(payload.shelves) || payload.shelves.length !== 3) {
    return; // Ignore startup text or unrelated serial output.
  }
  latestShelves = payload.shelves;
  const statuses = payload.shelves.map((shelf, index) => updateShelfCard(shelf, index));
  updateSummary(statuses);
  updateAlerts(statuses);
  if (!demoMode) {
    payload.shelves.forEach((shelf, index) => {
      if (!shelf.sensor_valid) return;
      const capacity = [5, 4, 5][index];
      const count = Number.isInteger(shelf.stock_count) ? shelf.stock_count : Math.round(Number(shelf.stock_percent) * capacity / 100);
      if (!Number.isInteger(count) || count < 0 || count > capacity) return;
      if (lastSubmittedCounts[index] === count) return;
      lastSubmittedCounts[index] = count;
      shelfWriteQueue = shelfWriteQueue.then(() => sendEvent({ type: "shelf", productId: productIds[index], quantity: count }))
        .catch(error => { lastSubmittedCounts[index] = null; showStoreError(error); });
    });
  }
}

async function connectESP32() {
  if (!("serial" in navigator)) {
    alert("Web Serial is not supported in this browser. Please use desktop Google Chrome or Microsoft Edge and open the site through localhost/Live Server.");
    return;
  }
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    keepReading = true;
    setConnectionState("connected", "ESP32 CONNECTED");
    addActivity("ESP32 connected", "USB serial connection opened at 115200 baud.", "info");
    const decoder = new TextDecoderStream();
    const closed = port.readable.pipeTo(decoder.writable);
    reader = decoder.readable.getReader();
    let buffer = "";
    while (keepReading) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try {
          handlePayload(JSON.parse(line));
        } catch (error) {
          console.debug("Ignoring non-JSON serial line:", line);
        }
      }
    }
    await closed.catch(() => {});
  } catch (error) {
    if (error.name !== "NotFoundError") {
      console.error(error);
      setConnectionState("error", "CONNECTION ERROR");
      addActivity("Serial connection error", error.message || "Unable to read ESP32 serial data.", "danger");
      alert(`Could not connect to the ESP32: ${error.message}`);
    }
  } finally {
    keepReading = false;
    if (reader) {
      try { await reader.cancel(); } catch (_) {}
      reader.releaseLock();
      reader = null;
    }
    if (port) {
      try { await port.close(); } catch (_) {}
      port = null;
    }
    setConnectionState("disconnected", "ESP32 DISCONNECTED");
  }
}

async function disconnectESP32() {
  keepReading = false;
  if (reader) {
    try { await reader.cancel(); } catch (_) {}
  }
}

connectButton.addEventListener("click", connectESP32);
disconnectButton.addEventListener("click", disconnectESP32);

if ("serial" in navigator) {
  navigator.serial.addEventListener("disconnect", () => {
    keepReading = false;
    addActivity("ESP32 disconnected", "The USB serial device was unplugged.", "danger");
    setConnectionState("disconnected", "ESP32 DISCONNECTED");
  });
}
setConnectionState("disconnected", "ESP32 DISCONNECTED");


// Verification bar and beginner-friendly integration controls.
let demoMode = false;
let lastSubmittedCounts = [null, null, null];
let shelfWriteQueue = Promise.resolve();
let currentProducts = {};
let latestShelves = [];
const controls = document.createElement("section");
controls.className = "panel verification-controls";
controls.innerHTML = `
  <h2>Purchase verification</h2>
  <p id="store-status">${isCloud ? "Connecting to Firestore?" : "Local demo ? saved in this browser"}</p>
  <p>Solid: on shelf ? 45% opacity: unverified ? 20% opacity: cart matched ? transparent: purchased</p>
  <label>Product <select id="test-product"><option value="SHELF_01">Milk</option><option value="SHELF_02">Cereal</option><option value="SHELF_03">Juice</option></select></label>
  <label>Quantity <input id="test-quantity" type="number" value="1" min="0" max="100" step="1"></label>
  <button data-event="shelf">Set shelf count</button>
  <button data-event="cart_add">Simulate cart scan</button>
  <button data-event="checkout">Simulate confirmed checkout</button>
  <p>Cart scans turn picked-up stock translucent. Inventory stays unchanged until checkout, which makes purchased slots fully transparent. Set shelf count controls physical stock; the percentage includes pending items until purchase is confirmed.</p>
  <p>Test buttons pause USB updates. Reload the page to resume hardware readings. In Firestore mode these buttons write real test events.</p>`;
document.querySelector("#shelves").before(controls);
productIds.forEach((id, index) => {
  const box = document.createElement("div");
  box.className = "verification-box";
  box.innerHTML = `<div class="verification-track" id="verification-${index}" role="img"></div><p id="verification-label-${index}">Waiting for a shelf baseline.</p>`;
  const progress = document.querySelectorAll(".stock-progress")[index];
  document.querySelectorAll(".stock-quantity span")[index].textContent = "INVENTORY NOT YET CHECKED OUT";
  progress.querySelector(".progress-label span").textContent = "Inventory remaining";
  progress.querySelector(".progress-track").hidden = true;
  progress.append(box);
});
function showStoreError(error) {
  document.querySelector("#store-status").textContent = "Storage error: " + error.message;
}
function renderVerification(products) {
  currentProducts = products;
  {
    const statuses = productIds.map((id, index) => {
      const state = products[id];
      const status = updateShelfCard({
        sensor_valid: demoMode ? Boolean(state?.initialized) : (latestShelves[index]?.sensor_valid ?? Boolean(state?.initialized)),
        stock_percent: state ? Math.round(state.remaining / state.capacity * 100) : null,
        distance_cm: demoMode ? null : latestShelves[index]?.distance_cm
      }, index);
      if (demoMode) {
        document.querySelector(`#distance-${index}`).textContent = "-- cm";
        document.querySelector(`#sensor-${index}`).textContent = "Simulated";
      }
      return status;
    });
    updateSummary(statuses);
    updateAlerts(statuses);
  }
  productIds.forEach((id, index) => {
    const state = products[id];
    if (!state) return;
    const track = document.querySelector(`#verification-${index}`);
    track.replaceChildren();
    const values = [["remaining", state.remaining], ["unverified", state.unverified], ["partial", state.partial], ["verified", state.verified]];
    values.forEach(([name, count]) => {
      const segment = document.createElement("span");
      segment.className = "verification-segment " + name;
      segment.style.width = `${count / state.capacity * 100}%`;
      segment.title = `${name}: ${count}`;
      track.append(segment);
    });
    const label = state.initialized
      ? `${inventoryCount(state)}/${state.capacity} inventory | ${state.remaining} physically on shelf | ${state.unverified} unverified | ${state.partial} cart matched | ${state.verified} purchased`
      : "Waiting for first shelf count (baseline).";
    track.setAttribute("aria-label", label);
    document.querySelector(`#verification-label-${index}`).textContent = label;
  });
}
controls.querySelectorAll("button[data-event]").forEach(button => {
  button.addEventListener("click", async () => {
    const quantity = Number(document.querySelector("#test-quantity").value);
    const productId = document.querySelector("#test-product").value;
    if (!Number.isInteger(quantity) || quantity < 0) { showStoreError(new Error("Enter a non-negative whole quantity.")); return; }
    demoMode = true;
    button.disabled = true;
    try {
      await shelfWriteQueue;
      await sendEvent({ type: button.dataset.event, productId, quantity, simulated: true });
      document.querySelector("#store-status").textContent = `${isCloud ? "Firestore" : "Local demo"} ? test mode active`;
    } catch (error) { showStoreError(error); }
    finally { button.disabled = false; }
  });
});
startStore(renderVerification, showStoreError).catch(showStoreError);
