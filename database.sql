CREATE DATABASE IF NOT EXISTS jelita_flower CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE jelita_flower;

CREATE TABLE users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('customer','admin') NOT NULL DEFAULT 'customer',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE products (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  category VARCHAR(80) NOT NULL,
  price DECIMAL(12,2) NOT NULL,
  stock INT UNSIGNED NOT NULL DEFAULT 0,
  description TEXT NULL,
  emoji VARCHAR(16) NOT NULL DEFAULT '💐',
  color VARCHAR(30) NOT NULL DEFAULT 'rose',
  image_url VARCHAR(255) NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE orders (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NULL,
  customer_name VARCHAR(120) NOT NULL,
  recipient_name VARCHAR(120) NULL,
  phone VARCHAR(30) NOT NULL,
  address TEXT NOT NULL,
  city VARCHAR(120) NULL,
  postal_code VARCHAR(20) NULL,
  notes TEXT NULL,
  latitude DECIMAL(10,7) NULL,
  longitude DECIMAL(10,7) NULL,
  shipping_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
  total DECIMAL(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  payment_method VARCHAR(40) NULL,
  payment_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  payment_code VARCHAR(80) NULL,
  paid_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE order_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL,
  product_id INT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  price DECIMAL(12,2) NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE payments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL,
  payment_code VARCHAR(80) NOT NULL UNIQUE,
  method VARCHAR(40) NOT NULL,
  channel VARCHAR(40) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  va_number VARCHAR(40) NULL,
  snap_token TEXT NULL,
  snap_redirect TEXT NULL,
  paid_at DATETIME NULL,
  expires_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE TABLE push_subscriptions (
  endpoint_hash CHAR(64) PRIMARY KEY,
  endpoint TEXT NOT NULL,
  p256dh VARCHAR(255) NOT NULL,
  auth VARCHAR(255) NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_push_subscriptions_user (user_id)
);

INSERT INTO products (name, category, price, stock, description, emoji, color) VALUES
('Rosy Garden', 'Buket bunga', 349000, 20, 'Rangkaian mawar segar pilihan.', '🌹', 'rose'),
('Blush Peony', 'Buket bunga', 425000, 15, 'Buket peony dengan nuansa lembut.', '🌷', 'blush'),
('Spring Meadow', 'Buket bunga', 289000, 24, 'Bunga cerah untuk hari istimewa.', '🌼', 'meadow'),
('Sweet Love', 'Buket spesial', 499000, 10, 'Rangkaian spesial penuh cinta.', '💐', 'sweet');
