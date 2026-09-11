-- 판독기 회귀용 DDL. 까다로운 것만 모았다.
--   · 인라인 REFERENCES · 테이블 레벨 FOREIGN KEY · ALTER TABLE ADD CONSTRAINT
--   · 복합 PK · 스키마 접두 · 따옴표/백틱 식별자 · 자기참조
--   · 정의 없는 테이블 참조(스텁) · 주석 안의 가짜 FK

CREATE SCHEMA sales;

CREATE TABLE sales.customer (
    customer_id   uuid          NOT NULL,
    name          varchar(80)   NOT NULL,
    email         varchar(160),
    referred_by   uuid          REFERENCES sales.customer(customer_id),  -- 자기참조
    CONSTRAINT pk_customer PRIMARY KEY (customer_id)
);
COMMENT ON TABLE sales.customer IS '고객';
COMMENT ON COLUMN sales.customer.email IS '이메일';

CREATE TABLE sales."order" (
    order_id    uuid        NOT NULL PRIMARY KEY,
    customer_id uuid        NOT NULL,
    /* 아래 주석 안의 FOREIGN KEY 는 읽으면 안 된다:
       FOREIGN KEY (ghost_col) REFERENCES ghost_never(id) */
    placed_at   timestamp   NOT NULL,
    coupon_id   uuid,
    FOREIGN KEY (customer_id) REFERENCES sales.customer (customer_id)
);
COMMENT ON TABLE sales."order" IS '주문';

CREATE TABLE IF NOT EXISTS sales.order_line (
    order_id    uuid    NOT NULL,
    line_no     int     NOT NULL,
    product_id  uuid    NOT NULL,
    qty         int     NOT NULL DEFAULT 1,
    PRIMARY KEY (order_id, line_no),
    CONSTRAINT fk_line_order   FOREIGN KEY (order_id)   REFERENCES sales."order"(order_id),
    CONSTRAINT fk_line_product FOREIGN KEY (product_id) REFERENCES catalog.product(product_id)
);
COMMENT ON TABLE sales.order_line IS '주문 상세';

CREATE TABLE catalog.product (
    `product_id`  uuid          NOT NULL PRIMARY KEY,
    `name`        varchar(160)  NOT NULL,
    category_id   uuid
);
COMMENT ON TABLE catalog.product IS '상품';

CREATE TABLE catalog.category (
    category_id uuid NOT NULL PRIMARY KEY,
    name        varchar(80) NOT NULL,
    parent_id   uuid
);
COMMENT ON TABLE catalog.category IS '분류';

ALTER TABLE ONLY catalog.product
    ADD CONSTRAINT fk_product_category FOREIGN KEY (category_id) REFERENCES catalog.category(category_id);

ALTER TABLE catalog.category
    ADD CONSTRAINT fk_category_parent FOREIGN KEY (parent_id) REFERENCES catalog.category(category_id);

-- 정의가 없는 테이블을 가리킨다 -> 스텁으로 남아야 한다
ALTER TABLE sales."order"
    ADD CONSTRAINT fk_order_coupon FOREIGN KEY (coupon_id) REFERENCES promo.coupon(coupon_id);
