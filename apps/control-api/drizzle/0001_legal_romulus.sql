CREATE TABLE "auth_account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "auth_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rtc_cleanup_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"room_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"rtc_room" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "media_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"room_id" uuid NOT NULL,
	"rtc_room" text NOT NULL,
	"epoch" integer NOT NULL,
	"membership_revision" integer NOT NULL,
	"publisher_id" text NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_sessions_rtc_room_unique" UNIQUE("rtc_room"),
	CONSTRAINT "media_session_state" CHECK ("media_sessions"."state" in ('preparing','active','closing','closed','abandoned'))
);
--> statement-breakpoint
CREATE TABLE "private_rooms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_id" text NOT NULL,
	"epoch" integer DEFAULT 0 NOT NULL,
	"membership_revision" integer DEFAULT 1 NOT NULL,
	"state" text DEFAULT 'idle' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "private_room_name" CHECK (length(trim("private_rooms"."name")) between 1 and 80),
	CONSTRAINT "private_room_state" CHECK ("private_rooms"."state" in ('idle','preparing','active','closing','closed')),
	CONSTRAINT "private_room_epoch" CHECK ("private_rooms"."epoch" >= 0 AND "private_rooms"."membership_revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "request_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"window_start" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_audit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"room_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_invites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"room_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"max_uses" integer NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"revoked" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "room_invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invite_limit" CHECK ("room_invites"."max_uses" between 1 and 7 AND "room_invites"."uses" between 0 and "room_invites"."max_uses")
);
--> statement-breakpoint
CREATE TABLE "room_members" (
	"room_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"role" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_members_room_id_user_id_pk" PRIMARY KEY("room_id","user_id"),
	CONSTRAINT "member_status" CHECK ("room_members"."status" in ('approved','pending')),
	CONSTRAINT "member_role" CHECK ("room_members"."role" in ('owner','viewer'))
);
--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rtc_cleanup_outbox" ADD CONSTRAINT "rtc_cleanup_outbox_room_id_private_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."private_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rtc_cleanup_outbox" ADD CONSTRAINT "rtc_cleanup_outbox_session_id_media_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."media_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_sessions" ADD CONSTRAINT "media_sessions_room_id_private_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."private_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_sessions" ADD CONSTRAINT "media_sessions_publisher_id_auth_user_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_rooms" ADD CONSTRAINT "private_rooms_owner_id_auth_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_audit" ADD CONSTRAINT "room_audit_room_id_private_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."private_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_invites" ADD CONSTRAINT "room_invites_room_id_private_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."private_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_room_id_private_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."private_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_account_user_idx" ON "auth_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_session_user_idx" ON "auth_session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cleanup_session_unique" ON "rtc_cleanup_outbox" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "cleanup_pending_idx" ON "rtc_cleanup_outbox" USING btree ("available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "room_epoch_unique" ON "media_sessions" USING btree ("room_id","epoch");--> statement-breakpoint
CREATE UNIQUE INDEX "one_room_owner" ON "room_members" USING btree ("room_id") WHERE "room_members"."role"='owner';