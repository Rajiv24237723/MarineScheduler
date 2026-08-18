CREATE TABLE "actuals" (
	"id" text PRIMARY KEY NOT NULL,
	"stream" text NOT NULL,
	"period_id" text NOT NULL,
	"version_id" text,
	"plan_voyage_id" text,
	"vessel_name" text NOT NULL,
	"vessel_class" text DEFAULT '' NOT NULL,
	"pool" text DEFAULT 'OWNED' NOT NULL,
	"from_location_id" text,
	"to_location_id" text,
	"product_id" text,
	"qty_mt" double precision DEFAULT 0 NOT NULL,
	"start_day" integer DEFAULT 0 NOT NULL,
	"end_day" integer DEFAULT 0 NOT NULL,
	"cost" double precision DEFAULT 0 NOT NULL,
	"cost_breakdown" jsonb,
	"status" text DEFAULT 'COMPLETED' NOT NULL,
	"source" text DEFAULT 'MANUAL' NOT NULL,
	"note" text,
	"created_at" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"prev_hash" text,
	"hash" text
);
--> statement-breakpoint
CREATE TABLE "berths" (
	"id" text PRIMARY KEY NOT NULL,
	"stream" text NOT NULL,
	"location_id" text NOT NULL,
	"name" text NOT NULL,
	"nsim" integer DEFAULT 1 NOT NULL,
	"rate_mt_per_hr" double precision DEFAULT 1000 NOT NULL,
	"berthing_hours" double precision DEFAULT 12 NOT NULL,
	"max_draft" double precision DEFAULT 20 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charter_recommendations" (
	"id" text PRIMARY KEY NOT NULL,
	"stream" text NOT NULL,
	"version_id" text NOT NULL,
	"voyage_id" text,
	"vessel_class" text NOT NULL,
	"reason" text NOT NULL,
	"est_cost" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" text PRIMARY KEY NOT NULL,
	"stream" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_flows" (
	"id" text PRIMARY KEY NOT NULL,
	"stream" text NOT NULL,
	"location_id" text NOT NULL,
	"product_id" text NOT NULL,
	"daily_in" double precision DEFAULT 0 NOT NULL,
	"daily_out" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"stream" text NOT NULL,
	"period_id" text,
	"kind" text NOT NULL,
	"product_id" text NOT NULL,
	"location_id" text NOT NULL,
	"qty" double precision NOT NULL,
	"window_start" text NOT NULL,
	"window_end" text NOT NULL,
	"priority" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_periods" (
	"id" text PRIMARY KEY NOT NULL,
	"stream" text NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"horizon_days" integer DEFAULT 30 NOT NULL,
	"status" text DEFAULT 'Open' NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_compatibility" (
	"id" text PRIMARY KEY NOT NULL,
	"stream" text NOT NULL,
	"scope" text NOT NULL,
	"from_product" text NOT NULL,
	"to_product" text NOT NULL,
	"allowed" boolean DEFAULT true NOT NULL,
	"changeover_hours" double precision DEFAULT 0 NOT NULL,
	"changeover_cost" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"stream" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"color" text NOT NULL,
	"cargo_class" text DEFAULT 'CLEAN' NOT NULL,
	"density" double precision,
	"flash_point" double precision,
	"pour_point" double precision,
	"sulphur" text,
	"rating" text,
	"parcel_min" double precision,
	"parcel_max" double precision
);
--> statement-breakpoint
CREATE TABLE "scenarios" (
	"id" text PRIMARY KEY NOT NULL,
	"stream" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"as_of_day" integer DEFAULT 0 NOT NULL,
	"mode" text DEFAULT 'minimal-edit' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"stream" text NOT NULL,
	"run_id" text NOT NULL,
	"version" integer NOT NULL,
	"period_id" text,
	"is_baseline" boolean DEFAULT false NOT NULL,
	"parent_id" text,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"objective_cost" double precision NOT NULL,
	"achievable" boolean DEFAULT true NOT NULL,
	"kpi" jsonb,
	"projection" jsonb,
	"duals" jsonb,
	"payload" jsonb,
	"created_at" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"prev_hash" text,
	"hash" text
);
--> statement-breakpoint
CREATE TABLE "tanks" (
	"id" text PRIMARY KEY NOT NULL,
	"stream" text NOT NULL,
	"location_id" text NOT NULL,
	"product_id" text NOT NULL,
	"capacity" double precision NOT NULL,
	"min_stock" double precision NOT NULL,
	"current_stock" double precision NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vessels" (
	"id" text PRIMARY KEY NOT NULL,
	"stream" text NOT NULL,
	"name" text NOT NULL,
	"class" text NOT NULL,
	"dwt" double precision NOT NULL,
	"charter_type" text NOT NULL,
	"pool" text DEFAULT 'OWNED' NOT NULL,
	"service" text DEFAULT 'CLEAN' NOT NULL,
	"speed" double precision NOT NULL,
	"charter_cost" double precision DEFAULT 0 NOT NULL,
	"voyage_rate" double precision DEFAULT 0 NOT NULL,
	"avail_from" text,
	"avail_to" text,
	"draft_laden" double precision DEFAULT 0 NOT NULL,
	"draft_ballast" double precision DEFAULT 0 NOT NULL,
	"compartments" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voyage_ops" (
	"id" text PRIMARY KEY NOT NULL,
	"voyage_id" text NOT NULL,
	"stop_id" text NOT NULL,
	"op" text NOT NULL,
	"product_id" text NOT NULL,
	"qty" double precision NOT NULL,
	"compartment_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voyage_stops" (
	"id" text PRIMARY KEY NOT NULL,
	"voyage_id" text NOT NULL,
	"seq" integer NOT NULL,
	"location_id" text NOT NULL,
	"arrive_day" integer NOT NULL,
	"depart_day" integer NOT NULL,
	"kind" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voyages" (
	"id" text PRIMARY KEY NOT NULL,
	"stream" text NOT NULL,
	"version_id" text NOT NULL,
	"vessel_id" text,
	"vessel_name" text NOT NULL,
	"vessel_class" text NOT NULL,
	"pool" text NOT NULL,
	"start_day" integer NOT NULL,
	"end_day" integer NOT NULL,
	"cost" double precision NOT NULL,
	"cost_breakdown" jsonb
);
