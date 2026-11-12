// Pure stock accounting, shared by the local demo and Firestore transactions.
export function inventoryCount(state) {
  // Pending removals still belong to inventory until purchase is confirmed.
  return state.remaining + state.unverified + state.partial;
}

export function newProduct(capacity) {
  return { capacity, remaining: capacity, initialized: false, removed: 0,
    cartQuantity: 0, purchased: 0, unverified: 0, partial: 0, verified: 0 };
}

export function applyEvent(previous, event) {
  const state = { ...previous };
  const quantity = event.quantity;
  if (!Number.isInteger(quantity) || quantity < 0) throw new Error("Quantity must be a non-negative whole number.");
  if (event.simulated && event.type === "cart_add") {
    // Match existing pickups first. Only simulate additional physical removals.
    const pickup = Math.max(0, quantity - state.unverified);
    if (pickup > state.remaining) throw new Error("Not enough items on the shelf for this scan.");
    state.initialized = true;
    state.remaining -= pickup;
    state.removed += pickup;
  }
  if (event.simulated && event.type === "checkout" && quantity > state.cartQuantity) {
    throw new Error("Checkout quantity exceeds the scanned cart quantity.");
  }
  if (event.type === "shelf") {
    if (quantity > state.capacity) throw new Error("Reading exceeds shelf capacity.");
    // The first reading establishes a baseline; existing gaps are not removals.
    if (state.initialized) {
      const change = state.remaining - quantity;
      state.removed = Math.max(0, state.removed + change);
      if (change < 0) {
        // Returns/restocking clear pending removals first, then purchased slots.
        const pending = Math.max(0, previous.removed - previous.verified);
        state.purchased = Math.max(0, state.purchased - Math.max(0, -change - pending));
      }
    }
    state.remaining = quantity;
    state.initialized = true;
  } else if (event.type === "cart_add") {
    state.cartQuantity += quantity;
  } else if (event.type === "checkout") {
    // Only a confirmed checkout should create this event.
    state.cartQuantity = Math.max(0, state.cartQuantity - quantity);
    state.purchased += quantity;
  } else {
    throw new Error("Unknown event type.");
  }
  // Unmatched cart scans / checkouts remain available for a later sensor update.
  state.verified = Math.min(state.removed, state.purchased);
  state.partial = Math.min(state.removed - state.verified, state.cartQuantity);
  state.unverified = state.removed - state.verified - state.partial;
  return state;
}
