# Smart Shelf with purchase verification

Open index.html with VS Code Live Server. No build is needed. The default local demo saves to this browser and requires no Firebase account or ESP32.

## Try the verification flow

1. Select Milk, quantity 5, and click Set shelf count. This is the initial baseline.
2. Set shelf count to 2: three removals become unverified.
3. Set quantity 2 and click Simulate cart scan: two removals become partially verified.
4. Set quantity 1 and click Simulate confirmed checkout: one removed slot becomes fully transparent.
5. Raise the shelf count to simulate returns or restocking.

Solid blue = on shelf; 45% opacity = unverified; 20% opacity = cart matched; completely transparent = purchased. Text labels show exact counts.

The headline percentage counts all inventory not yet checked out, including translucent pending items. For 5 original items, scanning 2 shows 100% (3 opaque + 2 translucent). Checking out those 2 shows 60% (3 opaque + 2 completely transparent). Physical stock remains 3 throughout checkout.
Simulated cart scans match existing unverified pickups first, then automatically reduce shelf stock for any additional units. Checkout only commits the scanned quantity as purchased; it does not remove shelf stock again. Scanning more than available stock or checking out more than scanned is rejected.

The verification bar replaces the old solid progress bar. Test actions update shelf percentages and summary cards together and pause USB updates until reload. A scan can start a fresh demo without manually setting the shelf count first (the default is full capacity).

## Hardware

Upload arduino/smart_shelf_esp32/smart_shelf_esp32.ino using Arduino IDE with U8g2 and LiquidCrystal_I2C installed. Connect from a desktop browser supporting Web Serial; close Serial Monitor first. The board sends JSON at 115200 baud every second. Calibrate the firmware constants for your shelf: currently 5 cm full, 30 cm empty; capacities 5 milk, 4 cereal, 5 juice. Invalid readings do not update verification. Counts are estimates.

## Enable Firestore

1. Create a Firebase project and Cloud Firestore database.
2. Register a web app and paste its config into firebase-config.js.
3. Enable Authentication > Sign-in method > Anonymous.
4. Publish firestore.rules through the console Rules tab.
5. Set enabled to true in firebase-config.js and reload.

The supplied rules support a shared classroom prototype. Any authenticated client can write these records. Before real deployment, restrict checkout events to a trusted checkout service and product updates to staff/service accounts. Never put service-account keys in the web app.

## Database schema

Only two collections are needed. Product documents are created automatically.

```text
products/SHELF_01
  capacity: 5
  remaining: 2
  initialized: true
  removed: 3
  cartQuantity: 1
  purchased: 1
  unverified: 1
  partial: 1
  verified: 1
  updatedAt: timestamp

events/unique_event_id
  productId: "SHELF_01"
  type: "cart_add"
  quantity: 1
  processed: false
  createdAt: timestamp
```

IDs: SHELF_01 = milk, SHELF_02 = cereal, SHELF_03 = juice.

| Event type | Quantity means |
| --- | --- |
| shelf | Absolute remaining physical count |
| cart_add | Newly scanned units |
| checkout | Units purchased in a confirmed transaction |

The first shelf reading establishes the baseline; existing gaps do not count as removals. An initially incomplete shelf therefore has an unfilled portion outside the tracked segments. Returns/restocking clear pending removals first, then purchased slots. The sensor cannot distinguish returns from replenishment.

Cart and checkout quantities aggregate across all customers by product. Scans and checkouts arriving before sensor changes remain available for later matching. purchased includes unmatched checkout credits; cartQuantity is active scanned quantity. The three verification counters sum to removed.

## Connect your future cart and checkout

Write events instead of editing product counters. Using the modular Firebase SDK:

```js
// Import doc, runTransaction, serverTimestamp from firebase/firestore.
// db is the initialized Firestore instance with an authenticated user.
async function publishEvent(eventId, productId, type, quantity) {
  const ref = doc(db, "events", eventId);
  await runTransaction(db, async transaction => {
    if ((await transaction.get(ref)).exists()) return;
    transaction.set(ref, {
      productId, type, quantity,
      processed: false,
      createdAt: serverTimestamp()
    });
  });
}

await publishEvent("cart7_scan42", "SHELF_01", "cart_add", 1);
await publishEvent("receipt18_milk", "SHELF_01", "checkout", 1);
```

Use a unique ID per action/product line and reuse that SAME ID on retries. Send cart_add once per successful scan, not every cart render. Checkout consumes scanned quantity automatically. Send checkout only after purchase confirmation.

Dashboard test events include `simulated: true` to adapt physical stock automatically. Real cart integrations should omit this flag, since actual sensor readings supply physical removals.

Keep a dashboard open to process events. A transaction updates the product and marks the event processed together, preventing duplicate processing by multiple dashboards. Pending events are sorted by creation time, but strict global ordering across different clients is not guaranteed. Send changes in order. For always-on processing, move processEvent to a trusted backend later.

Local and cloud data are separate. To reset the local demo, delete smart-shelf-verification-v1 from localStorage using browser DevTools. For a new cloud experiment, clear both test products and events. Keep processed events while producers could retry their IDs.

## Checks

Run node verification.test.mjs to test removals, matching, checkout, returns, restocking, early events, baseline and invalid quantities.
