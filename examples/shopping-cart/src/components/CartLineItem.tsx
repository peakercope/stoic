import { money } from "../format";
import { type CartItem, removeItem, setQuantity } from "../store";

export function CartLineItem({ item }: { item: CartItem }) {
  return (
    <li className="line-item">
      <div className="line-item-info">
        <span className="line-item-title">{item.title}</span>
        <span className="muted">{money(item.price)} each</span>
      </div>

      <div className="qty">
        <button
          type="button"
          aria-label={`Decrease ${item.title}`}
          onClick={() => setQuantity(item.id, item.quantity - 1)}
        >
          −
        </button>
        <span className="qty-value">{item.quantity}</span>
        <button
          type="button"
          aria-label={`Increase ${item.title}`}
          onClick={() => setQuantity(item.id, item.quantity + 1)}
        >
          +
        </button>
      </div>

      <span className="line-item-total">{money(item.price * item.quantity)}</span>

      <button
        type="button"
        className="link-danger"
        onClick={() => removeItem(item.id)}
        aria-label={`Remove ${item.title}`}
      >
        Remove
      </button>
    </li>
  );
}
