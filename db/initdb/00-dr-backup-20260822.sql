--
-- PostgreSQL database dump
--


-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--



--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.addresses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    label text DEFAULT 'Home'::text NOT NULL,
    recipient_name text NOT NULL,
    phone text NOT NULL,
    line1 text NOT NULL,
    line2 text,
    city text NOT NULL,
    state text NOT NULL,
    postal_code text NOT NULL,
    country_code character(2) DEFAULT 'IN'::bpchar NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: admin_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    full_name text NOT NULL,
    password_hash text NOT NULL,
    role text DEFAULT 'manager'::text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admin_users_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'manager'::text, 'fulfilment'::text])))
);


--
-- Name: cart_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cart_items (
    cart_id uuid NOT NULL,
    product_id bigint NOT NULL,
    quantity integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cart_items_quantity_check CHECK (((quantity > 0) AND (quantity <= 20)))
);


--
-- Name: carts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.carts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid,
    session_token uuid DEFAULT gen_random_uuid() NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '30 days'::interval) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT carts_status_check CHECK ((status = ANY (ARRAY['active'::text, 'converted'::text, 'abandoned'::text])))
);


--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id bigint NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    display_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.categories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.categories_id_seq OWNED BY public.categories.id;


--
-- Name: coupons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coupons (
    id bigint NOT NULL,
    code text NOT NULL,
    discount_type text NOT NULL,
    discount_value integer NOT NULL,
    minimum_order_paise integer DEFAULT 0 NOT NULL,
    usage_limit integer,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT coupons_discount_type_check CHECK ((discount_type = ANY (ARRAY['percentage'::text, 'fixed'::text]))),
    CONSTRAINT coupons_discount_value_check CHECK ((discount_value > 0)),
    CONSTRAINT coupons_minimum_order_paise_check CHECK ((minimum_order_paise >= 0)),
    CONSTRAINT coupons_usage_limit_check CHECK (((usage_limit IS NULL) OR (usage_limit > 0)))
);


--
-- Name: coupons_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.coupons_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: coupons_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.coupons_id_seq OWNED BY public.coupons.id;


--
-- Name: customer_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    token_hash character(64) NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '30 days'::interval) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    phone text,
    full_name text NOT NULL,
    password_hash text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    google_subject text
);


--
-- Name: inventory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory (
    product_id bigint NOT NULL,
    quantity integer DEFAULT 0 NOT NULL,
    reserved_quantity integer DEFAULT 0 NOT NULL,
    low_stock_threshold integer DEFAULT 5 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inventory_check CHECK (((reserved_quantity >= 0) AND (reserved_quantity <= quantity))),
    CONSTRAINT inventory_low_stock_threshold_check CHECK ((low_stock_threshold >= 0)),
    CONSTRAINT inventory_quantity_check CHECK ((quantity >= 0))
);


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id bigint NOT NULL,
    order_id uuid NOT NULL,
    product_id bigint,
    product_name text NOT NULL,
    sku text NOT NULL,
    unit_price_paise integer NOT NULL,
    quantity integer NOT NULL,
    line_total_paise integer NOT NULL,
    CONSTRAINT order_items_line_total_paise_check CHECK ((line_total_paise >= 0)),
    CONSTRAINT order_items_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT order_items_unit_price_paise_check CHECK ((unit_price_paise >= 0))
);


--
-- Name: order_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.order_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: order_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.order_items_id_seq OWNED BY public.order_items.id;


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_number text NOT NULL,
    customer_id uuid,
    coupon_id bigint,
    customer_name text NOT NULL,
    email text NOT NULL,
    phone text NOT NULL,
    shipping_address jsonb NOT NULL,
    subtotal_paise integer NOT NULL,
    discount_paise integer DEFAULT 0 NOT NULL,
    shipping_paise integer DEFAULT 0 NOT NULL,
    total_paise integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    payment_method text DEFAULT 'cod'::text NOT NULL,
    payment_status text DEFAULT 'pending'::text NOT NULL,
    customer_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT orders_discount_paise_check CHECK ((discount_paise >= 0)),
    CONSTRAINT orders_payment_method_check CHECK ((payment_method = ANY (ARRAY['cod'::text, 'manual'::text, 'razorpay'::text]))),
    CONSTRAINT orders_payment_status_check CHECK ((payment_status = ANY (ARRAY['pending'::text, 'cod'::text, 'paid'::text, 'failed'::text, 'refunded'::text]))),
    CONSTRAINT orders_shipping_paise_check CHECK ((shipping_paise >= 0)),
    CONSTRAINT orders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'packed'::text, 'shipped'::text, 'delivered'::text, 'cancelled'::text, 'returned'::text]))),
    CONSTRAINT orders_subtotal_paise_check CHECK ((subtotal_paise >= 0)),
    CONSTRAINT orders_total_paise_check CHECK ((total_paise >= 0))
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    provider text NOT NULL,
    provider_order_id text NOT NULL,
    provider_payment_id text,
    amount_paise integer NOT NULL,
    currency character(3) DEFAULT 'INR'::bpchar NOT NULL,
    status text DEFAULT 'created'::text NOT NULL,
    provider_payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payments_amount_paise_check CHECK ((amount_paise > 0)),
    CONSTRAINT payments_provider_check CHECK ((provider = 'razorpay'::text)),
    CONSTRAINT payments_status_check CHECK ((status = ANY (ARRAY['created'::text, 'authorized'::text, 'captured'::text, 'failed'::text, 'refunded'::text])))
);


