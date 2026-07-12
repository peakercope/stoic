import { Cart } from "./components/Cart";
import { ProductList } from "./components/ProductList";

export function App() {
  return (
    <div className="page">
      <header className="masthead">
        <h1>Stoic Hardware</h1>
        <p className="muted">
          A shopping cart built on Stoic — every total is derived state, tracked automatically.
        </p>
      </header>

      <main className="layout">
        <ProductList />
        <Cart />
      </main>
    </div>
  );
}
