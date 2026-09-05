-- Marketplace API data layer.
-- Applies to a clean database in one run; safe to re-run.
--
-- Money is numeric(12,2), never float. Time is timestamptz, never timestamp.
-- Surrogate keys are identity columns, not serial ("Don't Do This").
-- No optimization indexes here: they live in db/indexes.sql so that the
-- "before" EXPLAIN runs against a bare schema.

DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Buyers and sellers share one identity table.
CREATE TABLE users (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email      text        NOT NULL,
  name       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_key       UNIQUE (email),
  CONSTRAINT users_email_nonempty  CHECK (email <> ''),
  CONSTRAINT users_email_shaped    CHECK (email LIKE '%@%'),
  CONSTRAINT users_name_nonempty   CHECK (name <> '')
);

-- A listing owned by a seller.
CREATE TABLE products (
  id         bigint         GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  seller_id  bigint         NOT NULL,
  name       text           NOT NULL,
  price      numeric(12, 2) NOT NULL,
  created_at timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT products_seller_fk
    FOREIGN KEY (seller_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT products_name_nonempty CHECK (name <> ''),
  CONSTRAINT products_price_nonneg  CHECK (price >= 0)
);

-- Main table of the domain: one row per checkout.
CREATE TABLE orders (
  id         bigint         GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  buyer_id   bigint         NOT NULL,
  status     text           NOT NULL,
  total      numeric(12, 2) NOT NULL DEFAULT 0,
  created_at timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT orders_buyer_fk
    FOREIGN KEY (buyer_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT orders_status_allowed CHECK (
    status IN ('created', 'paid', 'shipped', 'cancelled')
  ),
  CONSTRAINT orders_total_nonneg CHECK (total >= 0)
);

-- Line items. unit_price is a snapshot: a later price edit must not rewrite history.
CREATE TABLE order_items (
  id         bigint         GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id   bigint         NOT NULL,
  product_id bigint         NOT NULL,
  quantity   integer        NOT NULL,
  unit_price numeric(12, 2) NOT NULL,
  CONSTRAINT order_items_order_fk
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT order_items_product_fk
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT,
  CONSTRAINT order_items_order_product_key UNIQUE (order_id, product_id),
  CONSTRAINT order_items_qty_positive     CHECK (quantity >= 1),
  CONSTRAINT order_items_price_nonneg     CHECK (unit_price >= 0)
);