--
-- Name: product_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_images (
    id bigint NOT NULL,
    product_id bigint NOT NULL,
    image_url text NOT NULL,
    alt_text text NOT NULL,
    display_order integer DEFAULT 0 NOT NULL
);


--
-- Name: product_images_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.product_images_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_images_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.product_images_id_seq OWNED BY public.product_images.id;


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id bigint NOT NULL,
    category_id bigint,
    slug text NOT NULL,
    sku text NOT NULL,
    name text NOT NULL,
    short_description text,
    description text,
    scent_family text NOT NULL,
    concentration text NOT NULL,
    size_ml integer NOT NULL,
    price_paise integer NOT NULL,
    compare_at_price_paise integer,
    featured boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT products_check CHECK (((compare_at_price_paise IS NULL) OR (compare_at_price_paise >= price_paise))),
    CONSTRAINT products_price_paise_check CHECK ((price_paise >= 0)),
    CONSTRAINT products_scent_family_check CHECK ((scent_family = ANY (ARRAY['floral'::text, 'fresh'::text, 'woody'::text, 'sets'::text]))),
    CONSTRAINT products_size_ml_check CHECK ((size_ml > 0))
);


--
-- Name: products_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.products_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: products_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.products_id_seq OWNED BY public.products.id;


--
-- Name: razorpay_webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.razorpay_webhook_events (
    event_id text NOT NULL,
    event_type text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories ALTER COLUMN id SET DEFAULT nextval('public.categories_id_seq'::regclass);


--
-- Name: coupons id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons ALTER COLUMN id SET DEFAULT nextval('public.coupons_id_seq'::regclass);


--
-- Name: order_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items ALTER COLUMN id SET DEFAULT nextval('public.order_items_id_seq'::regclass);


--
-- Name: product_images id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images ALTER COLUMN id SET DEFAULT nextval('public.product_images_id_seq'::regclass);


--
-- Name: products id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products ALTER COLUMN id SET DEFAULT nextval('public.products_id_seq'::regclass);


--
-- Data for Name: addresses; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.addresses (id, customer_id, label, recipient_name, phone, line1, line2, city, state, postal_code, country_code, is_default, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: admin_users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.admin_users (id, email, full_name, password_hash, role, active, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: cart_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.cart_items (cart_id, product_id, quantity, created_at, updated_at) FROM stdin;
6cda818c-0a7e-4e08-a15e-06b87de6c753	1	1	2026-08-20 03:46:03.308816+00	2026-08-20 03:46:03.308816+00
aa6acaeb-6efd-455b-b558-5d068658c758	1	1	2026-08-20 03:48:28.249401+00	2026-08-20 03:48:28.249401+00
e9710cb4-7db7-4678-9cae-6fa2434362f6	1	1	2026-08-20 04:18:08.046949+00	2026-08-20 04:18:08.046949+00
e9710cb4-7db7-4678-9cae-6fa2434362f6	4	1	2026-08-20 04:18:10.691222+00	2026-08-20 04:18:10.691222+00
e9710cb4-7db7-4678-9cae-6fa2434362f6	7	1	2026-08-20 04:18:13.263613+00	2026-08-20 04:18:13.263613+00
f1a2aa5e-7a24-4791-b3dc-9247c36e3004	1	2	2026-08-20 10:58:39.183254+00	2026-08-20 10:58:39.814555+00
054af2c1-af6f-46c1-ac69-bc42cf5a7966	2	2	2026-08-20 11:26:20.416448+00	2026-08-20 11:26:31.86007+00
054af2c1-af6f-46c1-ac69-bc42cf5a7966	3	2	2026-08-20 11:26:33.370561+00	2026-08-20 11:26:33.913276+00
054af2c1-af6f-46c1-ac69-bc42cf5a7966	8	2	2026-08-20 11:26:35.31953+00	2026-08-20 11:26:50.403362+00
222a8e76-ee1d-417d-aafd-9b2f89909a79	2	1	2026-08-22 10:22:56.314022+00	2026-08-22 10:22:56.314022+00
222a8e76-ee1d-417d-aafd-9b2f89909a79	3	1	2026-08-22 10:22:58.222258+00	2026-08-22 10:22:58.222258+00
222a8e76-ee1d-417d-aafd-9b2f89909a79	5	1	2026-08-22 10:23:00.363199+00	2026-08-22 10:23:00.363199+00
222a8e76-ee1d-417d-aafd-9b2f89909a79	4	1	2026-08-22 10:23:01.432121+00	2026-08-22 10:23:01.432121+00
a2d96220-2389-4a6e-acb8-9720755b1db2	1	1	2026-08-22 10:40:54.532782+00	2026-08-22 10:40:54.532782+00
f59ace6e-1ee5-4773-bef6-70140b9a24d8	1	1	2026-08-22 11:36:20.40515+00	2026-08-22 11:36:20.40515+00
b8846000-cbea-441a-9afe-de21455ca2d2	1	1	2026-08-22 12:43:57.681172+00	2026-08-22 12:43:57.681172+00
4361788b-54ea-45ce-b703-f8c831916ed2	2	1	2026-08-22 14:50:52.487984+00	2026-08-22 14:50:52.487984+00
4361788b-54ea-45ce-b703-f8c831916ed2	3	1	2026-08-22 14:50:53.692284+00	2026-08-22 14:50:53.692284+00
4361788b-54ea-45ce-b703-f8c831916ed2	9	1	2026-08-22 14:50:57.971135+00	2026-08-22 14:50:57.971135+00
\.


--
-- Data for Name: carts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.carts (id, customer_id, session_token, status, expires_at, created_at, updated_at) FROM stdin;
6cda818c-0a7e-4e08-a15e-06b87de6c753	\N	bc5da229-6fc6-4649-8294-997971d1d97a	active	2026-09-19 03:46:02.951446+00	2026-08-20 03:46:02.951446+00	2026-08-20 03:46:02.951446+00
aa6acaeb-6efd-455b-b558-5d068658c758	\N	bbb6820e-ce8f-4e03-b250-925e668ffeeb	active	2026-09-19 03:48:28.103895+00	2026-08-20 03:48:28.103895+00	2026-08-20 03:48:28.103895+00
e9710cb4-7db7-4678-9cae-6fa2434362f6	\N	da5ba969-4b9f-495b-8d11-ba2b7414d58f	converted	2026-09-19 04:18:07.86833+00	2026-08-20 04:18:07.86833+00	2026-08-20 04:18:54.779703+00
f1a2aa5e-7a24-4791-b3dc-9247c36e3004	\N	90414996-85af-4f93-8b9b-098e77b8dd34	active	2026-09-19 10:58:38.971843+00	2026-08-20 10:58:38.971843+00	2026-08-20 10:58:38.971843+00
054af2c1-af6f-46c1-ac69-bc42cf5a7966	\N	192966a6-038c-47b2-839c-fc05de48b983	converted	2026-09-19 11:26:20.174961+00	2026-08-20 11:26:20.174961+00	2026-08-20 11:27:31.270456+00
2d105fd7-f1f2-4efa-bda2-fbe95eeaee33	\N	f611d352-4aea-4d08-949b-34ac704744ba	active	2026-09-21 10:38:28.344982+00	2026-08-22 10:38:28.344982+00	2026-08-22 10:38:28.344982+00
2b2b3b09-b560-4d17-9e64-f4abcd7c7825	\N	3a4d423e-0f3f-4706-85b9-16ec61e9a5ec	active	2026-09-21 10:38:55.834022+00	2026-08-22 10:38:55.834022+00	2026-08-22 10:38:55.834022+00
a2d96220-2389-4a6e-acb8-9720755b1db2	\N	f9870ea3-049d-4d73-a7a1-f9c7db01ffcd	converted	2026-09-21 10:40:04.946615+00	2026-08-22 10:40:04.946615+00	2026-08-22 10:50:51.383277+00
222a8e76-ee1d-417d-aafd-9b2f89909a79	\N	bcba3921-ae1c-4cf3-865b-d73f14434ea3	converted	2026-09-21 10:22:56.121835+00	2026-08-22 10:22:56.121835+00	2026-08-22 10:51:41.788487+00
f59ace6e-1ee5-4773-bef6-70140b9a24d8	\N	dd99e9ac-8d29-47c2-8954-008dcaa74019	active	2026-09-21 11:36:20.064495+00	2026-08-22 11:36:20.064495+00	2026-08-22 11:36:20.064495+00
b8846000-cbea-441a-9afe-de21455ca2d2	\N	9091de98-76e1-4455-9be3-0ccf765a0873	converted	2026-09-21 12:43:57.519317+00	2026-08-22 12:43:57.519317+00	2026-08-22 12:45:56.035068+00
4361788b-54ea-45ce-b703-f8c831916ed2	\N	85683018-9317-430c-9ccf-2a95effd5d53	converted	2026-09-21 14:50:52.251765+00	2026-08-22 14:50:52.251765+00	2026-08-22 14:51:10.712718+00
\.


--
-- Data for Name: categories; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.categories (id, slug, name, description, display_order, active, created_at, updated_at) FROM stdin;
1	floral	Floral	Jasmine, tuberose, rose and soft vanilla compositions.	1	t	2026-08-19 18:44:12.938368+00	2026-08-19 18:44:12.938368+00
2	fresh	Fresh	Citrus, vetiver, sea salt and polished woods.	2	t	2026-08-19 18:44:12.938368+00	2026-08-19 18:44:12.938368+00
3	woody	Woody	Oud, amber, patchouli and evening compositions.	3	t	2026-08-19 18:44:12.938368+00	2026-08-19 18:44:12.938368+00
4	sets	Discovery & Gifts	Discovery wardrobes and considered fragrance pairings.	4	t	2026-08-19 18:44:12.938368+00	2026-08-19 18:44:12.938368+00
\.


--
-- Data for Name: coupons; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.coupons (id, code, discount_type, discount_value, minimum_order_paise, usage_limit, starts_at, ends_at, active, created_at, updated_at) FROM stdin;
1	WELCOME10	percentage	10	150000	500	\N	\N	t	2026-08-19 18:44:12.938368+00	2026-08-19 18:44:12.938368+00
\.


--
-- Data for Name: customer_sessions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.customer_sessions (id, customer_id, token_hash, expires_at, created_at, last_used_at) FROM stdin;
15d07937-5533-4a5a-b470-e5d03fc06d41	1b1929bd-b5cd-44e7-8f09-ff15f83c504d	a6a82956efe0054278974d1df59f70223e19133ca90843cc6d257765bbae8a34	2026-09-19 04:17:20.646972+00	2026-08-20 04:17:20.646972+00	2026-08-20 11:22:52.894605+00
907914b8-e59c-439b-bf13-507473fcded7	ec3550dd-90f7-481b-9b66-aef87c45d9db	197add0df322013a7c1e44ab2c7eecbca32e18727e31e3d2042e57d6edad33a3	2026-09-19 11:26:00.34877+00	2026-08-20 11:26:00.34877+00	2026-08-20 11:27:31.494156+00
602231fb-5af6-4b52-81d8-e49e197d2022	92839eef-0a1f-4d3b-940c-433cd09498ed	10b9464aad409c060ed4b5a67fca9888ec5009b96f41f424a4d6b2a85c8c1da2	2026-09-20 15:52:08.627419+00	2026-08-21 15:52:08.627419+00	2026-08-21 16:15:20.97158+00
adb2ce24-1a78-4008-a616-797f293c1db5	18a13e65-4f03-4485-84ed-e2c5d7813af1	052fab00a13a9d3ec18d2ca39ee3cde7328412ae2e5237ef4cdb0a77d0c6a3c2	2026-09-20 21:01:44.055105+00	2026-08-21 21:01:44.055105+00	2026-08-21 21:01:44.532341+00
abfbd7b2-747e-4991-91e2-2e65e563b258	4f2bbe62-0170-408b-b573-fa1e81a5c574	1e6ec95ff0c2f9e0f84c2eba217a32242ee5116be90d7c5890ab0b78cd01c915	2026-09-21 06:04:46.058143+00	2026-08-22 06:04:46.058143+00	2026-08-22 06:04:46.444462+00
6621734c-37ad-429f-8510-afcbb707b44b	4f2bbe62-0170-408b-b573-fa1e81a5c574	c029b158c8cf036119d63f573be313a5a9d81366cf502ab31855e13dcc12235a	2026-09-21 10:22:43.775188+00	2026-08-22 10:22:43.775188+00	2026-08-22 10:51:41.764737+00
7cd4ee18-5b0c-4d8c-8ac8-99fdaeafb681	49394da9-e5eb-478c-ad0b-7def15ea4694	08ce70c9d3b67e3da805496787144fb73c07b73281069b9d02a62e6ccf231817	2026-09-21 12:43:32.365244+00	2026-08-22 12:43:32.365244+00	2026-08-22 12:47:40.343898+00
29dbb9aa-3ea5-492a-915a-48ce6a08add3	4f2bbe62-0170-408b-b573-fa1e81a5c574	7552d4074ba6ca5b00043e8e830c9e149bf05eb8af401036db7d28a24c55d876	2026-09-21 14:50:07.713259+00	2026-08-22 14:50:07.713259+00	2026-08-22 14:51:10.286536+00
\.


--
-- Data for Name: customers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.customers (id, email, phone, full_name, password_hash, active, created_at, updated_at, google_subject) FROM stdin;
1b1929bd-b5cd-44e7-8f09-ff15f83c504d	systemadmin@asiaville.in	9150081840	Qwerty	scrypt$9f7ce8d343b29aa716831cd94fbf00b4$df62c3ed1a1ecaafcc687db394ace58c87d0e00d91e20fa2b4ad2e0ae644b83d36f2ef2f970b651d60b309142c761c0b37f0d259f639fb5762c97d961f74f763	t	2026-08-20 04:17:20.646972+00	2026-08-20 04:17:20.646972+00	\N
ec3550dd-90f7-481b-9b66-aef87c45d9db	systemadm@asiaville.in	9791317154	Babu	scrypt$a979a3d9562b1dd446b474464bb681cb$787bf8f9275a2cf9b97b7dcf850718085768278eeda5f33c77ddee9d839b9d02998b9a5c7d9dda78cd63b85397005a9c3c3d032a3c58dc2d677b207172ec0e17	t	2026-08-20 11:26:00.34877+00	2026-08-20 11:26:00.34877+00	\N
92839eef-0a1f-4d3b-940c-433cd09498ed	1234@gmail.com	919791317176	1234	scrypt$94b1bf84862dd771928468386af2a828$bfeadbe6374b363bbd78325362198227abab714bddb6976c8e6de539e70e3f59afda6612cf86eebc9b9edcab768a475a7d4c5bfbaadb141ff8f092d305733136	t	2026-08-21 15:52:08.627419+00	2026-08-21 15:52:08.627419+00	\N
18a13e65-4f03-4485-84ed-e2c5d7813af1	qwqqw@gmaiul.com	9999999999	bbbbb	scrypt$930cf5e342b105a8026d42e98d8629ba$f597b19c7f6fabb0630039f3b09fc0d93da900883b2a6f27e077344e6e86ed14280f1b2265534a1d95d7d0156da30883975f472501ffe5f73e46e60d1a804b98	t	2026-08-21 21:01:44.055105+00	2026-08-21 21:01:44.055105+00	\N
a99cfb95-c2ee-4711-b4ce-8909054472bb	sarvah031220@gmail.com	\N	Sarvah B	\N	t	2026-08-22 06:02:47.801577+00	2026-08-22 06:02:47.801577+00	102898848220808015944
4f2bbe62-0170-408b-b573-fa1e81a5c574	smartsystemsani@gmail.com	\N	Babu D	\N	t	2026-08-22 06:04:46.027366+00	2026-08-22 06:04:46.027366+00	101470624322900277328
49394da9-e5eb-478c-ad0b-7def15ea4694	babu.sarvah@gmail.com	\N	babu d	\N	t	2026-08-22 12:43:32.293282+00	2026-08-22 12:43:32.293282+00	116062608142622614122
\.


--
-- Data for Name: inventory; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.inventory (product_id, quantity, reserved_quantity, low_stock_threshold, updated_at) FROM stdin;
6	40	0	5	2026-08-19 18:44:12.938368+00
7	39	0	5	2026-08-20 04:18:54.779703+00
8	20	0	5	2026-08-22 06:06:27.837814+00
5	39	0	5	2026-08-22 10:51:41.788487+00
4	38	0	5	2026-08-22 10:51:41.788487+00
1	37	0	5	2026-08-22 12:45:56.035068+00
2	38	0	5	2026-08-22 14:51:10.712718+00
3	38	0	5	2026-08-22 14:51:10.712718+00
9	19	0	5	2026-08-22 14:51:10.712718+00
\.


--
-- Data for Name: order_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.order_items (id, order_id, product_id, product_name, sku, unit_price_paise, quantity, line_total_paise) FROM stdin;
1	964f2599-af09-4259-ae78-49836f4ae538	1	Madurai Jasmine	BUVA-MJ-050	149000	1	149000
2	964f2599-af09-4259-ae78-49836f4ae538	4	Royal Tuberose	BUVA-RT-050	189000	1	189000
3	964f2599-af09-4259-ae78-49836f4ae538	7	Rare Vanilla	BUVA-RV-050	149000	1	149000
4	b24ff986-7f3e-4711-a7e3-5b70c3a82be3	2	Coastal Vetiver	BUVA-CV-050	169000	2	338000
5	b24ff986-7f3e-4711-a7e3-5b70c3a82be3	3	Rose Oud	BUVA-RO-050	219000	2	438000
6	b24ff986-7f3e-4711-a7e3-5b70c3a82be3	8	Discovery Wardrobe	BUVA-DW-012	99000	2	198000
7	becd9eaf-ed12-4b1f-9a1b-1ddb5c5c3b30	1	Madurai Jasmine	BUVA-MJ-050	149000	1	149000
8	dfba97b2-27c5-4c33-8488-86123bcaa054	2	Coastal Vetiver	BUVA-CV-050	169000	1	169000
9	dfba97b2-27c5-4c33-8488-86123bcaa054	3	Rose Oud	BUVA-RO-050	219000	1	219000
10	dfba97b2-27c5-4c33-8488-86123bcaa054	5	Midnight Patchouli	BUVA-MP-050	219000	1	219000
11	dfba97b2-27c5-4c33-8488-86123bcaa054	4	Royal Tuberose	BUVA-RT-050	189000	1	189000
12	0fb26432-10ff-4685-941c-041fdc66f7a2	1	Madurai Jasmine	BUVA-MJ-050	149000	1	149000
13	df3eead9-cce4-4bfd-8548-266e1ee2b7a7	2	Coastal Vetiver	BUVA-CV-050	169000	1	169000
14	df3eead9-cce4-4bfd-8548-266e1ee2b7a7	3	Rose Oud	BUVA-RO-050	219000	1	219000
15	df3eead9-cce4-4bfd-8548-266e1ee2b7a7	9	Chennai After Dark	BUVA-CAD-100	359000	1	359000
\.


--
-- Data for Name: orders; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.orders (id, order_number, customer_id, coupon_id, customer_name, email, phone, shipping_address, subtotal_paise, discount_paise, shipping_paise, total_paise, status, payment_method, payment_status, customer_notes, created_at, updated_at) FROM stdin;
964f2599-af09-4259-ae78-49836f4ae538	BUVA-20260820-5478DDD0	1b1929bd-b5cd-44e7-8f09-ff15f83c504d	\N	Qwerty	systemadmin@asiaville.in	9150081840	{"city": "Channel", "line1": "Disclaimer", "line2": null, "state": "Tamilnadu", "postalCode": "600130", "countryCode": "IN", "recipientName": "Qwerty"}	487000	0	0	487000	delivered	cod	cod	\N	2026-08-20 04:18:54.779703+00	2026-08-20 06:16:19.570624+00
b24ff986-7f3e-4711-a7e3-5b70c3a82be3	BUVA-20260820-8F17486F	ec3550dd-90f7-481b-9b66-aef87c45d9db	\N	Babu	systemadm@asiaville.in	9791317154	{"city": "Chennai", "line1": "D-206", "line2": "Main", "state": "Tamil", "postalCode": "600130", "countryCode": "IN", "recipientName": "Babu"}	974000	0	0	974000	returned	cod	cod	\N	2026-08-20 11:27:31.270456+00	2026-08-22 06:06:27.837814+00
becd9eaf-ed12-4b1f-9a1b-1ddb5c5c3b30	BUVA-20260822-FFC78A7A	\N	\N	Babu Test	test@example.com	9791317176	{"city": "Chennai", "line1": "Test Address", "line2": null, "state": "Tamil Nadu", "postalCode": "600001", "countryCode": "IN", "recipientName": "Babu Test"}	149000	0	9900	158900	pending	razorpay	pending	\N	2026-08-22 10:50:51.383277+00	2026-08-22 10:50:51.383277+00
dfba97b2-27c5-4c33-8488-86123bcaa054	BUVA-20260822-FFB4DA49	4f2bbe62-0170-408b-b573-fa1e81a5c574	\N	D. BABU	babu.dharmalingam@outlook.com	+919791317176	{"city": "Chennai", "line1": "Senior System Administrator", "line2": null, "state": "IN-TN", "postalCode": "600130", "countryCode": "IN", "recipientName": "D. BABU"}	796000	0	0	796000	pending	razorpay	pending	\N	2026-08-22 10:51:41.788487+00	2026-08-22 10:51:41.788487+00
0fb26432-10ff-4685-941c-041fdc66f7a2	BUVA-20260822-C07AF0E0	49394da9-e5eb-478c-ad0b-7def15ea4694	\N	Sarvah	sarva@gmail.com	9884076420	{"city": "Chennai", "line1": "D-206", "line2": "Bolineni", "state": "Tamilnadu", "postalCode": "600130", "countryCode": "IN", "recipientName": "Sarvah"}	149000	0	9900	158900	packed	razorpay	paid	\N	2026-08-22 12:45:56.035068+00	2026-08-22 12:48:48.43912+00
df3eead9-cce4-4bfd-8548-266e1ee2b7a7	BUVA-20260822-762BB73F	4f2bbe62-0170-408b-b573-fa1e81a5c574	\N	BABU D	babu.dharmalingam@outlook.com	+919791317176	{"city": "Chennai", "line1": "Bolineni", "line2": null, "state": "IN-TN", "postalCode": "600130", "countryCode": "IN", "recipientName": "BABU D"}	747000	0	0	747000	pending	razorpay	pending	\N	2026-08-22 14:51:10.712718+00	2026-08-22 14:51:10.712718+00
\.


--
-- Data for Name: payments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.payments (id, order_id, provider, provider_order_id, provider_payment_id, amount_paise, currency, status, provider_payload, created_at, updated_at) FROM stdin;
7f3a2a50-36b3-4e1f-a370-8e29b4ef5f3f	becd9eaf-ed12-4b1f-9a1b-1ddb5c5c3b30	razorpay	order_TSmxXgtfAyaFXG	\N	158900	INR	created	{"id": "order_TSmxXgtfAyaFXG", "notes": {"buva_order": "BUVA-20260822-FFC78A7A", "customer_email": "test@example.com"}, "amount": 158900, "entity": "order", "status": "created", "receipt": "BUVA-20260822-FFC78A7A", "attempts": 0, "currency": "INR", "offer_id": null, "amount_due": 158900, "created_at": 1787395852, "amount_paid": 0}	2026-08-22 10:50:51.383277+00	2026-08-22 10:50:51.383277+00
732f810c-d541-484d-8cb1-43a5fe792ac0	dfba97b2-27c5-4c33-8488-86123bcaa054	razorpay	order_TSmyQ1d58EVoLO	\N	796000	INR	created	{"id": "order_TSmyQ1d58EVoLO", "notes": {"buva_order": "BUVA-20260822-FFB4DA49", "customer_email": "babu.dharmalingam@outlook.com"}, "amount": 796000, "entity": "order", "status": "created", "receipt": "BUVA-20260822-FFB4DA49", "attempts": 0, "currency": "INR", "offer_id": null, "amount_due": 796000, "created_at": 1787395902, "amount_paid": 0}	2026-08-22 10:51:41.788487+00	2026-08-22 10:51:41.788487+00
ecc64834-864d-4e00-b1e4-5e90c549936d	0fb26432-10ff-4685-941c-041fdc66f7a2	razorpay	order_TSov5uaXinGYs2	pay_TSowVaQCRXU6k1	158900	INR	captured	{"id": "pay_TSowVaQCRXU6k1", "fee": 3750, "tax": 572, "upi": {"vpa": "success@razorpay", "flow": "intent"}, "vpa": "success@razorpay", "bank": null, "email": "sarva@gmail.com", "notes": {"buva_order": "BUVA-20260822-C07AF0E0", "customer_email": "sarva@gmail.com"}, "amount": 158900, "entity": "payment", "method": "upi", "status": "captured", "wallet": null, "card_id": null, "contact": "+919884076420", "captured": true, "currency": "INR", "order_id": "order_TSov5uaXinGYs2", "created_at": 1787402837, "error_code": null, "error_step": null, "invoice_id": null, "description": "Order BUVA-20260822-C07AF0E0", "error_reason": null, "error_source": null, "acquirer_data": {"rrn": "667658859796", "upi_transaction_id": "1CFF37CF9034606DC6963F1FE96C51F4"}, "international": false, "refund_status": null, "amount_refunded": 0, "error_description": null}	2026-08-22 12:45:56.035068+00	2026-08-22 12:47:38.71325+00
1303bc6e-ecbb-4084-9117-09144bdb7fb9	df3eead9-cce4-4bfd-8548-266e1ee2b7a7	razorpay	order_TSr3OL31tEaW1Y	\N	747000	INR	created	{"id": "order_TSr3OL31tEaW1Y", "notes": {"buva_order": "BUVA-20260822-762BB73F", "customer_email": "babu.dharmalingam@outlook.com"}, "amount": 747000, "entity": "order", "status": "created", "receipt": "BUVA-20260822-762BB73F", "attempts": 0, "currency": "INR", "offer_id": null, "amount_due": 747000, "created_at": 1787410271, "amount_paid": 0}	2026-08-22 14:51:10.712718+00	2026-08-22 14:51:10.712718+00
\.


--
-- Data for Name: product_images; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.product_images (id, product_id, image_url, alt_text, display_order) FROM stdin;
1	1	/img/buva/madurai-jasmine.png	Madurai Jasmine fragrance by Buva Chennai	0
2	2	/img/buva/fresh-vetiver.png	Coastal Vetiver fragrance by Buva Chennai	0
3	3	/img/buva/rose-oud.png	Rose Oud fragrance by Buva Chennai	0
4	4	/img/buva/madurai-jasmine.png	Royal Tuberose fragrance by Buva Chennai	0
5	5	/img/buva/rose-oud.png	Midnight Patchouli fragrance by Buva Chennai	0
6	6	/img/buva/fresh-vetiver.png	Sandalwood Coast fragrance by Buva Chennai	0
7	7	/img/buva/madurai-jasmine.png	Rare Vanilla fragrance by Buva Chennai	0
8	8	/img/buva/campaign-hero.png	Discovery Wardrobe fragrance by Buva Chennai	0
9	9	/img/buva/campaign-hero.png	Chennai After Dark fragrance by Buva Chennai	0
\.


--
-- Data for Name: products; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.products (id, category_id, slug, sku, name, short_description, description, scent_family, concentration, size_ml, price_paise, compare_at_price_paise, featured, active, created_at, updated_at) FROM stdin;
1	1	madurai-jasmine	BUVA-MJ-050	Madurai Jasmine	Jasmine, orange blossom and vanilla.	\N	floral	Eau de Parfum	50	149000	165000	t	t	2026-08-19 18:44:12.938368+00	2026-08-19 18:44:12.938368+00
2	2	coastal-vetiver	BUVA-CV-050	Coastal Vetiver	Bergamot, vetiver and soft woods.	\N	fresh	Eau de Parfum	50	169000	\N	t	t	2026-08-19 18:44:12.938368+00	2026-08-19 18:44:12.938368+00
3	3	rose-oud	BUVA-RO-050	Rose Oud	Rose, saffron and oud.	\N	woody	Parfum	50	219000	\N	t	t	2026-08-19 18:44:12.938368+00	2026-08-19 18:44:12.938368+00
4	1	royal-tuberose	BUVA-RT-050	Royal Tuberose	Tuberose, coconut milk and musk.	\N	floral	Eau de Parfum	50	189000	\N	f	t	2026-08-19 18:44:12.938368+00	2026-08-19 18:44:12.938368+00
5	3	midnight-patchouli	BUVA-MP-050	Midnight Patchouli	Patchouli, amber and cacao.	\N	woody	Parfum	50	219000	\N	f	t	2026-08-19 18:44:12.938368+00	2026-08-19 18:44:12.938368+00
6	2	sandalwood-coast	BUVA-SC-050	Sandalwood Coast	Lemon, sandalwood and sea salt.	\N	fresh	Eau de Parfum	50	169000	\N	f	t	2026-08-19 18:44:12.938368+00	2026-08-19 18:44:12.938368+00
7	1	rare-vanilla	BUVA-RV-050	Rare Vanilla	Vanilla, heliotrope and tonka.	\N	floral	Eau de Parfum	50	149000	\N	f	t	2026-08-19 18:44:12.938368+00	2026-08-19 18:44:12.938368+00
8	4	discovery-wardrobe	BUVA-DW-012	Discovery Wardrobe	Six fragrances in 2 ml vials.	\N	sets	Discovery Set	12	99000	120000	t	t	2026-08-19 18:44:12.938368+00	2026-08-19 18:44:12.938368+00
9	4	chennai-after-dark	BUVA-CAD-100	Chennai After Dark	Rose Oud and Midnight Patchouli duo.	\N	sets	Gift Set	100	359000	438000	f	t	2026-08-19 18:44:12.938368+00	2026-08-19 18:44:12.938368+00
\.


--
-- Data for Name: razorpay_webhook_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.razorpay_webhook_events (event_id, event_type, received_at) FROM stdin;
\.


--
-- Name: categories_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.categories_id_seq', 4, true);


--
-- Name: coupons_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.coupons_id_seq', 1, true);


--
-- Name: order_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.order_items_id_seq', 15, true);


--
-- Name: product_images_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.product_images_id_seq', 9, true);


--
-- Name: products_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.products_id_seq', 9, true);


--
-- Name: addresses addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addresses
    ADD CONSTRAINT addresses_pkey PRIMARY KEY (id);


--
-- Name: admin_users admin_users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_email_key UNIQUE (email);


--
-- Name: admin_users admin_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_pkey PRIMARY KEY (id);


--
-- Name: cart_items cart_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_pkey PRIMARY KEY (cart_id, product_id);


--
-- Name: carts carts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carts
    ADD CONSTRAINT carts_pkey PRIMARY KEY (id);


--
-- Name: carts carts_session_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carts
    ADD CONSTRAINT carts_session_token_key UNIQUE (session_token);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: categories categories_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_slug_key UNIQUE (slug);


--
-- Name: coupons coupons_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_code_key UNIQUE (code);


--
-- Name: coupons coupons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_pkey PRIMARY KEY (id);


--
-- Name: customer_sessions customer_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_sessions
    ADD CONSTRAINT customer_sessions_pkey PRIMARY KEY (id);


--
-- Name: customer_sessions customer_sessions_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_sessions
    ADD CONSTRAINT customer_sessions_token_hash_key UNIQUE (token_hash);


--
-- Name: customers customers_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_email_key UNIQUE (email);


--
-- Name: customers customers_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_phone_key UNIQUE (phone);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: inventory inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_pkey PRIMARY KEY (product_id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: orders orders_order_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_order_number_key UNIQUE (order_number);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: payments payments_provider_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_provider_order_id_key UNIQUE (provider_order_id);


--
-- Name: payments payments_provider_payment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_provider_payment_id_key UNIQUE (provider_payment_id);


--
-- Name: product_images product_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_pkey PRIMARY KEY (id);


--
-- Name: product_images product_images_product_id_display_order_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_product_id_display_order_key UNIQUE (product_id, display_order);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: products products_sku_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_sku_key UNIQUE (sku);


--
-- Name: products products_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_slug_key UNIQUE (slug);


--
-- Name: razorpay_webhook_events razorpay_webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.razorpay_webhook_events
    ADD CONSTRAINT razorpay_webhook_events_pkey PRIMARY KEY (event_id);


--
-- Name: customers_google_subject_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customers_google_subject_key ON public.customers USING btree (google_subject) WHERE (google_subject IS NOT NULL);


--
-- Name: idx_addresses_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_addresses_customer ON public.addresses USING btree (customer_id);


--
-- Name: idx_carts_customer_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_carts_customer_status ON public.carts USING btree (customer_id, status);


--
-- Name: idx_customer_sessions_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_sessions_customer ON public.customer_sessions USING btree (customer_id);


--
-- Name: idx_customer_sessions_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_sessions_expiry ON public.customer_sessions USING btree (expires_at);


--
-- Name: idx_orders_customer_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_customer_created ON public.orders USING btree (customer_id, created_at DESC);


--
-- Name: idx_orders_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_status_created ON public.orders USING btree (status, created_at DESC);


--
-- Name: idx_payments_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_order ON public.payments USING btree (order_id);


--
-- Name: idx_payments_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_status ON public.payments USING btree (status, created_at DESC);


--
-- Name: idx_products_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_category ON public.products USING btree (category_id);


--
-- Name: idx_products_family_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_family_active ON public.products USING btree (scent_family, active);


--
-- Name: addresses addresses_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER addresses_updated_at BEFORE UPDATE ON public.addresses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: admin_users admin_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER admin_users_updated_at BEFORE UPDATE ON public.admin_users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: cart_items cart_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER cart_items_updated_at BEFORE UPDATE ON public.cart_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: carts carts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER carts_updated_at BEFORE UPDATE ON public.carts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: categories categories_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER categories_updated_at BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: coupons coupons_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER coupons_updated_at BEFORE UPDATE ON public.coupons FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: customers customers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: orders orders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: payments payments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payments_updated_at BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: products products_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: addresses addresses_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addresses
    ADD CONSTRAINT addresses_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: cart_items cart_items_cart_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_cart_id_fkey FOREIGN KEY (cart_id) REFERENCES public.carts(id) ON DELETE CASCADE;


--
-- Name: cart_items cart_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: carts carts_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carts
    ADD CONSTRAINT carts_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: customer_sessions customer_sessions_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_sessions
    ADD CONSTRAINT customer_sessions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: inventory inventory_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: orders orders_coupon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES public.coupons(id) ON DELETE SET NULL;


--
-- Name: orders orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: payments payments_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: product_images product_images_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: products products_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--


