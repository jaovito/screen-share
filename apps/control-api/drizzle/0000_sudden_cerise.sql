CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"state" text DEFAULT 'idle' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rooms_state_check" CHECK ("rooms"."state" in ('idle', 'closed')),
	CONSTRAINT "rooms_owner_check" CHECK (length(trim("rooms"."owner_id")) > 0)
);
