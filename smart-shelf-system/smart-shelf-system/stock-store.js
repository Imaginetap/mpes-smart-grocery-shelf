import { firebaseSettings } from "./firebase-config.js";
import { newProduct, applyEvent } from "./verification.js";

export const productIds = ["SHELF_01", "SHELF_02", "SHELF_03"];
const capacities = [5, 4, 5];
const storageKey = "smart-shelf-verification-v1";
let products = {};
let db, api;
let notify = () => {};
let reportError = () => {};
let unsubscribe = [];
const pending = new Set();
let processingQueue = Promise.resolve();
export const isCloud = firebaseSettings.enabled;

export async function startStore(onChange, onError) {
  notify = onChange;
  reportError = onError;
  if (!isCloud) {
    try { products = JSON.parse(localStorage.getItem(storageKey) || "{}"); } catch (_) { products = {}; }
    productIds.forEach((id, i) => { products[id] ||= newProduct(capacities[i]); });
    notify(products);
    return;
  }

  const firebaseAppModule = await import(
    "https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js"
  );

  api = await import(
    "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js"
  );

  const authModule = await import(
    "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js"
  );

  // Prevent duplicate Firebase initialization
  const app = firebaseAppModule.getApps().length
    ? firebaseAppModule.getApp()
    : firebaseAppModule.initializeApp(firebaseSettings.config);

  // Initialize Authentication
  const auth = authModule.getAuth(app);

  // Authenticate anonymously if not already authenticated
  if (!auth.currentUser) {
    await authModule.signInAnonymously(auth);
  }

  // Connect to Firestore
  db = api.getFirestore(app);

  console.log("Firebase initialized successfully!");
  console.log("Firestore connected:", firebaseSettings.config.projectId);

  unsubscribe.push(api.onSnapshot(api.collection(db, "products"), snapshot => {
    products = {};
    snapshot.forEach(doc => { products[doc.id] = doc.data(); });
    notify(products);
  }, reportError));
  // Any connected dashboard can process events. Transactions prevent duplicates.
  unsubscribe.push(api.onSnapshot(api.query(api.collection(db, "events"), api.where("processed", "==", false)), snapshot => {
    const events = snapshot.docs.slice().sort((a, b) =>
      (a.data().createdAt?.toMillis() || 0) - (b.data().createdAt?.toMillis() || 0) || a.id.localeCompare(b.id));
    processingQueue = processingQueue.then(async () => {
      for (const event of events) {
        if (pending.has(event.id)) continue;
        pending.add(event.id);
        try { await processEvent(event.ref); } catch (error) { reportError(error); }
        finally { pending.delete(event.id); }
      }
    }).catch(reportError);
  }, reportError));
}

async function processEvent(eventRef) {
  await api.runTransaction(db, async transaction => {
    const eventDoc = await transaction.get(eventRef);
    if (!eventDoc.exists() || eventDoc.data().processed) return;
    const event = eventDoc.data();
    const index = productIds.indexOf(event.productId);
    if (index < 0) throw new Error("Unknown product ID: " + event.productId);
    const productRef = api.doc(db, "products", event.productId);
    const productDoc = await transaction.get(productRef);
    const previous = productDoc.exists() ? productDoc.data() : newProduct(capacities[index]);
    const next = applyEvent(previous, event);
    transaction.set(productRef, { ...next, updatedAt: api.serverTimestamp() });
    transaction.update(eventRef, { processed: true, processedAt: api.serverTimestamp() });
  });
}

// Cart and checkout systems can write the same event shape directly to Firestore.
// Reuse an event ID when retrying a request; never generate a new ID for a retry.
export async function sendEvent(event, eventId = crypto.randomUUID()) {
  if (!productIds.includes(event.productId)) throw new Error("Unknown product ID.");
  if (!isCloud) {
    const previous = products[event.productId];
    products[event.productId] = applyEvent(previous, event);
    localStorage.setItem(storageKey, JSON.stringify(products));
    notify(products);
    return;
  }
  if (!db) throw new Error("Firestore is not ready yet.");
  const ref = api.doc(db, "events", eventId);
  await api.runTransaction(db, async transaction => {
    if ((await transaction.get(ref)).exists()) return;
    transaction.set(ref, { ...event, processed: false, createdAt: api.serverTimestamp() });
  });
}

export function stopStore() { unsubscribe.forEach(stop => stop()); unsubscribe = []; }
