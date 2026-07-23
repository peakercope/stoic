import { useState } from "react";
import { useStore } from "stoic-store/react";
import { coupons } from "../data";
import { applyCoupon, cart, removeCoupon } from "../store";

export function CouponInput() {
  const coupon = useStore(cart, (s) => s.coupon);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (coupon) {
    return (
      <div className="coupon applied">
        <span>
          <strong>{coupon.code}</strong> — {coupon.label}
        </span>
        <button type="button" className="link-danger" onClick={removeCoupon}>
          Remove
        </button>
      </div>
    );
  }

  function onSubmit(event: React.SubmitEvent) {
    event.preventDefault();
    // Coupons are just data, so we validate here and hand the store a real
    // Coupon object — the store never has to know which codes exist.
    const match = coupons[code.trim().toLowerCase()];
    if (!match) {
      setError("That code isn't valid.");
      return;
    }
    applyCoupon(match);
    setCode("");
    setError(null);
  }

  return (
    <form className="coupon" onSubmit={onSubmit}>
      <input
        value={code}
        onChange={(event) => setCode(event.target.value)}
        placeholder="Coupon code (try WELCOME10)"
        aria-label="Coupon code"
      />
      <button type="submit">Apply</button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
