export class CheckoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InsufficientStockError extends CheckoutError {}

export class InsufficientBalanceError extends CheckoutError {}
